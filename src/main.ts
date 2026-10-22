import { ArchiveRecorder, clearSaved, loadSaved, type SavedRecording } from './archiveRecorder';
import { keepAwake, startCamera, stopStream, type Facing } from './camera';
import { extensionFor, formatClock, pickMimeType } from './media';
import { SegmentRecorder } from './segmentRecorder';
import { TimeshiftPlayer } from './timeshift';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const btnCamera = $<HTMLButtonElement>('btn-camera');
const btnRecord = $<HTMLButtonElement>('btn-record');
const btnSplit = $<HTMLButtonElement>('btn-split');
const btnFlip = $<HTMLButtonElement>('btn-flip');
const selBuffer = $<HTMLSelectElement>('sel-buffer');
const status = $('status');
const live = $<HTMLVideoElement>('live');
const recTime = $('rec-time');
const tsPanel = $('timeshift-panel');
const tsMute = $<HTMLButtonElement>('ts-mute');
const saveBar = $('save-bar');
const saveInfo = $('save-info');

const mime = pickMimeType();
const bufferMs = () => Number(selBuffer.value) * 60_000;

const segments = new SegmentRecorder(mime, bufferMs());
const archive = new ArchiveRecorder(mime);
const player = new TimeshiftPlayer(segments, [$<HTMLVideoElement>('ts-a'), $<HTMLVideoElement>('ts-b')], {
  seek: $<HTMLInputElement>('ts-seek'),
  label: $('ts-label'),
  playBtn: $<HTMLButtonElement>('ts-play'),
});

let stream: MediaStream | null = null;
let facing: Facing = 'environment';
let split = false;
let muted = true;
let recTimer = 0;
let pending: SavedRecording | null = null;

function setStatus(msg: string) {
  status.textContent = msg;
}

async function openCamera() {
  stopStream(stream);
  stream = await startCamera(facing);
  live.srcObject = stream;
  // 카메라가 켜져 있는 동안 되감기 버퍼는 항상 쌓는다 (녹화 버튼과 무관)
  segments.start(stream);
  if (split) {
    player.hide();
    player.show();
  }
}

btnCamera.onclick = async () => {
  if (stream) {
    if (archive.recording) await stopRecording();
    if (split) toggleSplit();
    segments.stop();
    segments.clear();
    stopStream(stream);
    stream = null;
    live.srcObject = null;
    btnCamera.textContent = '카메라 켜기';
    [btnRecord, btnSplit, btnFlip].forEach((b) => (b.disabled = true));
    return;
  }
  try {
    await openCamera();
    keepAwake();
    btnCamera.textContent = '카메라 끄기';
    [btnRecord, btnSplit, btnFlip].forEach((b) => (b.disabled = false));
    setStatus(mime.split(';')[0]);
  } catch (e) {
    setStatus(`카메라 오류: ${(e as Error).message}`);
  }
};

btnFlip.onclick = async () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  await openCamera();
};

async function startRecording() {
  pending = null;
  await archive.start(stream!);
  btnRecord.textContent = '■ 정지';
  btnRecord.classList.add('on');
  btnFlip.disabled = true; // 녹화 중 스트림 교체 불가
  recTime.hidden = false;
  recTimer = window.setInterval(() => {
    recTime.textContent = `● REC ${formatClock(Date.now() - archive.startedAt)}`;
  }, 500);
}

async function stopRecording() {
  clearInterval(recTimer);
  recTime.hidden = true;
  btnRecord.textContent = '● 녹화';
  btnRecord.classList.remove('on');
  btnFlip.disabled = false;
  setStatus('저장 중…');
  const saved = await archive.stop();
  setStatus(mime.split(';')[0]);
  if (saved) offerSave(saved);
}

btnRecord.onclick = async () => {
  if (pending && !confirm('저장하지 않은 녹화가 있습니다. 새로 녹화하면 지워집니다. 계속할까요?')) return;
  hideSave();
  btnRecord.disabled = true;
  try {
    archive.recording ? await stopRecording() : await startRecording();
  } catch (e) {
    setStatus(`녹화 오류: ${(e as Error).message}`);
  } finally {
    btnRecord.disabled = false;
  }
};

function toggleSplit() {
  split = !split;
  tsPanel.hidden = !split;
  btnSplit.classList.toggle('on', split);
  split ? player.show() : player.hide();
}

btnSplit.onclick = toggleSplit;
selBuffer.onchange = () => segments.setMaxMs(bufferMs());

$('ts-back').onclick = () => player.skip(-10);
$('ts-fwd').onclick = () => player.skip(10);
$('ts-play').onclick = () => player.togglePause();
$('ts-latest').onclick = () => player.latest();
tsMute.onclick = () => {
  muted = !muted;
  tsMute.textContent = muted ? '🔇' : '🔊';
  player.setMuted(muted);
};

// --- 저장 ---

function fileOf(rec: SavedRecording) {
  const d = new Date(rec.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `live_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return new File([rec.blob], `${name}.${extensionFor(rec.blob.type)}`, { type: rec.blob.type });
}

function offerSave(rec: SavedRecording, recovered = false) {
  pending = rec;
  const mb = (rec.blob.size / 1024 / 1024).toFixed(1);
  saveInfo.textContent = `${recovered ? '이전 녹화 발견' : '녹화 완료'} (${mb}MB)`;
  $('btn-share').hidden = !navigator.canShare?.({ files: [fileOf(rec)] });
  saveBar.hidden = false;
}

function hideSave() {
  saveBar.hidden = true;
}

$('btn-download').onclick = () => {
  if (!pending) return;
  const file = fileOf(pending);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
};

$('btn-share').onclick = async () => {
  if (!pending) return;
  try {
    await navigator.share({ files: [fileOf(pending)] });
  } catch {
    // 사용자가 공유 시트를 닫음
  }
};

$('btn-discard').onclick = async () => {
  if (!confirm('녹화를 삭제할까요?')) return;
  await clearSaved();
  pending = null;
  hideSave();
};

// 이전 접속에서 저장하지 않은 녹화가 남아 있으면 복구 제안
loadSaved().then((rec) => rec && offerSave(rec, true));
