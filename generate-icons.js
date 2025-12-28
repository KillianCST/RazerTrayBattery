const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZE = 32;
const RADIUS = 5;

const outDir = path.join(__dirname, 'src/assets/generated');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function getBackgroundColor(percent) {
  if (percent > 75) return '#32cd32';
  if (percent > 30) return '#ffd400'; 
  return '#ff3b30';                   
}

function getFont(percent) {
  if (percent === 100) return '900 20px Segoe UI';
  if (percent >= 10) return '900 22px Segoe UI';
  return '900 24px Segoe UI';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

for (let percent = 0; percent <= 100; percent++) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  const bg = getBackgroundColor(percent);

  ctx.fillStyle = bg;
  roundRect(ctx, 1, 1, SIZE - 2, SIZE - 2, RADIUS);
  ctx.fill();

  const text = String(percent).padStart(2, '0');

  ctx.font = getFont(percent);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#000000';
  ctx.fillText(text, SIZE / 2, SIZE / 2 + 1);

  fs.writeFileSync(
    path.join(outDir, `battery_${percent}.png`),
    canvas.toBuffer('image/png')
  );
}

console.log('✔');
