// 端到端：在真浏览器里打开打包后的 index.html，走完主要流程。
//   npm run e2e
// 需要 Playwright 与 Chromium：npm i -D playwright && npx playwright install chromium
// （也可用环境变量 PLAYWRIGHT_PATH 指向已安装的 playwright 包目录）

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

// 只服务一个文件：发布形态就是单个 index.html。
const server = createServer(async (req, res) => {
	if (req.url !== '/' && !req.url.startsWith('/index.html')) { res.writeHead(404).end(); return; }
	res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await readFile(path.join(root, 'index.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const errors = [];
let passed = 0;

async function scenario(name, viewport, fn) {
	const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
	const page = await ctx.newPage();
	page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
	page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
	try {
		await fn(page, ctx);
		passed++;
		console.log(`ok   ${name}`);
	} catch (e) {
		console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`);
		process.exitCode = 1;
	}
	await ctx.close();
}

// 0x88 无关：这里用代数坐标换算屏幕坐标，自动考虑棋盘翻转。
async function point(page, square, selector = '#board2d .b2d') {
	const box = await page.locator(selector).boundingBox();
	const flipped = await page.evaluate(sel => document.querySelector(`${sel} .cf`)?.textContent === 'h', selector);
	let f = square.charCodeAt(0) - 97, r = 8 - Number(square[1]);
	if (flipped) { f = 7 - f; r = 7 - r; }
	const s = box.width / 8;
	return [box.x + (f + 0.5) * s, box.y + (r + 0.5) * s];
}
const click = async (page, sq, sel) => page.mouse.click(...await point(page, sq, sel));
const moves = page => page.$$eval('.moves [data-ply]', els => els.map(e => e.textContent));
const waitMoves = (page, n) => page.waitForFunction(k => document.querySelectorAll('.moves [data-ply]').length >= k, n, { timeout: 20000 });
const fresh = async page => { await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload(); };

await scenario('开局、走子、电脑应答、悔棋、翻转、刷新恢复', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	assert.ok(await page.isVisible('#dlg-new[open]'), '首次打开应弹出新对局');
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	assert.ok(await page.locator('#board2d .mk.dot').count() >= 2, '选中后应显示合法落点');
	await click(page, 'e4');
	await waitMoves(page, 2);
	assert.equal((await moves(page))[0], 'e4');
	await page.click('.controls [data-act="undo"]');
	await page.waitForTimeout(300);
	assert.equal((await moves(page)).length, 0, '悔棋应撤回人和电脑各一步');
	assert.equal(await page.locator('#board2d .pc').count(), 32);
	await page.keyboard.press('f');
	assert.equal(await page.textContent('#board2d .cf'), 'h', '翻转后底边应从 h 开始');
	await page.keyboard.press('f');
	await click(page, 'd2');
	await click(page, 'd4');
	await waitMoves(page, 2);
	await page.reload();
	await page.waitForTimeout(300);
	assert.equal((await moves(page))[0], 'd4', '刷新后应恢复对局');
});

await scenario('拖拽走子与升变选择', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.evaluate(() => localStorage.setItem('frostfall.game', JSON.stringify({ fen: '8/P6k/7p/8/8/8/8/K7 w - - 0 1', moves: [], human: 8, level: 'novice' })));
	await page.reload();
	const [x1, y1] = await point(page, 'a7'), [x2, y2] = await point(page, 'a8');
	await page.mouse.move(x1, y1);
	await page.mouse.down();
	await page.mouse.move(x1, (y1 + y2) / 2, { steps: 4 });
	await page.mouse.move(x2, y2, { steps: 4 });
	await page.mouse.up();
	await page.waitForSelector('.b2d-promo .promo-choice');
	await page.locator('.b2d-promo .promo-choice').nth(1).click();   // 马
	await waitMoves(page, 1);
	assert.equal((await moves(page))[0], 'a8=N');
});

await scenario('摆棋编辑器：清空、放子、校验、从该局面开局', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="setup"]');
	await page.click('#editor [data-ed="clear"]');
	assert.ok(await page.isDisabled('#editor [data-ed="play"]'), '空棋盘不能开局');
	const edit = '#board-edit .b2d';
	await page.click('#editor [data-tool="14"]'); await click(page, 'g1', edit);   // 白王
	await page.click('#editor [data-tool="22"]'); await click(page, 'g8', edit);   // 黑王
	await page.click('#editor [data-tool="12"]'); await click(page, 'a1', edit);   // 白车
	await page.click('#editor [data-ed-set="turn"] [data-value="w"]');
	assert.equal(await page.inputValue('#ed-fen'), '6k1/8/8/8/8/8/8/R5K1 w - - 0 1');
	assert.ok(!(await page.isDisabled('#editor [data-ed="play"]')));
	await page.click('#editor [data-ed="play"]');
	await page.waitForTimeout(300);
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('frostfall.game')));
	assert.equal(saved.fen, '6k1/8/8/8/8/8/8/R5K1 w - - 0 1');
	assert.equal(await page.locator('#board2d .pc').count(), 3);
});

await scenario('对局进行中从摆棋/识别结果开局：一定是全新一局', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	// 识别结果和摆棋走同一个编辑器入口
	await page.click('.topbar [data-act="setup"]');
	await page.fill('#ed-fen', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
	await page.press('#ed-fen', 'Enter');
	await page.click('#editor [data-ed="play"]');
	await page.waitForTimeout(300);
	assert.equal((await moves(page)).length, 0, '棋谱应清空');
	assert.ok(await page.isDisabled('.controls [data-act="undo"]'), '新局不能悔回上一局');
	assert.ok(await page.isHidden('[data-slot=result]'));
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('frostfall.game')));
	assert.deepEqual([saved.fen, saved.moves.length], ['6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 0]);
});

await scenario('拍照复刻：截图导入 → 自动定位 → 识别 → 核对 → 开全新一局', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	const fen = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8';
	await page.evaluate(f => {
		localStorage.setItem('frostfall.v2', JSON.stringify({ board: 'brown', pieces: 'chessnut' }));
		localStorage.setItem('frostfall.game', JSON.stringify({ fen: f, moves: [], human: 16, level: 'novice', flipped: true }));
	}, fen);
	await page.reload();
	await page.waitForTimeout(300);
	const shot = await page.screenshot();      // 黑方视角的整页截图
	await page.click('.topbar [data-act="photo"]');
	await page.locator('#photo input[type=file]').nth(1).setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: shot });
	await page.waitForFunction(() => /找到棋盘/.test(document.querySelector('[data-slot=photo-status]').textContent), null, { timeout: 15000 });
	assert.equal(await page.locator('[data-slot=photo-quad] .handle').count(), 4);
	await page.click('#photo [data-ph="read"]');
	await page.waitForSelector('#editor:not([hidden])');
	assert.equal((await page.inputValue('#ed-fen')).split(' ')[0], fen.split(' ')[0], '识别出的摆法应与截图一致');
	assert.equal(await page.textContent('#board-edit .cf'), 'h', '黑方视角的截图应自动翻转显示');
	await page.click('#editor [data-ed="play"]');
	await page.waitForTimeout(300);
	assert.equal((await moves(page)).length, 0);
	assert.equal(await page.locator('#board2d .pc').count(), 30);
});

await scenario('拍照复刻：没有棋盘的图给出提示，四角可手动拖动', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="photo"]');
	// 一张纯色渐变图：不含棋盘
	const blank = await page.evaluate(async () => {
		const c = new OffscreenCanvas(640, 480), g = c.getContext('2d');
		const grad = g.createLinearGradient(0, 0, 640, 480); grad.addColorStop(0, '#89a'); grad.addColorStop(1, '#ddd');
		g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
		const buf = new Uint8Array(await (await c.convertToBlob()).arrayBuffer());
		return Array.from(buf);
	});
	await page.locator('#photo input[type=file]').nth(1).setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: Buffer.from(blank) });
	await page.waitForFunction(() => /没找到棋盘/.test(document.querySelector('[data-slot=photo-status]').textContent), null, { timeout: 15000 });
	const handle = page.locator('[data-slot=photo-quad] .handle').first();
	const before = await handle.getAttribute('cx');
	const box = await handle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 60, box.y + 40, { steps: 5 });
	await page.mouse.up();
	assert.notEqual(await page.locator('[data-slot=photo-quad] .handle').first().getAttribute('cx'), before, '拖动后左上角应移动');
	await page.click('#photo [data-ph="close"]');
	assert.ok(await page.isHidden('#photo'));
});

await scenario('托管环境禁止 worker：电脑改在主线程思考，照样应答', { width: 1280, height: 800 }, async page => {
	await page.addInitScript(() => { window.Worker = function () { throw new Error('worker-src blocked'); }; });
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'd2');
	await click(page, 'd4');
	await waitMoves(page, 2);
	assert.equal((await moves(page))[0], 'd4');
});

await scenario('设置：棋盘主题与棋子套装', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await page.click('[data-act="settings"]');
	await page.click('#dlg-settings [data-setting="board"] [data-value="brown"]');
	await page.click('#dlg-settings [data-setting="pieces"] [data-value="fantasy"]');
	assert.deepEqual(await page.evaluate(() => [document.body.dataset.board, document.body.dataset.pieces]), ['brown', 'fantasy']);
	await page.reload();
	assert.equal(await page.evaluate(() => document.body.dataset.board), 'brown', '设置应持久化');
});

await scenario('手机：触屏拖拽走子', { width: 390, height: 844 }, async (page, ctx) => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	const cdp = await ctx.newCDPSession(page);
	const [x1, y1] = await point(page, 'g1'), [x2, y2] = await point(page, 'f3');
	const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
	await touch('touchStart', x1, y1);
	for (let i = 1; i <= 8; i++) await touch('touchMove', x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8);
	await touch('touchEnd');
	await waitMoves(page, 1);
	assert.equal((await moves(page))[0], 'Nf3');
});

await browser.close();
server.close();
if (errors.length) { console.log('页面错误：\n  ' + errors.join('\n  ')); process.exitCode = 1; }
console.log(`\n${passed} 个场景通过${process.exitCode ? '，有失败' : ''}`);
