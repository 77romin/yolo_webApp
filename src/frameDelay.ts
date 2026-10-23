/** 프레임 지연 방식으로 보여줄 수 있는 최대 지연 — 그 이상은 녹화 조각 재생 */
export const FRAME_DELAY_MAX_MS = 2000;
const MAX_WIDTH = 640; // 메모리 절약: 2초 × 30fps × 640×360 ≈ 55MB

/**
 * 짧은 지연(-0.5초 등)용. 녹화 조각은 3초 단위라 그보다 짧은 지연을 만들 수 없으므로,
 * 최근 프레임을 축소해 메모리에 들고 있다가 delay 만큼 늦게 캔버스에 그린다. (영상만, 소리 없음)
 */
export class FrameDelay {
  delay = 0;
  private frames: { t: number; bmp: ImageBitmap }[] = [];
  private grab = new OffscreenCanvas(1, 1);
  private grabCtx = this.grab.getContext('2d')!;
  private ctx: CanvasRenderingContext2D;
  private running = false;
  private drawn: ImageBitmap | null = null;

  constructor(
    private video: HTMLVideoElement, // 새 프레임 타이밍 기준
    private canvas: HTMLCanvasElement,
    private source: () => HTMLVideoElement | HTMLCanvasElement, // 원본 영상 또는 박스 합성 캔버스
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  start(delayMs: number) {
    this.delay = delayMs;
    if (this.running) return;
    this.running = true;
    this.capture();
    this.render();
  }

  stop() {
    this.running = false;
    this.frames.forEach((f) => f.bmp.close());
    this.frames = [];
    this.drawn = null;
  }

  private capture() {
    if (!this.running) return;
    const v = this.video;
    const next = () => {
      this.grabFrame();
      this.capture();
    };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  }

  private grabFrame() {
    const src = this.source();
    const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
    const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
    if (!sw || !sh) return;
    const w = Math.min(MAX_WIDTH, sw);
    const h = Math.round((sh * w) / sw);
    if (this.grab.width !== w || this.grab.height !== h) {
      this.grab.width = w;
      this.grab.height = h;
    }
    this.grabCtx.drawImage(src, 0, 0, w, h);
    const now = performance.now();
    this.frames.push({ t: now, bmp: this.grab.transferToImageBitmap() });

    // 지금 보여줄 프레임(= now - delay 이전의 가장 최근 것)보다 오래된 프레임은 버림
    while (this.frames.length > 1 && this.frames[1].t <= now - this.delay) {
      this.frames.shift()!.bmp.close();
    }
  }

  private render() {
    if (!this.running) return;
    requestAnimationFrame(() => this.render());
    const target = performance.now() - this.delay;
    // 지연을 막 늘렸으면 버퍼가 찰 때까지 가장 오래된 프레임에 머문다
    let frame = this.frames[0];
    for (const f of this.frames) {
      if (f.t > target) break;
      frame = f;
    }
    if (!frame || frame.bmp === this.drawn) return;
    const { canvas } = this;
    if (canvas.width !== frame.bmp.width || canvas.height !== frame.bmp.height) {
      canvas.width = frame.bmp.width;
      canvas.height = frame.bmp.height;
    }
    this.ctx.drawImage(frame.bmp, 0, 0);
    this.drawn = frame.bmp;
  }
}
