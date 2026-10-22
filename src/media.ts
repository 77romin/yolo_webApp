// MP4 우선: iPhone Safari는 MP4만, 최신 Chrome도 MP4 녹화를 지원. 안 되면 WebM.
const CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMimeType(): string {
  const mime = CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('이 브라우저는 영상 녹화(MediaRecorder)를 지원하지 않습니다');
  return mime;
}

export function extensionFor(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
