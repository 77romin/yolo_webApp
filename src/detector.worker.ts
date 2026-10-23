import { Detector, type Backend, type DetectOptions, type Detection } from './detector';

/**
 * 추론 전용 워커. ort WASM은 호출한 스레드에서도 연산하므로 메인 스레드에서 돌리면
 * MediaRecorder 이벤트·영상 로딩·타이머가 굶어서 되감기 녹화가 멈춘다 (Safari에서 재현).
 */
export type WorkerRequest =
  | { id: number; type: 'load'; url: string; pose: boolean }
  | { id: number; type: 'detect'; url: string; frame: ImageBitmap; opts: DetectOptions };

export type WorkerResponse =
  | { id: number; ok: true; backend?: Backend; dets?: Detection[] }
  | { id: number; ok: false; error: string };

const detectors = new Map<string, Promise<Detector>>();

function detectorFor(url: string, pose: boolean) {
  let d = detectors.get(url);
  if (!d) {
    d = Detector.load(url, pose);
    d.catch(() => detectors.delete(url)); // 실패하면 다음에 재시도
    detectors.set(url, d);
  }
  return d;
}

const reply = (msg: WorkerResponse) => postMessage(msg);

onmessage = async ({ data: req }: MessageEvent<WorkerRequest>) => {
  try {
    if (req.type === 'load') {
      const det = await detectorFor(req.url, req.pose);
      reply({ id: req.id, ok: true, backend: det.backend });
    } else {
      try {
        const det = await detectors.get(req.url)!;
        reply({ id: req.id, ok: true, dets: await det.detect(req.frame, req.opts) });
      } finally {
        req.frame.close();
      }
    }
  } catch (e) {
    reply({ id: req.id, ok: false, error: (e as Error).message });
  }
};
