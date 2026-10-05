// ============================================================
// Dựng index.html (bản chạy nhanh) từ app.src.html (bản để sửa)
//
//   cd tools && npm install && npm run build:app
//
// - Dịch sẵn JSX → JavaScript (trình duyệt không phải tải Babel ~3MB và tự dịch)
// - Tạo sẵn CSS Tailwind chỉ gồm các class đang dùng (không tải Tailwind CDN)
// LUÔN sửa app.src.html, KHÔNG sửa trực tiếp index.html (sẽ bị ghi đè khi dựng lại).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import cssnano from 'cssnano';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const srcPath = path.join(root, 'app.src.html');
const outPath = path.join(root, 'index.html');

const src = fs.readFileSync(srcPath, 'utf8');

// 1) JSX → JS
const babelRe = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const m = src.match(babelRe);
if (!m) throw new Error('Không tìm thấy <script type="text/babel"> trong app.src.html');
const js = transformSync(m[1], {
  babelrc: false,
  configFile: false,
  presets: [
    ['@babel/preset-env', { targets: '> 0.5%, last 3 versions, not dead', bugfixes: true, modules: false }],
    ['@babel/preset-react', { runtime: 'classic' }],
  ],
  minified: true,
  comments: false,
}).code;

// 2) Tailwind → CSS tĩnh
const twResult = await postcss([
  tailwindcss({ content: [{ raw: src, extension: 'html' }] }),
  cssnano({ preset: 'default' }),
]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });

// 3) Ghép
let out = src;
const cdnTw = '<script src="https://cdn.tailwindcss.com"></script>';
const cdnBabel = /<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"><\/script>\n?/;
if (!out.includes(cdnTw)) throw new Error('Không thấy thẻ Tailwind CDN');
out = out.replace(cdnTw + '\n', '').replace(cdnTw, '');
out = out.replace(cdnBabel, '');
// Tailwind CDN chèn CSS vào cuối <head> → giữ đúng thứ tự đó
out = out.replace('</head>', '<style id="tailwind">' + twResult.css + '</style>\n</head>');
out = out.replace(babelRe, () => '<script>' + js + '</script>');
out = out.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- FILE TỰ SINH từ app.src.html bằng tools/build.mjs — đừng sửa trực tiếp file này -->');

fs.writeFileSync(outPath, out);
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log('✓ Đã dựng index.html', '| JS', kb(js.length), '| CSS', kb(twResult.css.length), '| tổng', kb(Buffer.byteLength(out)));
