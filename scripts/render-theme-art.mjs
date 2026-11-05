import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// The same Canvas sprite code runs in browsers and this SVG exporter. The
// exporter supplies the already-loaded atlas and embeds its original face crop.
globalThis.Image = class {
  complete = true;
  naturalWidth = 1254;
};
const { drawDestinationPoster, drawGlobalHero } = await import('../public/theme-art.js');
const facePng = await readFile(new URL('../public/assets/lenny-poster-head.png', import.meta.url));

// Reproducible, code-native pixel artwork. This tiny Canvas subset lets the
// selectable map cards share their exact landmark/creature art with gameplay.
const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
class SvgCanvas {
  constructor() {
    this.fillStyle = '#000';
    this.globalAlpha = 1;
    this.font = '12px monospace';
    this.textAlign = 'center';
    this.textBaseline = 'middle';
    this.matrix = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.parts = [];
    this.defs = [];
  }
  save() {
    this.stack.push({
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      matrix: [...this.matrix],
    });
  }
  restore() {
    Object.assign(this, this.stack.pop());
  }
  translate(x, y) {
    const m = this.matrix;
    m[4] += m[0] * x + m[2] * y;
    m[5] += m[1] * x + m[3] * y;
  }
  scale(x, y) {
    const m = this.matrix;
    m[0] *= x;
    m[1] *= x;
    m[2] *= y;
    m[3] *= y;
  }
  attributes() {
    return `fill="${escape(this.fillStyle.id ? `url(#${this.fillStyle.id})` : this.fillStyle)}" opacity="${this.globalAlpha}" transform="matrix(${this.matrix.join(' ')})"`;
  }
  fillRect(x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${this.attributes()}/>`);
  }
  drawImage(_atlas, sx, sy, sw, sh, x, y, w, h) {
    if ([sx, sy, sw, sh].join(',') !== '70,203,210,166')
      throw new Error('Unknown atlas crop in poster');
    this.faceUsed = true;
    this.parts.push(
      `<use href="#lenny-face" opacity="${this.globalAlpha}" transform="matrix(${this.matrix.join(' ')}) translate(${x} ${y}) scale(${w / 210} ${h / 166})"/>`,
    );
  }
  beginPath() {
    this.points = [];
  }
  moveTo(x, y) {
    this.points.push(`M${x} ${y}`);
  }
  lineTo(x, y) {
    this.points.push(`L${x} ${y}`);
  }
  closePath() {
    this.points.push('Z');
  }
  fill() {
    this.parts.push(`<path d="${this.points.join(' ')}" ${this.attributes()}/>`);
  }
  fillText(s, x, y) {
    const size = this.font.match(/([\d.]+)px/)?.[1] || 12;
    this.parts.push(
      `<text x="${x}" y="${y}" font-family="monospace" font-weight="bold" font-size="${size}" text-anchor="${this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' ? 'end' : 'start'}" dominant-baseline="middle" ${this.attributes()}>${escape(s)}</text>`,
    );
  }
  createLinearGradient(x1, y1, x2, y2) {
    const gradient = {
      id: `g${this.defs.length}`,
      x1,
      y1,
      x2,
      y2,
      stops: [],
      addColorStop(offset, color) {
        this.stops.push({ offset, color });
      },
    };
    this.defs.push(gradient);
    return gradient;
  }
  svg(width, height, title) {
    const face = this.faceUsed
      ? `<image id="lenny-face" width="210" height="166" href="data:image/png;base64,${facePng.toString('base64')}" image-rendering="pixelated"/>`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escape(title)}" shape-rendering="crispEdges"><title>${escape(title)}</title><defs>${face}${this.defs.map((g) => `<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">${g.stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join('')}</linearGradient>`).join('')}</defs>${this.parts.join('')}</svg>\n`;
  }
}
const root = new URL('../public/assets/', import.meta.url);
await mkdir(new URL('maps/', root), { recursive: true });
for (const id of ['miami', 'san-francisco', 'new-york', 'brazil', 'singapore', 'next-onsite']) {
  const c = new SvgCanvas();
  drawDestinationPoster(c, id, 640, 360);
  await writeFile(
    new URL(`maps/${id}.svg`, root),
    c.svg(640, 360, `RoboQueen · ${id.replaceAll('-', ' ')}`),
  );
}
const c = new SvgCanvas();
drawGlobalHero(c, 960, 640);
await writeFile(
  new URL('roboqueen-hero.svg', root),
  c.svg(960, 640, 'RoboQueen: a global raccoon crew, AI1 camera, and destination rides'),
);
console.log(`Rendered six map cards and the global hero in ${fileURLToPath(root)}`);
