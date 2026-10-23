import * as ort from 'onnxruntime-web/webgpu';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

export interface Detection {
  x: number; // 원본 영상 픽셀 기준 좌상단
  y: number;
  w: number;
  h: number;
  score: number;
  cls: number;
  keypoints?: Float32Array; // pose 모델: 17 × (x, y, conf)
}

export type Backend = 'webgpu' | 'wasm';

export interface DetectOptions {
  minScore: number;
  classes?: Set<number>;
  iou?: number;
}

const SIZE = 416; // scripts/export_models.py 의 IMGSZ 와 같아야 함

// ort 런타임을 별도 파일로 로드. 번들에 섞이면 멀티스레드 워커가 앱 번들(index.js)을
// 워커 스크립트로 실행해 죽는다 (document is not defined)
ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
// 멀티스레드 WASM은 crossOriginIsolated(COOP/COEP 헤더)일 때만 가능
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

// WebKit(Safari, 그리고 iPhone의 모든 브라우저)에서는 ort WebGPU가 추론할 때마다 메모리를 해제하지 않아
// 초당 ~100MB씩 늘어나 iPhone에서 10~15초 만에 탭이 강제 종료된다. WASM은 메모리가 일정하므로 WASM 사용.
// (iOS Chrome UA에는 'Chrome/'가 없고 'CriOS/'가 있음)
const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);

/** 실제 추론. 메인 스레드를 막지 않도록 detector.worker.ts 안에서만 사용한다 */
export class Detector {
  private canvas = new OffscreenCanvas(SIZE, SIZE);
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  private input = new Float32Array(3 * SIZE * SIZE);

  private constructor(
    private session: ort.InferenceSession,
    readonly backend: Backend,
    readonly pose: boolean,
  ) {}

  /** WebGPU 우선(WebKit 제외), 실패하면 WASM */
  static async load(url: string, pose = false): Promise<Detector> {
    const errors: string[] = [];
    for (const backend of ['webgpu', 'wasm'] as Backend[]) {
      if (backend === 'webgpu' && (isWebKit || !('gpu' in navigator))) continue;
      try {
        const session = await ort.InferenceSession.create(url, {
          executionProviders: [backend],
          graphOptimizationLevel: 'all',
        });
        return new Detector(session, backend, pose);
      } catch (e) {
        errors.push(`${backend}: ${(e as Error).message}`);
      }
    }
    throw new Error(`모델 로드 실패 — ${errors.join(' / ')}`);
  }

  async detect(source: ImageBitmap, opts: DetectOptions) {
    const vw = source.width;
    const vh = source.height;
    const scale = Math.min(SIZE / vw, SIZE / vh);
    const dw = Math.round(vw * scale);
    const dh = Math.round(vh * scale);
    const padX = (SIZE - dw) / 2;
    const padY = (SIZE - dh) / 2;

    this.ctx.fillStyle = 'rgb(114,114,114)'; // Ultralytics letterbox 회색
    this.ctx.fillRect(0, 0, SIZE, SIZE);
    this.ctx.drawImage(source, padX, padY, dw, dh);
    const px = this.ctx.getImageData(0, 0, SIZE, SIZE).data;

    // RGBA(HWC, 0~255) → RGB(CHW, 0~1)
    const area = SIZE * SIZE;
    const input = this.input;
    for (let i = 0, p = 0; i < area; i++, p += 4) {
      input[i] = px[p] / 255;
      input[i + area] = px[p + 1] / 255;
      input[i + 2 * area] = px[p + 2] / 255;
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
    const out = await this.session.run({ [this.session.inputNames[0]]: tensor });
    const result = out[this.session.outputNames[0]];
    const data = (await result.getData()) as Float32Array;
    tensor.dispose();
    result.dispose();

    const [, channels, n] = result.dims as number[];
    const dets = this.decode(data, channels, n, opts.minScore, opts.classes);
    return nms(dets, opts.iou ?? 0.45).map((d) => unletterbox(d, scale, padX, padY));
  }

  /** 출력 [1, C, N] — C = 4(box) + 클래스 점수들 (pose: 4 + 1 + 17×3) */
  private decode(data: Float32Array, channels: number, n: number, minScore: number, classes?: Set<number>) {
    const dets: Detection[] = [];
    const numClasses = this.pose ? 1 : channels - 4;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let cls = 0;
      for (let c = 0; c < numClasses; c++) {
        const s = data[(4 + c) * n + i];
        if (s > best && (!classes || classes.has(c))) {
          best = s;
          cls = c;
        }
      }
      if (best < minScore) continue;
      const cx = data[i];
      const cy = data[n + i];
      const w = data[2 * n + i];
      const h = data[3 * n + i];
      const det: Detection = { x: cx - w / 2, y: cy - h / 2, w, h, score: best, cls };
      if (this.pose) {
        const kp = new Float32Array(51);
        for (let k = 0; k < 51; k++) kp[k] = data[(5 + k) * n + i];
        det.keypoints = kp;
      }
      dets.push(det);
    }
    return dets;
  }
}

function iou(a: Detection, b: Detection) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** 클래스별 NMS */
function nms(dets: Detection[], threshold: number) {
  dets.sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of dets) {
    if (kept.every((k) => k.cls !== d.cls || iou(k, d) < threshold)) kept.push(d);
    if (kept.length >= 100) break;
  }
  return kept;
}

function unletterbox(d: Detection, scale: number, padX: number, padY: number): Detection {
  if (d.keypoints) {
    for (let k = 0; k < 51; k += 3) {
      d.keypoints[k] = (d.keypoints[k] - padX) / scale;
      d.keypoints[k + 1] = (d.keypoints[k + 1] - padY) / scale;
    }
  }
  return { ...d, x: (d.x - padX) / scale, y: (d.y - padY) / scale, w: d.w / scale, h: d.h / scale };
}
