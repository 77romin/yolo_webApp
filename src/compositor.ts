/**
 * "박스 포함 녹화"용 합성기. 카메라 프레임마다 영상 + 인식 오버레이를
 * 한 캔버스에 그리고, 그 캔버스를 카메라 오디오와 묶어 녹화용 스트림으로 내보낸다.
 */
export class Compositor {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private output: MediaStream | null = null;

  constructor(
    private video: HTMLVideoElement,
    private overlay: HTMLCanvasElement,
  ) {}

  get running() {
    return this.output !== null;
  }

  /** video에 메타데이터가 로드된 뒤 호출해야 함 */
  start(camera: MediaStream): MediaStream {
    this.stop();
    this.draw();
    const track = this.canvas.captureStream(30).getVideoTracks()[0];
    this.output = new MediaStream([track, ...camera.getAudioTracks()]);
    this.loop();
    return this.output;
  }

  stop() {
    // 오디오는 카메라 스트림 소유이므로 합성 영상 트랙만 정지
    this.output?.getVideoTracks().forEach((t) => t.stop());
    this.output = null;
  }

  private loop() {
    if (!this.output) return;
    const v = this.video;
    const next = () => {
      this.draw();
      this.loop();
    };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  }

  private draw() {
    const { canvas, ctx, video, overlay } = this;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    if (overlay.width === w && overlay.height === h) ctx.drawImage(overlay, 0, 0);
  }
}
