import { formatClock } from './media';
import type { Segment, SegmentRecorder } from './segmentRecorder';

interface TimeshiftUI {
  seek: HTMLInputElement;
  label: HTMLElement;
  playBtn: HTMLButtonElement;
}

/**
 * 아래 패널 플레이어. 비디오 2개를 번갈아 쓰면서 다음 조각을 미리 로드해
 * 조각 경계에서 끊김을 줄인다. 위치는 "녹화 시각(epoch ms)" 기준으로 다룬다.
 */
export class TimeshiftPlayer {
  paused = false;
  private active = 0;
  private current: Segment | null = null;
  private preloaded: Segment | null = null;
  private waitingForNext = false;
  private dragging = false;
  private uiTimer = 0;
  private loadToken = 0;
  /**
   * 목표 지연(라이브보다 몇 ms 뒤를 보여줄지). 조각의 실제 길이가 시작 간격보다 조금 길고(Safari ~3.1초/3초),
   * 로딩이 늦어지기도 해서 그냥 이어 재생하면 지연이 계속 늘어난다 → 이 값에 맞춰 위치를 보정.
   */
  private delayMs = 0;

  constructor(
    private buf: SegmentRecorder,
    private videos: [HTMLVideoElement, HTMLVideoElement],
    private ui: TimeshiftUI,
  ) {
    for (const v of videos) {
      v.addEventListener('ended', () => v === this.video && this.advance());
    }
    buf.onSegment = () => {
      if (this.waitingForNext) this.advance();
      else if (this.current && !this.preloaded) this.preloadNext();
    };
    buf.onPrune = (removed) => {
      if (this.current && removed.includes(this.current)) this.seekTo(0);
      if (this.preloaded && removed.includes(this.preloaded)) this.preloaded = null;
    };

    ui.seek.addEventListener('input', () => {
      this.dragging = true;
      const first = buf.segments[0];
      if (first) this.renderLabel(first.start + Number(ui.seek.value) * 1000);
    });
    ui.seek.addEventListener('change', () => {
      this.dragging = false;
      const first = buf.segments[0];
      if (first) this.seekTo(first.start + Number(ui.seek.value) * 1000);
    });
  }

  private get video() {
    return this.videos[this.active];
  }

  private get spare() {
    return this.videos[1 - this.active];
  }

  /** 현재 재생 위치 (epoch ms) */
  get position(): number | null {
    return this.current ? this.current.start + this.video.currentTime * 1000 : null;
  }

  /** delayMs 전 시점부터 재생 시작 */
  show(delayMs: number) {
    clearInterval(this.uiTimer);
    this.uiTimer = window.setInterval(() => this.renderUI(), 250);
    this.delayMs = delayMs;
    this.jumpTo(Date.now() - delayMs);
  }

