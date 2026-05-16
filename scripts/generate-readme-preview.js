const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const iconDir = path.join(rootDir, 'src/assets/generated');
const outDir = path.join(rootDir, 'docs');
const outFile = path.join(outDir, 'battery-icons-preview.png');

const icons = [
  { file: 'battery_0.png', label: '0%' },
  { file: 'battery_10.png', label: '10%' },
  { file: 'battery_25.png', label: '25%' },
  { file: 'battery_50.png', label: '50%' },
  { file: 'battery_75.png', label: '75%' },
  { file: 'battery_100.png', label: '100%' },
  { file: 'battery_charging.png', label: 'Charging' }
];

const cellWidth = 120;
const width = cellWidth * icons.length;
const height = 170;
const iconSize = 96;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f7f9fb';
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < icons.length; index++) {
    const { file, label } = icons[index];
    const x = index * cellWidth;
    const image = await loadImage(path.join(iconDir, file));

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d9e2ea';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 10, 12, cellWidth - 20, 120, 8);
    ctx.fill();
    ctx.stroke();

    ctx.drawImage(image, x + (cellWidth - iconSize) / 2, 24, iconSize, iconSize);

    ctx.fillStyle = '#263f52';
    ctx.font = '600 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + cellWidth / 2, 148);
  }

  fs.writeFileSync(outFile, canvas.toBuffer('image/png'));
  console.log(`Wrote ${path.relative(rootDir, outFile)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
