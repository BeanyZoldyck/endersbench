import { CanvasTexture, SRGBColorSpace, Vector3 } from 'three';

// Shared spherical face maps. Painting on the shell keeps the eyes flush even
// during turns, body squash and blinks; no floating eye meshes or eyelids.
let faces: { open: CanvasTexture; blink: CanvasTexture } | undefined;
export function faceTextures() {
  if (faces) return faces;
  const draw = (blink: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const normal = new Vector3(), right = new Vector3(), up = new Vector3();
    const tangent = new Vector3(), point = new Vector3();
    // Wrap a symmetric oval around each eye's own surface normal. Projecting
    // a front-facing oval onto the upper sphere made side views look tapered.
    const ellipse = (cx: number, cy: number, rx: number, ry: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const angle = i / 96 * Math.PI * 2;
        const x = cx + Math.cos(angle) * rx, y = cy + Math.sin(angle) * ry;
        const distance = Math.hypot(x, y);
        tangent.copy(right).multiplyScalar(x).addScaledVector(up, y);
        point.copy(normal).multiplyScalar(Math.cos(distance))
          .addScaledVector(tangent, distance > 0 ? Math.sin(distance) / distance : 1);
        const u = Math.atan2(point.z, -point.x) / (Math.PI * 2) * canvas.width;
        const v = Math.acos(point.y) / Math.PI * canvas.height;
        if (i === 0) ctx.moveTo(u, v); else ctx.lineTo(u, v);
      }
      ctx.closePath(); ctx.fill();
    };
    for (const side of [-1, 1]) {
      const x = side * 0.36, y = 0.62;
      normal.set(x, y, Math.sqrt(1 - x * x - y * y));
      up.set(0, 1, 0).addScaledVector(normal, -normal.y).normalize();
      right.crossVectors(up, normal).normalize();
      const height = blink ? 0.025 : 0.235;
      // A feathered white surround separates the eyes from dark logo strokes.
      // Layer it in surface coordinates so the fade wraps with the oval.
      for (let step = 12; step >= 1; step--) {
        const spread = 0.095 * step / 12;
        ellipse(0, 0, 0.175 + spread, height + spread, `rgba(255, 254, 247, ${0.06 * (1 - step / 13)})`);
      }
      ellipse(0, 0, 0.175, height, '#050807');
      if (!blink) {
        ellipse(-0.047, 0.075, 0.055, 0.065, '#fffbee');
        ellipse(0.06, -0.065, 0.025, 0.029, '#d0dfc9');
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  faces = { open: draw(false), blink: draw(true) };
  return faces;
}
