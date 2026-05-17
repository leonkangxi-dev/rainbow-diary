const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

const SIZE = 256;

function color(r, g, b, a) {
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'build');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const img = new Jimp({ width: SIZE, height: SIZE, color: 0x00000000 });

  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // White rounded rect background
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = Math.min(x, SIZE - 1 - x);
      const dy = Math.min(y, SIZE - 1 - y);
      const cornerDist = Math.sqrt(
        Math.pow(Math.max(0, 40 - dx), 2) +
        Math.pow(Math.max(0, 40 - dy), 2)
      );
      if (cornerDist <= 40) {
        img.setPixelColor(color(255, 245, 250, 255), x, y);
      }
    }
  }

  // Rainbow arcs
  const rainbowColors = [
    [255, 66, 100], [255, 155, 66], [255, 214, 53],
    [81, 207, 102], [66, 159, 255], [102, 102, 255], [187, 102, 255]
  ];
  const bandWidth = 10;
  for (let ci = 0; ci < rainbowColors.length; ci++) {
    const r = 95 - ci * bandWidth;
    const [cr, cg, cb] = rainbowColors[ci];
    for (let ang = Math.PI; ang <= 2 * Math.PI; ang += 0.005) {
      for (let dr = -bandWidth / 2; dr <= bandWidth / 2; dr++) {
        const px = Math.round(cx + (r + dr) * Math.cos(ang));
        const py = Math.round(cy - 20 + (r + dr) * Math.sin(ang));
        if (px >= 0 && px < SIZE && py >= 0 && py < SIZE) {
          img.setPixelColor(color(cr, cg, cb, 230), px, py);
        }
      }
    }
  }

  // Sun
  for (let a = 0; a < 2 * Math.PI; a += 0.05) {
    for (let dr = 0; dr < 30; dr++) {
      const px = Math.round(cx - 65 + dr * Math.cos(a));
      const py = Math.round(cy - 70 + dr * Math.sin(a));
      if (px >= 0 && px < SIZE && py >= 0 && py < SIZE) {
        img.setPixelColor(color(255, 235, 100, 240), px, py);
      }
    }
  }

  // Cloud
  function cloud(cx2, cy2) {
    for (const [ox, oy, r] of [[0, 0, 28], [-22, 8, 20], [22, 6, 18], [-8, -12, 22], [12, -10, 20]]) {
      for (let a = 0; a < 2 * Math.PI; a += 0.05) {
        for (let dr = 0; dr < r; dr++) {
          const px = Math.round(cx2 + ox + dr * Math.cos(a));
          const py = Math.round(cy2 + oy + dr * Math.sin(a));
          if (px >= 0 && px < SIZE && py >= 0 && py < SIZE) {
            img.setPixelColor(color(255, 255, 255, 230), px, py);
          }
        }
      }
    }
  }
  cloud(cx + 65, cy - 65);

  // Sparkles
  for (const [sx, sy] of [[55, 55], [210, 50], [225, 120], [200, 190], [40, 160]]) {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        if (Math.abs(i) + Math.abs(j) <= 1) {
          const px = Math.round(sx + i * 3);
          const py = Math.round(sy + j * 3);
          if (px >= 0 && px < SIZE && py >= 0 && py < SIZE) {
            img.setPixelColor(color(255, 215, 0, 255), px, py);
          }
        }
      }
    }
  }

  // Save PNG
  const pngPath = path.join(outDir, 'icon.png');
  await img.write(pngPath);
  console.log('✅ PNG:', pngPath, `(${fs.statSync(pngPath).size} bytes)`);

  // Convert to ICO (embed PNG directly in ICO format)
  const pngBuffer = fs.readFileSync(pngPath);
  const icoPath = path.join(outDir, 'icon.ico');
  const numImages = 1;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(numImages, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);    // width (0=256)
  entry.writeUInt8(0, 1);    // height (0=256)
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);
  const icoBuffer = Buffer.concat([header, entry, pngBuffer]);
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('✅ ICO:', icoPath, `(${icoBuffer.length} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
