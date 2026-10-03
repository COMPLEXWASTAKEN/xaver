import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = path.join(root, "build", "icon.svg");
const png = path.join(root, "build", "icon.png");
const outIco = path.join(root, "build", "icon.ico");
const outDir = path.join(root, "build", "icons");

async function main() {
  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  let base;
  if (fs.existsSync(svg)) {
    base = await sharp(svg).resize(1024, 1024).png().toBuffer();
    await sharp(base).toFile(png);
  } else if (fs.existsSync(png)) {
    base = await sharp(png)
      .resize(1024, 1024, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    await sharp(base).toFile(png);
  } else {
    throw new Error("Missing build/icon.svg (or build/icon.png)");
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const buffers = [];
  for (const s of sizes) {
    const buf = await sharp(base).resize(s, s).png().toBuffer();
    fs.writeFileSync(path.join(outDir, `icon-${s}.png`), buf);
    if ([16, 24, 32, 48, 64, 128, 256].includes(s)) buffers.push(buf);
  }

  const uiAssets = path.join(root, "ui", "assets");
  fs.mkdirSync(uiAssets, { recursive: true });
  fs.copyFileSync(path.join(outDir, "icon-64.png"), path.join(uiAssets, "logo.png"));

  fs.writeFileSync(outIco, await pngToIco(buffers));
  console.log("icons ready.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
