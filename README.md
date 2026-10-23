# YOLO Live Recorder

브라우저에서 공연을 촬영하면서 YOLO로 사람/사물을 실시간 인식하고, 화면 분할로 방금 찍은 장면을 되감아 보는 웹앱.

## 페이지

| 주소 | 기기 | 하는 일 |
|---|---|---|
| `cam.letgomin.com` (`/camera`) | iPhone | 촬영 + 원본 녹화(iPhone에 저장) + 인식 기기로 영상 전송, 받은 인식 박스 표시 |
| `studio.letgomin.com` (`/studio`) | 맥북 · 아이패드 | 받은 영상으로 YOLO 인식, 카테고리 모드, 화면 분할 되감기, 박스 포함 녹화 |
| `/` | 한 기기 | 위 기능 전부를 한 기기에서 (단독 모드) |

### 공연장에서 쓰는 법

1. iPhone 개인용 핫스팟을 켜고 맥북/아이패드를 연결 (영상은 핫스팟 안에서 기기끼리 직접 전송)
2. 맥북/아이패드에서 `studio.letgomin.com` → 화면에 6자리 코드 표시
3. iPhone에서 `cam.letgomin.com` → 카메라 켜기 → 코드 입력 → 연결
4. 녹화는 iPhone(원본)과 인식 기기(원본/박스 포함) 각각에서 가능

연결(시그널링)에만 PeerJS 공개 서버를 쓰므로 처음 연결할 때 인터넷이 필요합니다 (핫스팟의 셀룰러 데이터면 충분).

### 인식 백엔드

- 맥북 Chrome: WebGPU
- Safari, 아이패드, iPhone(모든 브라우저가 WebKit): WASM — WebKit에서 ort WebGPU가 메모리를 해제하지 않아 탭이 강제 종료되는 문제가 있어 자동으로 WASM 사용

## 개발

```sh
npm install
npm run dev          # http://localhost:5173 (/, /camera, /studio)
npm run dev:https    # 같은 Wi-Fi의 iPhone에서 https://<PC IP>:5173 (카메라는 HTTPS 필수)
```

모델 재생성: `python3 -m venv .venv && .venv/bin/pip install ultralytics onnx onnxslim && .venv/bin/python scripts/export_models.py`
(모델을 바꾸면 `public/sw.js`의 `CACHE` 버전도 올릴 것)

## 배포 (Vercel + letgomin.com)

1. [vercel.com](https://vercel.com) → **Add New → Project** → GitHub `77romin/yolo_webApp` Import → 그대로 **Deploy**
   (빌드 설정과 COOP/COEP 헤더는 `vercel.json`에 있음. 이후 `main`에 push하면 자동 배포)
2. 프로젝트 **Settings → Domains** 에서 `cam.letgomin.com`, `studio.letgomin.com` 추가
3. letgomin.com DNS 관리 화면에서 Vercel이 안내하는 값으로 CNAME 2개 추가
   - `cam` → (Vercel이 표시한 CNAME 값)
   - `studio` → (같은 값)
4. Vercel에서 도메인 상태가 Valid가 되면 HTTPS 인증서까지 자동 발급

> Ultralytics YOLO 모델은 AGPL-3.0 라이선스입니다. 공개 배포 시 소스 공개 의무가 있습니다 (이 저장소가 공개라면 충족).
