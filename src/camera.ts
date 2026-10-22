export type Facing = 'environment' | 'user';

export async function startCamera(facing: Facing): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('이 브라우저는 카메라를 지원하지 않습니다 (HTTPS로 접속했는지 확인하세요)');
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    // 공연 촬영이므로 마이크 처리(에코 제거 등)는 끈다 — 음악이 깎이지 않게
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

// 녹화 중 화면이 꺼지면 iOS가 카메라를 끊으므로 Wake Lock 유지
let wakeLock: WakeLockSentinel | null = null;

export async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // 미지원 또는 거부 — 무시
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock?.released) keepAwake();
});
