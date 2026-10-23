import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// crossOriginIsolated → onnxruntime-web 멀티스레드 WASM 사용 가능
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// `npm run dev:https` → 같은 Wi-Fi의 iPhone에서 https://<PC IP>:5173 으로 접속 (카메라는 HTTPS 필수)
// 개발 서버에서도 배포(Vercel cleanUrls)처럼 /camera → camera.html
const cleanUrls: Plugin = {
  name: 'clean-urls',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/camera(\?|$)/.test(req.url)) req.url = req.url.replace('/camera', '/camera.html');
      next();
    });
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [cleanUrls, ...(mode === 'https' ? [basicSsl()] : [])],
  build: {
    rollupOptions: {
      // /studio 는 index.html 하나로 처리(경로/서브도메인으로 역할 판별)
      input: { main: 'index.html', camera: 'camera.html' },
    },
  },
  server: { host: mode === 'https', headers: isolation },
  preview: { headers: isolation },
  // ort의 .wasm/.mjs를 new URL(..., import.meta.url)로 찾게 하려면 사전 번들링에서 제외해야 함
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  // 추론 워커가 ort를 동적 import 하므로 ES 모듈 워커로 빌드
  worker: { format: 'es' },
}));
