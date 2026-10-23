// 촬영 기기(iPhone) 페이지: 촬영 + 원본 녹화 + 인식 기기로 영상 전송, 받은 인식 결과를 화면에 표시.
// 인식(YOLO)은 여기서 돌리지 않는다 — 발열·메모리 부담을 인식 기기(맥북·아이패드)로 넘김.
import { ArchiveRecorder } from './archiveRecorder';
import { keepAwake, startCamera, stopStream, type Facing } from './camera';
import { CameraLink, type DetMessage } from './link';
import { formatClock, pickMimeType } from './media';
import { drawDetections } from './overlay';
import { registerPWA } from './pwa';
import { SaveBar } from './saveBar';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const btnCamera = $<HTMLButtonElement>('btn-camera');
const btnRecord = $<HTMLButtonElement>('btn-record');
const btnFlip = $<HTMLButtonElement>('btn-flip');
const btnBoxes = $<HTMLButtonElement>('btn-boxes');
const btnLink = $<HTMLButtonElement>('btn-link');
const codeInput = $<HTMLInputElement>('code');
const linkState = $('link-state');
const status = $('status');
const live = $<HTMLVideoElement>('live');
const overlay = $<HTMLCanvasElement>('overlay');
const recTime = $('rec-time');

const mime = pickMimeType();
const archive = new ArchiveRecorder(mime);
const saveBar = new SaveBar();
const link = new CameraLink();
const octx = overlay.getContext('2d')!;

let stream: MediaStream | null = null;
let facing: Facing = 'environment';
let recTimer = 0;
let showBoxes = true;
let clearTimer = 0;

status.textContent = mime.split(';')[0];
codeInput.value = new URLSearchParams(location.search).get('code') ?? localStorage.getItem('studio-code-input') ?? '';

// --- 카메라 ---

async function openCamera() {
  const next = await startCamera(facing);
  stopStream(stream);
  stream = next;
  live.srcObject = stream;
  if (link.active) link.replaceStream(stream);
}

btnCamera.onclick = async () => {
  if (stream) {
    if (archive.recording) await stopRecording();
    link.disconnect();
    stopStream(stream);
    stream = null;
    live.srcObject = null;
    btnCamera.textContent = '카메라 켜기';
    [btnRecord, btnFlip, btnLink].forEach((b) => (b.disabled = true));
    renderLink();
    return;
  }
  try {
    await openCamera();
    keepAwake();
    btnCamera.textContent = '카메라 끄기';
    [btnRecord, btnFlip, btnLink].forEach((b) => (b.disabled = false));
    if (codeInput.value.length === 6) connect(); // 저장된 코드가 있으면 바로 연결
  } catch (e) {
    status.textContent = `카메라 오류: ${(e as Error).message}`;
  }
};

btnFlip.onclick = async () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  await openCamera();
};

// --- 원본 녹화 (iPhone에 저장) ---

async function startRecording() {
  saveBar.pending = null;
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
  status.textContent = '저장 중…';
  const saved = await archive.stop();
  status.textContent = mime.split(';')[0];
  if (saved) saveBar.offer(saved);
}

btnRecord.onclick = async () => {
  if (!saveBar.confirmOverwrite()) return;
  saveBar.hide();
  btnRecord.disabled = true;
  try {
    archive.recording ? await stopRecording() : await startRecording();
  } catch (e) {
    status.textContent = `녹화 오류: ${(e as Error).message}`;
  } finally {
    btnRecord.disabled = false;
  }
};

// --- 인식 기기 연결 ---

function connect() {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    linkState.textContent = '코드는 숫자 6자리';
    return;
  }
  localStorage.setItem('studio-code-input', code);
  link.connect(code, stream!);
  renderLink();
}

function renderLink() {
  btnLink.textContent = link.active ? '연결 끊기' : '연결';
  btnLink.classList.toggle('on', link.connected);
  codeInput.disabled = link.active;
  linkState.textContent = link.state;
}

btnLink.onclick = () => (link.active ? link.disconnect() : connect());
link.onState = renderLink;

// 인식 결과를 내 영상 크기로 환산해서 그림. 1초 넘게 안 오면 지움(끊김/인식 OFF)
link.onDetections = (msg: DetMessage) => {
  clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => octx.clearRect(0, 0, overlay.width, overlay.height), 1000);
  if (!showBoxes || !live.videoWidth) return;
  if (overlay.width !== live.videoWidth || overlay.height !== live.videoHeight) {
    overlay.width = live.videoWidth;
    overlay.height = live.videoHeight;
  }
  const sx = overlay.width / msg.w;
  const sy = overlay.height / msg.h;
  const dets = msg.dets.map((d) => ({
    ...d,
    x: d.x * sx,
    y: d.y * sy,
    w: d.w * sx,
    h: d.h * sy,
    keypoints: d.keypoints && Float32Array.from(d.keypoints, (v, i) => (i % 3 === 0 ? v * sx : i % 3 === 1 ? v * sy : v)),
  }));
  octx.clearRect(0, 0, overlay.width, overlay.height);
  drawDetections(octx, dets);
};

btnBoxes.onclick = () => {
  showBoxes = !showBoxes;
  btnBoxes.classList.toggle('on', showBoxes);
  if (!showBoxes) octx.clearRect(0, 0, overlay.width, overlay.height);
};

registerPWA();
