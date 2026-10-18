#!/usr/bin/env node
// 用预装的 Chromium 把 .cache/svg/<set>/*.svg 光栅化成 256px 透明 PNG（.cache/sprites/<set>/*.png）。
// 选 Chromium 而不是 cairosvg：网页上棋子本来就是浏览器画的，滤镜/渐变的效果最一致。
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const HERE = __dirname;
const SVG_DIR = path.join(HERE, '.cache', 'svg');
const OUT_DIR = path.join(HERE, '.cache', 'sprites');
const SIZE = Number(process.env.SPRITE_SIZE || 256);

(async () => {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	await page.setContent('<html><body></body></html>');
	for (const set of fs.readdirSync(SVG_DIR).sort()) {
		const dir = path.join(SVG_DIR, set);
		fs.mkdirSync(path.join(OUT_DIR, set), { recursive: true });
		for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.svg'))) {
			const svg = fs.readFileSync(path.join(dir, file), 'utf8');
			const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
			// 画到 canvas 上取 PNG，保留真实 alpha（截图会混进白底）
			const dataUrl = await page.evaluate(async ({ url, size }) => {
				const img = new Image();
				img.src = url;
				await img.decode();
				const c = document.createElement('canvas');
				c.width = c.height = size;
				const g = c.getContext('2d');
				g.drawImage(img, 0, 0, size, size);
				return c.toDataURL('image/png');
			}, { url, size: SIZE });
			const png = Buffer.from(dataUrl.split(',')[1], 'base64');
			fs.writeFileSync(path.join(OUT_DIR, set, file.replace('.svg', '.png')), png);
		}
		console.log('ok', set);
	}
	await browser.close();
})();
