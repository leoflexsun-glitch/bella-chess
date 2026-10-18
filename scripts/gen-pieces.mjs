// 把 assets/pieces/<套装>/*.svg 压缩后写成 src/view2d/pieces.css（data URI 背景图）。
// 棋子以 CSS 背景渲染：任何设备上都一样清晰，不依赖系统字体。
//   node scripts/gen-pieces.mjs

import { optimize } from 'svgo';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETS = ['celtic', 'chessnut', 'fantasy'];
const PIECES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];

const svgoConfig = {
	multipass: true,
	plugins: [
		{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }
	]
};

// SVG 直接 URL 编码比 base64 小约 30%；只转义 CSS url("") 里必须转义的字符。
const dataUri = svg => 'data:image/svg+xml,' + svg
	.replace(/"/g, "'")
	.replace(/%/g, '%25')
	.replace(/#/g, '%23')
	.replace(/</g, '%3C')
	.replace(/>/g, '%3E')
	.replace(/\s+/g, ' ');

let css = '/* 生成文件，勿手改：npm run pieces（源：assets/pieces/，许可见该目录 README） */\n';
let raw = 0, packed = 0;
for (const set of SETS) {
	const files = new Set(await readdir(path.join(root, 'assets/pieces', set)));
	for (const piece of PIECES) {
		if (!files.has(`${piece}.svg`)) throw new Error(`缺少 ${set}/${piece}.svg`);
		const source = await readFile(path.join(root, 'assets/pieces', set, `${piece}.svg`), 'utf8');
		const { data } = optimize(source, svgoConfig);
		raw += source.length;
		packed += data.length;
		css += `[data-pieces="${set}"] .${piece}{background-image:url("${dataUri(data)}")}\n`;
	}
}

await writeFile(path.join(root, 'src/view2d/pieces.css'), css);
console.log(`pieces.css  ${SETS.length} 套  ${(raw / 1024).toFixed(0)} KB → ${(Buffer.byteLength(css) / 1024).toFixed(0)} KB`);
