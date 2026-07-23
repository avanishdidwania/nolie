import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('src/assets/logo.svg');
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  await sharp(svg).resize(size, size).png().toFile(`src/assets/icon-${size}.png`);
  console.log(`Generated icon-${size}.png`);
}
