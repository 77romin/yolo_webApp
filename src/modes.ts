import type { DetectOptions } from './detector';
import { RemoteDetector } from './detectorClient';

export interface Mode {
  id: string;
  label: string;
  model: string; // public/models/ 아래 파일명
  pose?: boolean;
  options: DetectOptions;
}

// 새 카테고리는 여기에 추가 (예: 악기 등 커스텀 학습 모델 → model만 바꿔서 등록)
export const MODES: Mode[] = [
  { id: 'all', label: '전체', model: 'yolo11n.onnx', options: { minScore: 0.35 } },
  { id: 'person', label: '사람', model: 'yolo11n.onnx', options: { minScore: 0.4, classes: new Set([0]) } },
  { id: 'pose', label: '동작', model: 'yolo11n-pose.onnx', pose: true, options: { minScore: 0.4 } },
];

const cache = new Map<string, Promise<RemoteDetector>>();

/** 모드가 쓰는 모델을 로드(같은 모델은 한 번만) */
export function detectorFor(mode: Mode): Promise<RemoteDetector> {
  let d = cache.get(mode.model);
  if (!d) {
    d = RemoteDetector.load(`${import.meta.env.BASE_URL}models/${mode.model}`, mode.pose);
    d.catch(() => cache.delete(mode.model)); // 실패하면 다음에 재시도
    cache.set(mode.model, d);
  }
  return d;
}
