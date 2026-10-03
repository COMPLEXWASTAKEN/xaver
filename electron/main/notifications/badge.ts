import { nativeImage, type NativeImage } from "electron";

let cached: NativeImage | null = null;

export function unreadBadge(): NativeImage {
  if (cached) return cached;
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size / 2 - 1;
  const inner = outer - 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      const edge = Math.max(0, Math.min(1, outer + 0.5 - d));
      if (edge <= 0) continue;
      const ring = d > inner;
      const [r, g, b] = ring ? [255, 255, 255] : [255, 90, 60];
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = Math.round(edge * 255);
    }
  }
  cached = nativeImage.createFromBitmap(buf, { width: size, height: size });
  return cached;
}
