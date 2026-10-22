export interface Segment {
  id: number;
  start: number; // epoch ms
  end: number; // epoch ms
  url: string;
}

interface ActiveRecorder {
  rec: MediaRecorder;
  stop: () => void;
}

/**
 * 되감기용 롤링 녹화. MediaRecorder를 segMs마다 새로 띄워 각 조각이
 * 독립적으로 재생 가능한 파일이 되게 하고, 최근 maxMs만 메모리에 유지한다.
 */
export class SegmentRecorder {
  segments: Segment[] = [];
  onSegment?: (seg: Segment) => void;
  onPrune?: (removed: Segment[]) => void;

  private stream: MediaStream | null = null;
  private current: ActiveRecorder | null = null;
  private timer = 0;
  private nextId = 0;

  constructor(
    private mimeType: string,
    public maxMs: number,
    private segMs = 3000,
    private bitrate = 2_500_000,
  ) {}

  get running() {
    return this.timer !== 0;
  }

  /** 새 스트림으로 (재)시작. 이전 버퍼는 비운다. */
  start(stream: MediaStream) {
    this.stop();
    this.clear();
    this.stream = stream;
    this.rotate();
    this.timer = window.setInterval(() => this.rotate(), this.segMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.current?.stop();
    this.current = null;
  }

  clear() {
    this.segments.forEach((s) => URL.revokeObjectURL(s.url));
    this.segments = [];
  }

  setMaxMs(ms: number) {
    this.maxMs = ms;
    this.prune();
  }

  /** 다음 조각을 먼저 시작한 뒤 이전 조각을 멈춰 끊김을 최소화 */
  private rotate() {
    const prev = this.current;
    this.current = this.spawn();
    prev?.stop();
  }

  private spawn(): ActiveRecorder {
    const rec = new MediaRecorder(this.stream!, {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.bitrate,
    });
    const chunks: Blob[] = [];
    const id = this.nextId++;
    let start = 0;
    let end = 0;

    rec.onstart = () => (start = Date.now());
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      if (!chunks.length || !start) return;
      const blob = new Blob(chunks, { type: this.mimeType });
      const seg: Segment = { id, start, end: end || Date.now(), url: URL.createObjectURL(blob) };
      // 조각들의 onstop 순서가 뒤바뀌어도 id 순으로 정렬 유지
      const at = this.segments.findIndex((s) => s.id > id);
      at === -1 ? this.segments.push(seg) : this.segments.splice(at, 0, seg);
      this.onSegment?.(seg);
      this.prune();
    };
    rec.start();

    return {
      rec,
      stop: () => {
        end = Date.now();
        if (rec.state !== 'inactive') rec.stop();
      },
    };
  }

  private prune() {
    const last = this.segments.at(-1);
    if (!last) return;
    const removed: Segment[] = [];
    while (this.segments.length > 1 && last.end - this.segments[0].start > this.maxMs) {
      removed.push(this.segments.shift()!);
    }
    if (!removed.length) return;
    this.onPrune?.(removed);
    removed.forEach((s) => URL.revokeObjectURL(s.url));
  }
}
