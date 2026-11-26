'use strict';
// Rebuilds preview.html from the SVG files next to it (the images are embedded so the page works anywhere).
const fs = require('fs');
const path = require('path');
const items = [
  ['d-wipe.svg', 'D · 擦痕', '一下擦出一片干净'],
  ['e-letter.svg', 'E · 字母 b', 'Bytemop 的 b，字心是一颗闪光'],
  ['f-buddy.svg', 'F · 扛拖把的小硬盘', '主角和它的工具'],
];
const sizes = [48, 32, 24, 16];
const card = ([file, name, note]) => {
  const src = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, file)).toString('base64');
  const strip = (cls) => `<div class="strip ${cls}">` + sizes.map((s) => `<img src="${src}" width="${s}" height="${s}" alt="">`).join('') + '</div>';
  return `<div class="card"><h2>${name}</h2><p>${note}</p><img class="big" src="${src}" alt="">${strip('light')}${strip('dark')}</div>`;
};
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Bytemop 图标方案</title>
<style>
  body{margin:0;font:14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;background:#f3efe9;color:#2b1433}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:24px;max-width:1080px;margin:0 auto}
  .card{background:#fff;border-radius:16px;padding:20px;text-align:center}
  h2{margin:0 0 2px;font-size:18px;font-weight:600}
  p{margin:0 0 14px;color:#6d5a74}
  .big{width:200px;height:200px}
  .strip{display:flex;align-items:center;justify-content:center;gap:16px;padding:12px;border-radius:10px;margin-top:12px}
  .light{background:#e8ecf3}.dark{background:#1f2430}
</style></head><body><div class="grid">${items.map(card).join('')}</div></body></html>
`;
fs.writeFileSync(path.join(__dirname, 'preview.html'), html);
