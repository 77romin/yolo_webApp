/**
 * 소장용 연속 녹화. 1초마다 나오는 청크를 IndexedDB에 바로 저장해서
 * 메모리를 아끼고, 탭이 죽어도 다음 접속 때 복구할 수 있게 한다.
 */
const DB_NAME = 'yolo-archive';
const CHUNKS = 'chunks';
const META = 'meta';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(CHUNKS);
      open.result.createObjectStore(META);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

async function store(name: string, mode: IDBTransactionMode) {
  return (await db()).transaction(name, mode).objectStore(name);
}

export interface SavedRecording {
  blob: Blob;
  startedAt: number;
}

/** 남아 있는 녹화(정상 종료 후 미저장 또는 비정상 종료분)를 읽는다 */
export async function loadSaved(): Promise<SavedRecording | null> {
  const meta = await req((await store(META, 'readonly')).get('info'));
  if (!meta) return null;
  const chunks: Blob[] = await req((await store(CHUNKS, 'readonly')).getAll());
  if (!chunks.length) return null;
  return { blob: new Blob(chunks, { type: meta.mime }), startedAt: meta.startedAt };
}

export async function clearSaved() {
  await req((await store(CHUNKS, 'readwrite')).clear());
  await req((await store(META, 'readwrite')).clear());
}

export class ArchiveRecorder {
  startedAt = 0;
  private rec: MediaRecorder | null = null;
  private seq = 0;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private mimeType: string,
    private bitrate = 8_000_000,
  ) {}

  get recording() {
    return this.rec !== null;
  }

  async start(stream: MediaStream) {
    await clearSaved();
    navigator.storage?.persist?.();
    this.seq = 0;
    this.startedAt = Date.now();
    await req((await store(META, 'readwrite')).put({ mime: this.mimeType, startedAt: this.startedAt }, 'info'));

    const rec = new MediaRecorder(stream, { mimeType: this.mimeType, videoBitsPerSecond: this.bitrate });
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const key = this.seq++;
      this.writes = this.writes.then(async () => req((await store(CHUNKS, 'readwrite')).put(e.data, key)));
    };
    rec.start(1000);
    this.rec = rec;
  }

  /** 녹화를 끝내고 저장된 전체 파일을 돌려준다 */
  stop(): Promise<SavedRecording | null> {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = async () => {
        await this.writes;
        resolve(await loadSaved());
      };
      rec.stop();
    });
  }
}
