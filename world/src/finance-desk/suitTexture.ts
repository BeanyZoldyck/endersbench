import { CanvasTexture, Color, SRGBColorSpace } from 'three';

// The jacket is painted onto the lower hemisphere: the agent remains one
// round body, with a shirt, lapels and tie following the sphere's surface.
export function suitTexture(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `#${new Color(color).lerp(new Color('#f0e4cc'), .3).getHexString()}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#344642';
  ctx.fillRect(0, 256, canvas.width, 256);
  const polygon = (points: number[][], fill: string) => {
    ctx.fillStyle = fill; ctx.beginPath();
    points.forEach(([x0, y0], index) => {
      const [x1, y1] = points[(index + 1) % points.length];
      for (let step = 0; step < 20; step++) {
        const t = step / 20, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
        const u = Math.atan2(z, -x) / (Math.PI * 2) * canvas.width;
        const v = Math.acos(y) / Math.PI * canvas.height;
        if (index === 0 && step === 0) ctx.moveTo(u, v); else ctx.lineTo(u, v);
      }
    });
    ctx.closePath(); ctx.fill();
  };
  polygon([[-.28, .015], [.28, .015], [0, -.52]], '#f7f0de');
  polygon([[-.43, 0], [-.27, .015], [0, -.52], [-.35, -.26], [-.26, -.15]], '#50615a');
  polygon([[.43, 0], [.27, .015], [0, -.52], [.35, -.26], [.26, -.15]], '#50615a');
  polygon([[0, -.015], [-.055, -.065], [-.035, -.3], [0, -.4], [.035, -.3], [.055, -.065]], '#aa7658');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
