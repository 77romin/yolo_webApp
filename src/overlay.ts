import type { Detection } from './detector';
import { COCO, SKELETON } from './labels';

const colorOf = (cls: number) => `hsl(${(cls * 47) % 360} 90% 55%)`;

/**
 * 원본 영상 좌표계(videoWidth × videoHeight) 캔버스에 그린다.
 * 캔버스를 <video>와 같은 object-fit: contain 으로 겹쳐 두면 위치가 자동으로 맞는다.
 */
export function drawDetections(ctx: CanvasRenderingContext2D, dets: Detection[], labels: string[] = COCO) {
  const unit = Math.max(2, ctx.canvas.width / 480);
  ctx.lineWidth = unit;
  ctx.font = `600 ${unit * 7}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';

  for (const d of dets) {
    const color = colorOf(d.cls);
    ctx.strokeStyle = color;
    ctx.strokeRect(d.x, d.y, d.w, d.h);

    const text = `${labels[d.cls] ?? d.cls} ${Math.round(d.score * 100)}%`;
    const tw = ctx.measureText(text).width + unit * 3;
    const th = unit * 9;
    const ty = d.y > th ? d.y : d.y + th; // 화면 위에 붙으면 박스 안쪽에
    ctx.fillStyle = color;
    ctx.fillRect(d.x - unit / 2, ty - th, tw, th);
    ctx.fillStyle = '#000';
    ctx.fillText(text, d.x + unit, ty - unit);

    if (d.keypoints) drawPose(ctx, d.keypoints, unit);
  }
}

function drawPose(ctx: CanvasRenderingContext2D, kp: Float32Array, unit: number) {
  const visible = (i: number) => kp[i * 3 + 2] > 0.5;
  ctx.strokeStyle = 'rgba(0,255,200,0.9)';
  ctx.beginPath();
  for (const [a, b] of SKELETON) {
    if (!visible(a) || !visible(b)) continue;
    ctx.moveTo(kp[a * 3], kp[a * 3 + 1]);
    ctx.lineTo(kp[b * 3], kp[b * 3 + 1]);
  }
  ctx.stroke();
  ctx.fillStyle = '#ff3d71';
  for (let i = 0; i < 17; i++) {
    if (!visible(i)) continue;
    ctx.beginPath();
    ctx.arc(kp[i * 3], kp[i * 3 + 1], unit * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