  hide() {
    clearInterval(this.uiTimer);
    this.videos.forEach((v) => {
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
    this.current = this.preloaded = null;
    this.waitingForNext = false;
  }

  /** 사용자가 위치를 옮김 → 그 위치의 지연을 새 목표로 */
  seekTo(t: number) {
    const segs = this.buf.segments;
    if (segs.length) t = Math.min(Math.max(t, segs[0].start), segs.at(-1)!.end);
    this.delayMs = Date.now() - t;
    this.jumpTo(t);
  }

  private jumpTo(t: number) {
    const segs = this.buf.segments;
    if (!segs.length) {
      this.current = null;
      this.waitingForNext = true;
      return;
    }
    t = Math.min(Math.max(t, segs[0].start), segs.at(-1)!.end);
    const seg = segs.find((s) => t < s.end) ?? segs.at(-1)!;
    this.load(seg, (t - seg.start) / 1000);
  }

  skip(seconds: number) {
    const pos = this.position;
    if (pos !== null) this.seekTo(pos + seconds * 1000);
  }

  /** 가장 최근 조각으로 (라이브보다 약 3~6초 뒤) */
  latest() {
    const last = this.buf.segments.at(-1);
    if (last) this.seekTo(last.start);
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) this.video.pause();
    else {
      this.video.play().catch(() => {});
      const pos = this.position;
      if (pos !== null) this.delayMs = Date.now() - pos; // 멈춰 있던 만큼 지연이 늘어난 상태로 이어서
    }
    this.ui.playBtn.textContent = this.paused ? '▶' : '⏸';
  }

  setMuted(muted: boolean) {
    for (const v of this.videos) v.muted = muted;
    // iOS: 소리 있는 재생은 사용자 탭 안에서 한 번 허용받아야 하므로, 다음 조각용 비디오도 지금 잠금 해제
    const spare = this.spare;
    if (!muted) spare.play().then(() => spare !== this.video && spare.pause(), () => {});
  }

  private load(seg: Segment, offset: number) {
    const v = this.video;
    const token = ++this.loadToken;
    this.current = seg;
    this.preloaded = null;
    this.waitingForNext = false;
    v.src = seg.url;
    v.addEventListener(
      'loadedmetadata',
      () => {
        if (token !== this.loadToken) return; // 그 사이 다른 위치로 이동함
        if (offset > 0) {
          v.currentTime = Number.isFinite(v.duration) ? Math.min(offset, v.duration - 0.05) : offset;
        }
        if (!this.paused) v.play().catch(() => {});
      },
      { once: true },
    );
    this.preloadNext();
  }

  private nextOf(seg: Segment) {
    return this.buf.segments.find((s) => s.id > seg.id) ?? null;
  }

  private preloadNext() {
    const next = this.current && this.nextOf(this.current);
    if (!next) return;
    this.spare.src = next.url;
    this.spare.preload = 'auto';
    this.spare.load();
    this.preloaded = next;
  }

  private advance() {
    if (!this.current) return this.jumpTo(Date.now() - this.delayMs); // 첫 조각 도착 — 목표 지연 유지
    const next = this.nextOf(this.current);
    if (!next) {
      this.waitingForNext = true; // 라이브 직전까지 따라잡음 → 다음 조각 대기
      return;
    }
    this.waitingForNext = false;
    if (this.preloaded?.id !== next.id) return this.load(next, 0);

    this.video.classList.remove('active');
    this.active = 1 - this.active;
    this.video.classList.add('active');
    this.current = next;
    this.preloaded = null;
    // 밀린 만큼 다음 조각 안에서 앞으로 건너뛰어 목표 지연 유지
    const behind = (Date.now() - this.delayMs - next.start) / 1000;
    const dur = this.video.duration;
    this.video.currentTime = behind > 0.2 ? (Number.isFinite(dur) ? Math.min(behind, dur - 0.1) : behind) : 0;
    if (!this.paused) this.video.play().catch(() => {});
    this.preloadNext();
  }

  private renderUI() {
    const segs = this.buf.segments;
    if (!segs.length) return;
    const first = segs[0].start;
    const last = segs.at(-1)!.end;
    this.ui.seek.max = String((last - first) / 1000);
    const pos = this.position;
    if (pos === null || this.dragging) return;
    this.ui.seek.value = String((pos - first) / 1000);
    this.renderLabel(pos);
    this.correctDrift(pos, last);
  }

  /** 로딩 지연 등으로 목표보다 1.5초 넘게 밀리면 목표 위치로 이동 */
  private correctDrift(pos: number, bufferEnd: number) {
    const v = this.video;
    if (this.paused || v.paused || v.readyState < 3) return; // 로딩 중에는 판단하지 않음
    const target = Date.now() - this.delayMs;
    if (Math.abs(target - pos) < 1500 || target > bufferEnd - 500) return; // 버퍼 끝을 넘는 목표는 따라갈 수 없음
    this.jumpTo(target);
  }

  private renderLabel(pos: number) {
    this.ui.label.textContent = `-${formatClock(Date.now() - pos)}`;
  }
}
