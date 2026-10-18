#!/usr/bin/env node
// 在合成截图目录上评测：定位成功率（角点误差 ≤ 2% 板宽）与端到端 recognize() 完全正确率。
// 用法：node tools/vision/eval_screens.mjs <dir> [--locate-only] [--verbose] [--weights path.js]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePNG } from './png.mjs';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
const locateOnly = args.includes('--locate-only');
const verbose = args.includes('--verbose');
const wi = args.indexOf('--weights');
const vision = await import(pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/vision/index.js')));
if (wi >= 0) {
	const mod = await import(pathToFileURL(path.resolve(args[wi + 1])));
	vision._setWeights(mod.WEIGHTS);
}

const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
let located = 0, nullCount = 0, exact = 0, sqExact = 0, sqOk = 0, sqTot = 0, flipOk = 0, readExact = 0;
let tLoc = 0, tRead = 0;
const errs = [];
for (const m of meta) {
	const img = decodePNG(fs.readFileSync(path.join(dir, m.file)));
	const gt = m.corners;
	const bw = Math.hypot(gt[1][0] - gt[0][0], gt[1][1] - gt[0][1]);
	let t = performance.now();
	const loc = vision.locateBoard(img);
	tLoc += performance.now() - t;
	let err = Infinity;
	if (loc) err = Math.max(...loc.corners.map((c, i) => Math.hypot(c[0] - gt[i][0], c[1] - gt[i][1]))) / bw;
	else nullCount++;
	errs.push(err);
	const ok = err <= 0.02;
	if (ok) located++;
	let line = `${m.file} ${m.set} B=${bw.toFixed(0)} err=${(err * 100).toFixed(2)}% score=${loc ? loc.score.toFixed(2) : '-'}`;
	if (!locateOnly) {
		// 端到端：用自己的定位；另外用真值角点单独评测分类（排除定位误差）
		t = performance.now();
		const rd = vision.readBoard(img, gt);
		tRead += performance.now() - t;
		const fl = vision.guessFlipped(rd.squares);
		if (fl === m.flipped) flipOk++;
		let k = 0;
		for (let i = 0; i < 64; i++) if (rd.squares[i] === m.squares[i]) k++;
		sqOk += k; sqTot += 64;
		if (k === 64) readExact++;
		const r = loc ? vision.recognize(img) : null;
		const good = r && r.placement === m.placement;
		if (good) exact++;
		if (r && r.squares.every((v, i) => v === m.squares[i])) sqExact++;
		line += ` read=${k}/64 flip=${fl === m.flipped ? 'ok' : 'WRONG'} e2e=${good ? 'ok' : 'FAIL'}`;
		if (verbose && k < 64) {
			const diff = [];
			for (let i = 0; i < 64; i++) if (rd.squares[i] !== m.squares[i]) diff.push(`${i}:${m.squares[i] || '.'}->${rd.squares[i] || '.'}`);
			line += ' ' + diff.join(' ');
		}
	}
	if (verbose || !ok) console.log(line);
}
const n = meta.length;
errs.sort((a, b) => a - b);
console.log(`\n${dir}: n=${n}`);
console.log(`locate: ${(100 * located / n).toFixed(1)}% within 2% (null ${nullCount}), median err ${(100 * errs[n >> 1]).toFixed(2)}%, avg ${(tLoc / n).toFixed(0)} ms`);
if (!locateOnly) {
	console.log(`read (GT corners): per-square ${(100 * sqOk / sqTot).toFixed(2)}%, board exact ${(100 * readExact / n).toFixed(1)}%, avg ${(tRead / n).toFixed(0)} ms`);
	console.log(`flip guess: ${(100 * flipOk / n).toFixed(1)}%`);
	console.log(`end-to-end recognize(): all 64 squares right (display order) ${(100 * sqExact / n).toFixed(1)}%, exact FEN placement incl. orientation ${(100 * exact / n).toFixed(1)}%`);
}
