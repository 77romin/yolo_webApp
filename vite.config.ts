import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` → 같은 Wi-Fi의 iPhone에서 https://<PC IP>:5173 으로 접속 (카메라는 HTTPS 필수)
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: { host: mode === 'https' },
}));
