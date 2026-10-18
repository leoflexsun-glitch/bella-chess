// check_parity.py 的 node 端：用 warp.js 重采样同一张图，与 Python 结果逐像素比较。
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png.mjs';
import { warpGray, cutTiles } from '../../src/vision/warp.js';

const dir = process.argv[2];
const cases = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
let worst = 0;
for (const c of cases) {
	const img = decodePNG(fs.readFileSync(path.join(dir, c.png)));
	const tiles = cutTiles(warpGray(img, c.corners, 256), 256);
	const buf = fs.readFileSync(path.join(dir, c.tiles));
	const ref = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
	let md = 0;
	for (let i = 0; i < ref.length; i++) md = Math.max(md, Math.abs(ref[i] - tiles[i]));
	console.log(c.png, 'max |py - js| =', md.toFixed(4));
	worst = Math.max(worst, md);
}
console.log(worst < 0.05 ? 'PARITY OK' : 'PARITY MISMATCH');
process.exit(worst < 0.05 ? 0 : 1);
