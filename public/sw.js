// 오프라인 캐시: 공연장처럼 네트워크가 약한 곳에서도 앱과 모델이 열리도록
const CACHE = 'yolo-live-v1';
const MODELS = ['models/yolo11n.onnx', 'models/yolo11n-pose.onnx'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...MODELS])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 페이지가 이미 받아 둔 리소스(서비스워커 설치 전에 로드된 JS/CSS/wasm) 목록을 받아 캐시
self.addEventListener('message', (e) => {
  const urls = e.data?.cache;
  if (!Array.isArray(urls)) return;
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(urls.map(async (u) => (await c.match(u)) || c.add(u).catch(() => {}))),
    ),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.mode === 'navigate') {
    // HTML은 네트워크 우선 → 새 버전 배포가 바로 반영됨
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // 그 외(해시된 JS/CSS, wasm, 모델)는 캐시 우선
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
