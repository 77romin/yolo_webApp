"""YOLO 가중치를 웹용 ONNX로 변환해 public/models/ 에 저장한다.

사용법:
    python3 -m venv .venv && .venv/bin/pip install ultralytics onnx onnxslim
    .venv/bin/python scripts/export_models.py

입력 크기는 모바일 속도를 위해 416 고정(동적 shape은 WebGPU에서 느림).
NMS는 브라우저(JS)에서 모드별 클래스 필터와 함께 처리하므로 모델에 넣지 않는다.
"""

import shutil
import tempfile
from pathlib import Path

from ultralytics import YOLO

IMGSZ = 416
MODELS = ["yolo11n.pt", "yolo11n-pose.pt"]
OUT = Path(__file__).resolve().parent.parent / "public" / "models"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name in MODELS:
            weights = Path(tmp) / name
            model = YOLO(str(weights))  # 없으면 tmp에 자동 다운로드
            onnx_path = model.export(format="onnx", imgsz=IMGSZ, opset=17, simplify=True, dynamic=False)
            dest = OUT / Path(onnx_path).name
            shutil.copy(onnx_path, dest)
            print(f"→ {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
