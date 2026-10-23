/** PWA: 홈 화면 설치 + 오프라인 캐시 (개발 서버에서는 캐시가 방해되므로 배포 빌드에서만) */
export function registerPWA() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.ready;
    // 서비스워커 설치 전에 이미 받은 리소스도 캐시하도록 목록 전달
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => new URL(u).origin === location.origin);
    reg.active?.postMessage({ cache: urls });
  });
}
