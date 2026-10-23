import type { Backend, DetectOptions, Detection } from './detector';
import type { WorkerRequest, WorkerResponse } from './detector.worker';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Request = DistributiveOmit<WorkerRequest, 'id'>;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (r: WorkerResponse & { ok: true }) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (data.ok) p?.resolve(data);
    else p?.reject(new Error(data.error));
  };
  worker.onerror = (e) => {
    pending.forEach((p) => p.reject(new Error(`추론 워커 오류: ${e.message}`)));
    pending.clear();
  };
  return worker;
}

function request(msg: Request, transfer: Transferable[] = []) {
  const id = nextId++;
  return new Promise<WorkerResponse & { ok: true }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

/** 메인 스레드용 얇은 프록시: 프레임만 떠서 워커로 넘기고 결과를 받는다 */
export class RemoteDetector {
  private constructor(
    private url: string,
    readonly backend: Backend,
    readonly pose: boolean,
  ) {}

  static async load(url: string, pose = false) {
    const r = await request({ type: 'load', url, pose });
    return new RemoteDetector(url, r.backend!, pose);
  }

  async detect(video: HTMLVideoElement, opts: DetectOptions): Promise<Detection[]> {
    const frame = await createImageBitmap(video);
    const r = await request({ type: 'detect', url: this.url, frame, opts }, [frame]);
    return r.dets!;
  }
}
