import { ArchiveRecorder } from './archiveRecorder';
import { keepAwake, startCamera, stopStream, type Facing } from './camera';
import { Compositor } from './compositor';
import { FRAME_DELAY_MAX_MS, FrameDelay } from './frameDelay';
import { LiveInference } from './inference';
import { StudioLink, toMessage } from './link';
import { formatClock, pickMimeType } from './media';
import { detectorFor, MODES, type Mode } from './modes';
import { registerPWA } from './pwa';
import { SaveBar } from './saveBar';
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
const tsDelay = $<HTMLSelectElement>('ts-delay');
const tsLive = $<HTMLVideoElement>('ts-live');
const tsLabel = $('ts-label');
const tsMute = $<HTMLButtonElement>('ts-mute');

const mime = pickMimeType();
const bufferMs = () => Number(selBuffer.value) * 60_000;

const overlay = $<HTMLCanvasElement>('overlay');
const inference = new LiveInference(live, overlay);
const compositor = new Compositor(live, overlay);
const segments = new SegmentRecorder(mime, bufferMs());
const archive = new ArchiveRecorder(mime);
const saveBar = new SaveBar();
const frameDelay = new FrameDelay(live, $<HTMLCanvasElement>('ts-frames'), () =>
  withBoxes() && compositor.running ? compositor.canvas : live,
);
const player = new TimeshiftPlayer(segments, [$<HTMLVideoElement>('ts-a'), $<HTMLVideoElement>('ts-b')], {
  seek: $<HTMLInputElement>('ts-seek'),
  label: tsLabel,
  playBtn: $<HTMLButtonElement>('ts-play'),
});

let stream: MediaStream | null = null; // 카메라 원본
let source: MediaStream | null = null; // 실제 녹화 소스 (원본 또는 박스 합성)
let facing: Facing = 'environment';
let split = false;
let muted = true;
let recTimer = 0;
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
  if (split && view === 'live') tsLive.srcObject = source;
};

function videoReady(v: HTMLVideoElement) {
  return v.readyState >= 1 ? Promise.resolve() : new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
}

/** 영상 입력 연결 — 단독 모드는 내 카메라, 인식 기기(/studio) 모드는 촬영 기기에서 받은 스트림 */
async function attach(next: MediaStream) {
  compositor.stop();
  if (stream !== next) stopStream(stream);
  stream = next;
  live.srcObject = stream;
  await videoReady(live);
  live.play().catch(() => {});
  source = withBoxes() ? compositor.start(stream) : stream;
  // 영상이 들어오는 동안 되감기 버퍼는 항상 쌓는다 (녹화 버튼과 무관)
  segments.start(source);
  inference.start();
  if (split) applyDelay(true);
  [btnRecord, btnSplit, btnFlip].forEach((b) => (b.disabled = false));
}

async function detach() {
  if (archive.recording) await stopRecording();
  if (split) toggleSplit();
  segments.stop();
  segments.clear();
  inference.stop();
  compositor.stop();
  stopStream(stream);
  stream = source = null;
  live.srcObject = null;
  [btnRecord, btnSplit, btnFlip].forEach((b) => (b.disabled = true));
}

const openCamera = async () => attach(await startCamera(facing));

btnCamera.onclick = async () => {
  if (stream) {
    await detach();
    btnCamera.textContent = '카메라 켜기';
    return;
  }
  try {
    await openCamera();
    keepAwake();
    btnCamera.textContent = '카메라 끄기';
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
  saveBar.pending = null;
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
  if (saved) saveBar.offer(saved);
}

btnRecord.onclick = async () => {
  if (!saveBar.confirmOverwrite()) return;
  saveBar.hide();
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
  split ? applyDelay(true) : stopDelayViews();
}

btnSplit.onclick = toggleSplit;
btnDetect.onclick = () => {
  inference.setEnabled(!inference.enabled);
  btnDetect.classList.toggle('on', inference.enabled);
  btnDetect.textContent = inference.enabled ? '인식 ON' : '인식 OFF';
};
selBuffer.onchange = () => segments.setMaxMs(bufferMs());

// --- 아래 패널 지연 설정 ---

type View = 'live' | 'frames' | 'segments';
let view: View | null = null;
tsDelay.value = localStorage.getItem('delay') ?? '5000';

function stopDelayViews() {
  player.hide();
  frameDelay.stop();
  tsLive.srcObject = null;
  view = null;
}

/** 선택한 지연에 맞는 표시 방식으로 전환. restart=false면 같은 방식 안에서는 이어서 진행 */
function applyDelay(restart = false) {
  const ms = Number(tsDelay.value);
  const next: View = ms === 0 ? 'live' : ms <= FRAME_DELAY_MAX_MS ? 'frames' : 'segments';
  tsPanel.dataset.view = next;

  if (next === 'frames' && view === 'frames' && !restart) {
    frameDelay.delay = ms; // 버퍼를 비우지 않고 지연만 변경
  } else {
    stopDelayViews();
    if (next === 'live') {
      tsLive.srcObject = source;
      tsLive.play().catch(() => {});
    } else if (next === 'frames') {
      frameDelay.start(ms);
    } else {
      player.show(ms);
    }
  }
  view = next;
  if (next !== 'segments') tsLabel.textContent = tsDelay.selectedOptions[0].text;
}

tsDelay.onchange = () => {
  localStorage.setItem('delay', tsDelay.value);
  if (split) applyDelay();
};

$('ts-back').onclick = () => player.skip(-10);
$('ts-fwd').onclick = () => player.skip(10);
$('ts-play').onclick = () => player.togglePause();
$('ts-latest').onclick = () => player.latest();
tsMute.onclick = () => {
  muted = !muted;
  tsMute.textContent = muted ? '🔇' : '🔊';
  player.setMuted(muted);
};

// --- 인식 기기 모드 (/studio 또는 studio.도메인): 촬영 기기(iPhone)에서 영상을 받아 인식 ---

if (location.pathname.startsWith('/studio') || location.hostname.startsWith('studio.')) {
  document.title = 'YOLO 인식';
  btnCamera.hidden = btnFlip.hidden = true;
  const bar = $('studio-bar');
  bar.hidden = false;
  const link = new StudioLink();
  const render = () => {
    $('studio-code').textContent = link.code;
    $<HTMLAnchorElement>('studio-url').textContent = link.cameraUrl;
    $('studio-state').textContent = link.state;
    bar.classList.toggle('connected', !!stream);
  };
  link.onState = render;
  link.onStream = async (remote) => {
    await attach(remote);
    keepAwake();
    render();
  };
  link.onLost = async () => {
    await detach();
    render();
  };
  // 인식 결과를 촬영 기기로 돌려보내 iPhone 화면에도 박스 표시
  inference.onResult = (dets) => link.send(toMessage(dets, live.videoWidth, live.videoHeight));
  render();
}

registerPWA();
