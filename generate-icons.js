const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZE = 128;
const SCALE = 4;
const CANVAS_SIZE = SIZE * SCALE;

const COLORS = {
  shell: '#263f52',
  cap: '#f2c991',
  red: '#b93d37',
  yellow: '#cf9f33',
  green: '#3f855f',
  bolt: '#ffd48f'
};

const outDir = path.join(__dirname, 'src/assets/generated');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
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

function createCanvasForIcon() {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.clearRect(0, 0, SIZE, SIZE);
  return { canvas, ctx };
}

function saveIcon(name, draw) {
  const { canvas, ctx } = createCanvasForIcon();
  draw(ctx);

  const out = createCanvas(SIZE, SIZE);
  const outCtx = out.getContext('2d');
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(canvas, 0, 0, SIZE, SIZE);

  const buffer = out.toBuffer('image/png');
  fs.writeFileSync(path.join(outDir, name), buffer);
  return buffer;
}

function getBatteryColor(percent) {
  if (percent <= 10) return COLORS.red;
  if (percent <= 40) return COLORS.yellow;
  return COLORS.green;
}

function drawBattery(ctx, fillColor, fillRatio) {
  roundRect(ctx, 45, 1, 38, 15, 5);
  ctx.fillStyle = COLORS.cap;
  ctx.fill();

  roundRect(ctx, 24, 8, 80, 119, 12);
  ctx.fillStyle = COLORS.shell;
  ctx.fill();

  const border = 5;
  const x = 24 + border;
  const y = 8 + border;
  const w = 80 - border * 2;
  const h = 119 - border * 2;
  const levelH = Math.max(fillRatio > 0 ? 1 : 0, Math.round(h * fillRatio));
  const levelY = y + h - levelH;

  ctx.save();
  roundRect(ctx, x, y, w, h, 5);
  ctx.clip();
  ctx.fillStyle = '#fffefa';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, levelY, w, levelH);
  ctx.restore();
}

function drawCharging(ctx) {
  roundRect(ctx, 45, 1, 38, 15, 5);
  ctx.fillStyle = COLORS.cap;
  ctx.fill();

  roundRect(ctx, 24, 8, 80, 119, 12);
  ctx.fillStyle = COLORS.shell;
  ctx.fill();

  ctx.fillStyle = COLORS.bolt;
  ctx.beginPath();
  ctx.moveTo(72, 39);
  ctx.lineTo(48, 77);
  ctx.lineTo(64, 77);
  ctx.lineTo(55, 106);
  ctx.lineTo(83, 60);
  ctx.lineTo(67, 60);
  ctx.closePath();
  ctx.fill();
}

function createIco(pngBuffer) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(SIZE === 256 ? 0 : SIZE, 6);
  header.writeUInt8(SIZE === 256 ? 0 : SIZE, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuffer.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, pngBuffer]);
}

const green = saveIcon('battery_green.png', ctx => drawBattery(ctx, COLORS.green, 0.72));
saveIcon('battery_yellow.png', ctx => drawBattery(ctx, COLORS.yellow, 0.54));
saveIcon('battery_red.png', ctx => drawBattery(ctx, COLORS.red, 0.36));
saveIcon('battery_charging.png', drawCharging);

for (let percent = 0; percent <= 100; percent++) {
  fs.writeFileSync(
    path.join(outDir, `battery_${percent}.png`),
    saveIcon(`battery_${percent}.png`, ctx => drawBattery(ctx, getBatteryColor(percent), percent / 100))
  );
}

fs.writeFileSync(path.join(outDir, 'battery.ico'), createIco(green));

console.log('Generated placeholder battery tray icons');
