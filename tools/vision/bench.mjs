#!/usr/bin/env node
// 计时：readBoard（典型 = 夹具截图；最坏 = 64 格全部走网络）、locateBoard、权重解码。
// 用法：node tools/vision/bench.mjs [截图目录（含 meta.json），默认用测试夹具]
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png.mjs';
import { locateBoard, readBoard } from '../../src/vision/index.js';
import { loadNet, runNet } from '../../src/vision/net.js';
import { warpGray, normalizeBoard, cutTiles } from '../../src/vision/warp.js';
import { WEIGHTS } from '../../src/vision/weights.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = process.argv[2] || path.join(here, '../../tests/vision/fixtures');
const metaFile = fs.existsSync(path.join(dir, 'meta.json')) ? 'meta.json' : 'fixtures.json';
const meta = JSON.parse(fs.readFileSync(path.join(dir, metaFile), 'utf8')).slice(0, 40);
const imgs = meta.map(m => ({ m, img: decodePNG(fs.readFileSync(path.join(dir, m.file))) }));

const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const time = (f, n) => { const t = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); f(); t.push(performance.now() - t0); } return t; };

let t0 = performance.now();
const net = loadNet(WEIGHTS);
console.log(`weights decode: ${(performance.now() - t0).toFixed(1)} ms, module ${(fs.statSync(path.join(here, '../../src/vision/weights.js')).size / 1024).toFixed(0)} KB`);

for (const { img, m } of imgs) readBoard(img, m.corners); // 预热 JIT
const rb = [], lb = [], wp = [];
for (const { img, m } of imgs) {
	rb.push(...time(() => readBoard(img, m.corners), 3));
	lb.push(...time(() => locateBoard(img), 1));
	wp.push(...time(() => normalizeBoard(warpGray(img, m.corners, 256)), 3));
}
const tiles = cutTiles(normalizeBoard(warpGray(imgs[0].img, imgs[0].m.corners, 256)), 256);
const worst = time(() => runNet(net, tiles, 64), 10);
console.log(`readBoard typical: median ${median(rb).toFixed(0)} ms (warp+normalize ${median(wp).toFixed(0)} ms)`);
console.log(`readBoard worst case (all 64 tiles through the CNN): median ${(median(worst) + median(wp)).toFixed(0)} ms`);
console.log(`locateBoard: median ${median(lb).toFixed(0)} ms, max ${Math.max(...lb).toFixed(0)} ms over ${imgs.length} images ` +
	`(${imgs[0].img.width}×${imgs[0].img.height} …)`);
