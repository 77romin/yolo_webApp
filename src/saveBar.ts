import { clearSaved, loadSaved, type SavedRecording } from './archiveRecorder';
import { extensionFor } from './media';

/** 녹화 완료/복구 시 뜨는 저장 바 (#save-bar). 촬영·단독 페이지 공용 */
export class SaveBar {
  pending: SavedRecording | null = null;

  private bar = document.getElementById('save-bar')!;
  private info = document.getElementById('save-info')!;
  private shareBtn = document.getElementById('btn-share')!;

  constructor() {
    document.getElementById('btn-download')!.onclick = () => this.download();
    this.shareBtn.onclick = () => this.share();
    document.getElementById('btn-discard')!.onclick = () => this.discard();
    // 이전 접속에서 저장하지 않은 녹화가 남아 있으면 복구 제안
    loadSaved().then((rec) => rec && this.offer(rec, true));
  }

  offer(rec: SavedRecording, recovered = false) {
    this.pending = rec;
    const mb = (rec.blob.size / 1024 / 1024).toFixed(1);
    this.info.textContent = `${recovered ? '이전 녹화 발견' : '녹화 완료'} (${mb}MB)`;
    this.shareBtn.hidden = !navigator.canShare?.({ files: [fileOf(rec)] });
    this.bar.hidden = false;
  }

  hide() {
    this.bar.hidden = true;
  }

  /** 새 녹화를 시작해도 되는지 (저장 안 한 녹화가 있으면 확인) */
  confirmOverwrite() {
    return !this.pending || confirm('저장하지 않은 녹화가 있습니다. 새로 녹화하면 지워집니다. 계속할까요?');
  }

  private download() {
    if (!this.pending) return;
    const file = fileOf(this.pending);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }

  private async share() {
    if (!this.pending) return;
    try {
      await navigator.share({ files: [fileOf(this.pending)] });
    } catch {
      // 사용자가 공유 시트를 닫음
    }
  }

  private async discard() {
    if (!confirm('녹화를 삭제할까요?')) return;
    await clearSaved();
    this.pending = null;
    this.hide();
  }
}

function fileOf(rec: SavedRecording) {
  const d = new Date(rec.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `live_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return new File([rec.blob], `${name}.${extensionFor(rec.blob.type)}`, { type: rec.blob.type });
}
