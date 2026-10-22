import type { Detection, Detector } from './detector';
import { drawDetections } from './overlay';

export interface DetectOptions {
  minScore: number;
  classes?: Set<number>;
}

/**
 * 라이브 영상 위에서 추론을 반복한다. 녹화와는 독립적으로,
 * 이전 추론이 끝났을 때 가장 최신 프레임만 처리한다(밀리면 프레임을 건너뜀).
 */
export class LiveInference {
  detections: Detection[] = [];
  fps = 0;
  enabled = true;
  detector: Detector | null = null;
  options: DetectOptions = { minScore: 0.35 };

  private ctx: CanvasRenderingContext2D;
  private busy = false;
  private running = false;
  private lastResult = 0;

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    this.clear();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.clear();
  }

  private clear() {
    this.detections = [];
    this.fps = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private schedule() {
    if (!this.running) return;
    const v = this.video;
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(() => this.tick());
    else requestAnimationFrame(() => this.tick());
  }

  private tick() {
    this.schedule();
    const v = this.video;
    if (!this.enabled || !this.detector || this.busy || v.readyState < 2 || !v.videoWidth) return;

    this.busy = true;
    const detector = this.detector;
    detector
      .detect(v, this.options)
      .then((dets) => {
        // 그 사이 모델이 바뀌었거나 꺼졌으면 버림
        if (!this.enabled || detector !== this.detector) return;
        this.detections = dets;
        this.draw();
        const now = performance.now();
        if (this.lastResult) this.fps = this.fps * 0.8 + (1000 / (now - this.lastResult)) * 0.2;
        this.lastResult = now;
      })
      .catch((e) => console.error('추론 오류', e))
      .finally(() => (this.busy = false));
  }

  private draw() {
    const { canvas, video } = this;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawDetections(this.ctx, this.detections);
  }
}
