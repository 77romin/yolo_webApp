import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// crossOriginIsolated → onnxruntime-web 멀티스레드 WASM 사용 가능
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// `npm run dev:https` → 같은 Wi-Fi의 iPhone에서 https://<PC IP>:5173 으로 접속 (카메라는 HTTPS 필수)
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: { host: mode === 'https', headers: isolation },
  preview: { headers: isolation },
  // ort의 .wasm/.mjs를 new URL(..., import.meta.url)로 찾게 하려면 사전 번들링에서 제외해야 함
  optimizeDeps: { exclude: ['onnxruntime-web'] },
}));
