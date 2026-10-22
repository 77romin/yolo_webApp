import { ArchiveRecorder, clearSaved, loadSaved, type SavedRecording } from './archiveRecorder';
import { keepAwake, startCamera, stopStream, type Facing } from './camera';
import { Compositor } from './compositor';
import { LiveInference } from './inference';
import { extensionFor, formatClock, pickMimeType } from './media';
import { detectorFor, MODES, type Mode } from './modes';
import { SegmentRecorder } from './segmentRecorder';
import { TimeshiftPlayer } from './timeshift';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const btnCamera = $<HTMLButtonElement>('btn-camera');
const btnRecord = $<HTMLButtonElement>('btn-record');
const btnSplit = $<HTMLButtonElement>('btn-split');
const btnFlip = $<HTMLButtonElement>('btn-flip');
const btnDetect = $<HTMLButtonElement>('btn-detect');
const selBuffer = $<HTMLSelectElement>('sel-buffer');
const selSource = $<HTMLSelectElement>('sel-source');
const status = $('status');
const live = $<HTMLVideoElement>('live');
const recTime = $('rec-time');
const tsPanel = $('timeshift-panel');
const tsMute = $<HTMLButtonElement>('ts-mute');
const saveBar = $('save-bar');
const saveInfo = $('save-info');

const mime = pickMimeType();
const bufferMs = () => Number(selBuffer.value) * 60_000;

const overlay = $<HTMLCanvasElement>('overlay');
const inference = new LiveInference(live, overlay);
const compositor = new Compositor(live, overlay);
const segments = new SegmentRecorder(mime, bufferMs());
const archive = new ArchiveRecorder(mime);
const player = new TimeshiftPlayer(segments, [$<HTMLVideoElement>('ts-a'), $<HTMLVideoElement>('ts-b')], {
  seek: $<HTMLInputElement>('ts-seek'),
  label: $('ts-label'),
  playBtn: $<HTMLButtonElement>('ts-play'),
});

let stream: MediaStream | null = null; // 카메라 원본
let source: MediaStream | null = null; // 실제 녹화 소스 (원본 또는 박스 합성)
let facing: Facing = 'environment';
let split = false;
let muted = true;
let recTimer = 0;
let pending: SavedRecording | null = null;
let notice = '';

function setStatus(msg: string) {
  notice = msg;
  renderStatus();
}

function renderStatus() {
  const parts = [notice || mime.split(';')[0]];
  const det = inference.detector;
  if (loading) parts.push(`${loading} 모델 로딩…`);
  else if (det && stream && inference.enabled) parts.push(`${det.backend} ${inference.fps.toFixed(1)}fps · ${inference.detections.length}개`);
  status.textContent = parts.join(' · ');
}
setInterval(renderStatus, 500);

// --- 카테고리 모드 ---

const modeBar = $('modes');
let loading = '';
let modeId = '';

async function selectMode(mode: Mode) {
  modeId = mode.id;
  localStorage.setItem('mode', mode.id);
  for (const b of modeBar.children) b.classList.toggle('on', (b as HTMLElement).dataset.mode === mode.id);
  inference.detector = null; // 새 모델 준비될 때까지 이전 박스를 지우고 멈춤
  inference.clear();
  loading = mode.label;
  try {
    const detector = await detectorFor(mode);
    if (modeId !== mode.id) return; // 로딩 중 다른 모드를 눌렀음
    inference.options = mode.options;
    inference.detector = detector;
  } catch (e) {
    if (modeId === mode.id) setStatus((e as Error).message);
  } finally {
    if (modeId === mode.id) loading = '';
  }
}

for (const mode of MODES) {
  const b = document.createElement('button');
  b.textContent = mode.label;
  b.dataset.mode = mode.id;
  b.onclick = () => selectMode(mode);
  modeBar.append(b);
}
selectMode(MODES.find((m) => m.id === localStorage.getItem('mode')) ?? MODES[0]);

// --- 녹화 소스 (원본 / 박스 포함) ---

selSource.value = localStorage.getItem('source') ?? 'raw';
const withBoxes = () => selSource.value === 'boxes';

selSource.onchange = () => {
  localStorage.setItem('source', selSource.value);
  if (!stream) return;
  // 새 소스로 되감기 조각을 넘긴 뒤 이전 합성을 정지 (버퍼는 유지)
  if (withBoxes()) {
    source = compositor.start(stream);
    segments.setStream(source);
  } else {
    source = stream;
    segments.setStream(source);
    compositor.stop();
  }
};

function videoReady(v: HTMLVideoElement) {
  return v.readyState >= 1 ? Promise.resolve() : new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
}

async function openCamera() {
  compositor.stop();
  stopStream(stream);
  stream = await startCamera(facing);
  live.srcObject = stream;
  await videoReady(live);
  source = withBoxes() ? compositor.start(stream) : stream;
  // 카메라가 켜져 있는 동안 되감기 버퍼는 항상 쌓는다 (녹화 버튼과 무관)
  segments.start(source);
  inference.start();
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
    inference.stop();
    compositor.stop();
    stopStream(stream);
    stream = source = null;
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
    setStatus('');
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
  await archive.start(source!);
  selSource.disabled = true; // 녹화 중에는 한 파일 안에서 소스를 바꿀 수 없음
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
  selSource.disabled = false;
  setStatus('저장 중…');
  const saved = await archive.stop();
  setStatus('');
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
btnDetect.onclick = () => {
  inference.setEnabled(!inference.enabled);
  btnDetect.classList.toggle('on', inference.enabled);
  btnDetect.textContent = inference.enabled ? '인식 ON' : '인식 OFF';
};
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

// --- PWA: 홈 화면 설치 + 오프라인 캐시 (개발 서버에서는 캐시가 방해되므로 배포 빌드에서만) ---

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.ready;
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => new URL(u).origin === location.origin);
    reg.active?.postMessage({ cache: urls });
  });
}
