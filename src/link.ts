import Peer, { type DataConnection, type MediaConnection } from 'peerjs';
import type { Detection } from './detector';

/**
 * 촬영 기기(iPhone, /camera) ↔ 인식 기기(맥북·아이패드, /studio) WebRTC 연결.
 * 서로 찾는 과정(시그널링)만 PeerJS 공개 서버를 쓰고, 영상은 기기끼리 직접(같은 핫스팟/Wi-Fi) 주고받는다.
 * 인식 기기는 6자리 코드로 등록하고, 촬영 기기가 그 코드로 전화를 건다.
 */
const peerIdFor = (code: string) => `letgomin-yolo-${code}`;
const newCode = () => String(Math.floor(100000 + Math.random() * 900000));

/** 인식 결과 전송 형식 (keypoints는 JSON용 배열) */
export interface DetMessage {
  w: number; // 인식한 영상 크기 — 받는 쪽에서 자기 영상 크기로 환산
  h: number;
  dets: (Omit<Detection, 'keypoints'> & { keypoints?: number[] })[];
}

export function toMessage(dets: Detection[], w: number, h: number): DetMessage {
  return { w, h, dets: dets.map((d) => ({ ...d, keypoints: d.keypoints && Array.from(d.keypoints) })) };
}

/** 연결이 끊겼는지 감시 (PeerJS의 close 이벤트는 상대가 갑자기 사라지면 안 올 때가 있음) */
function watchConnection(call: MediaConnection, onLost: () => void) {
  let lost = false;
  const fire = () => !lost && ((lost = true), onLost());
  call.on('close', fire);
  call.on('error', fire);
  const pc = call.peerConnection;
  pc?.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fire();
  });
}

// --- 인식 기기 쪽 ---

export class StudioLink {
  code = localStorage.getItem('studio-code') ?? newCode();
  state = '연결 준비 중';
  onStream?: (stream: MediaStream) => void;
  onLost?: () => void;
  onState?: () => void;

  private call: MediaConnection | null = null;
  private conn: DataConnection | null = null;

  constructor() {
    this.open();
  }

  /** 촬영 페이지 주소 (cam.도메인 또는 /camera) */
  get cameraUrl() {
    const { protocol, host } = location;
    const base = host.startsWith('studio.') ? `${protocol}//${host.replace(/^studio\./, 'cam.')}/` : `${location.origin}/camera`;
    return `${base}?code=${this.code}`;
  }

  send(msg: DetMessage) {
    if (this.conn?.open) this.conn.send(msg);
  }

  private setState(s: string) {
    this.state = s;
    this.onState?.();
  }

  private open() {
    localStorage.setItem('studio-code', this.code);
    const peer = new Peer(peerIdFor(this.code));
    peer.on('open', () => this.setState('촬영 기기 대기 중'));
    peer.on('disconnected', () => peer.reconnect()); // 시그널링 서버만 끊긴 것 — 영상 연결은 유지됨
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        // 다른 탭/기기가 같은 코드를 쓰는 중 → 새 코드
        peer.destroy();
        this.code = newCode();
        this.open();
      } else {
        this.setState(`연결 오류: ${e.type}`);
      }
    });

    peer.on('call', (call) => {
      this.call?.close();
      this.call = call;
      call.answer(); // 수신 전용
      let got = false;
      call.on('stream', (stream) => {
        if (got) return; // PeerJS는 트랙마다 stream 이벤트를 낼 수 있음
        got = true;
        this.setState('촬영 기기 연결됨');
        this.onStream?.(stream);
      });
      watchConnection(call, () => {
        if (this.call !== call) return;
        this.call = null;
        this.setState('연결 끊김 — 촬영 기기 대기 중');
        this.onLost?.();
      });
    });

    peer.on('connection', (conn) => {
      this.conn?.close();
      this.conn = conn;
    });
  }
}

// --- 촬영 기기 쪽 ---

export class CameraLink {
  state = '';
  connected = false;
  onDetections?: (msg: DetMessage) => void;
  onState?: () => void;

  private peer: Peer | null = null;
  private call: MediaConnection | null = null;
  private conn: DataConnection | null = null;
  private stream: MediaStream | null = null;
  private code = '';
  private wanted = false;
  private retryTimer = 0;

  get active() {
    return this.wanted;
  }

  connect(code: string, stream: MediaStream) {
    this.code = code;
    this.stream = stream;
    this.wanted = true;
    this.peer ??= this.createPeer();
    if (this.peer.open) this.dial();
    else this.setState('연결 중…');
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    this.hangUp();
    this.setState('');
  }

  /** 카메라 전환 등으로 스트림이 바뀌면 연결을 끊지 않고 트랙만 교체 */
  replaceStream(stream: MediaStream) {
    this.stream = stream;
    for (const sender of this.call?.peerConnection?.getSenders() ?? []) {
      const track = stream.getTracks().find((t) => t.kind === sender.track?.kind);
      if (track) sender.replaceTrack(track);
    }
  }

  private setState(s: string) {
    this.state = s;
    this.onState?.();
  }

  private createPeer() {
    const peer = new Peer();
    peer.on('open', () => this.wanted && this.dial());
    peer.on('disconnected', () => peer.reconnect());
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') this.retry('인식 기기를 찾을 수 없음 (코드 확인)');
      else this.retry(`연결 오류: ${e.type}`);
    });
    return peer;
  }

  private dial() {
    if (!this.wanted || !this.peer || !this.stream) return;
    this.hangUp();
    this.setState('연결 중…');
    const id = peerIdFor(this.code);
    const call = this.peer.call(id, this.stream);
    const conn = this.peer.connect(id, { serialization: 'json' });
    this.call = call;
    this.conn = conn;
    conn.on('data', (d) => this.onDetections?.(d as DetMessage));

    const pc = call.peerConnection;
    pc?.addEventListener('connectionstatechange', () => {
      if (pc.connectionState !== 'connected' || this.call !== call) return;
      this.connected = true;
      this.setState('연결됨');
      setVideoBitrate(pc, 5_000_000);
    });
    watchConnection(call, () => this.call === call && this.retry('연결 끊김 — 재연결 중'));
  }

  private hangUp() {
    this.connected = false;
    this.call?.close();
    this.conn?.close();
    this.call = this.conn = null;
  }

  private retry(msg: string) {
    this.hangUp();
    if (!this.wanted) return;
    this.setState(msg);
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.dial(), 3000);
  }
}

/** 인식 기기에서 녹화·되감기 화질을 위해 영상 전송 비트레이트 상한을 올림 (기본은 낮게 잡힘) */
async function setVideoBitrate(pc: RTCPeerConnection, bps: number) {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = bps;
  // 대역폭이 부족하면 해상도 대신 프레임을 낮춤 (기본은 해상도를 크게 깎아 180p로 시작하기도 함)
  params.degradationPreference = 'maintain-resolution';
  await sender.setParameters(params).catch(() => {});
}
