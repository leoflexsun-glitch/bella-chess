// 端到端：在真浏览器里打开打包后的 index.html，走完主要流程。
//   npm run e2e
// 需要 Playwright 与 Chromium：npm i -D playwright && npx playwright install chromium
// （也可用环境变量 PLAYWRIGHT_PATH 指向已安装的 playwright 包目录）

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fromFen, generateMoves, makeMove, sanOf, pieceList, squareName, WHITE } from '../../src/chess/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

// 发布形态就是单个 index.html；另外放出 src/core 下的模块，供音频这类单元级场景直接导入。
const server = createServer(async (req, res) => {
	if (/^\/src\/core\/[\w-]+\.js$/.test(req.url)) {
		const body = await readFile(path.join(root, req.url)).catch(() => null);
		if (body) res.writeHead(200, { 'content-type': 'text/javascript' }).end(body);
		else res.writeHead(404).end();
		return;
	}
	// 同源的空白页：测试里用来改存储，又不运行本应用
	if (req.url === '/blank') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>blank</title>'); return; }
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
	// 场景里另开的标签页（多标签页场景）也要收集页面错误
	ctx.on('page', page => {
		page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
		page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
	});
	const page = await ctx.newPage();
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
	const box = await page.locator(`${selector} .b2d-grid`).boundingBox();   // 格子区，不含外框
	const flipped = await page.evaluate(sel => document.querySelector(`${sel} .cf`)?.textContent === 'h', selector);
	let f = square.charCodeAt(0) - 97, r = 8 - Number(square[1]);
	if (flipped) { f = 7 - f; r = 7 - r; }
	const s = box.width / 8;
	return [box.x + (f + 0.5) * s, box.y + (r + 0.5) * s];
}
const click = async (page, sq, sel) => page.mouse.click(...await point(page, sq, sel));
const moves = page => page.$$eval('.moves [data-ply]', els => els.map(e => e.textContent));
// 本页这局的存档（每局一条；本页在下哪局记在 sessionStorage）。
const ownSave = page => page.evaluate(() => {
	const k = JSON.parse(sessionStorage.getItem('frostfall.current'));
	return k && JSON.parse(localStorage.getItem(k));
});
const waitMoves = (page, n) => page.waitForFunction(k => document.querySelectorAll('.moves [data-ply]').length >= k, n, { timeout: 20000 });
// 改存档后刷新。测试直接改了存储，应用并不知道：它在切后台/关页时（pagehide，随后 visibilitychange）
// 会把进行中的本局写回存档位，所以在这两个事件里排在应用之后再写一次。game 为 null 表示清空全部存储。
async function reloadWith(page, game) {
	await page.evaluate(g => {
		const write = () => {
			if (!g) { localStorage.clear(); sessionStorage.clear(); return; }
			localStorage.setItem('frostfall.game.t', JSON.stringify(g));
			sessionStorage.setItem('frostfall.current', '"frostfall.game.t"');   // 当作本页刷新前在下的那局
		};
		write();
		addEventListener('pagehide', write);
		document.addEventListener('visibilitychange', write);
	}, game);
	await page.reload();
}
const fresh = async page => { await page.goto(URL); await reloadWith(page, null); };

// 模拟标签页切到后台 / 回到前台。
const hideTab = page => page.evaluate(() => {
	Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
	document.dispatchEvent(new Event('visibilitychange'));
});
const showTab = page => page.evaluate(() => {
	delete document.hidden;
	document.dispatchEvent(new Event('visibilitychange'));
	dispatchEvent(new Event('focus'));                   // 切到一个标签页，它同时获得焦点
});

// 一盘 40 个半步、未终局的对局（固定生成），测试长棋谱用。
const LONG_GAME = [
	'b2b4', 'd7d6', 'c1b2', 'h7h6', 'b2c3', 'a7a6', 'c3d4', 'b8c6', 'd4a7', 'h8h7', 'g1f3', 'c6b4', 'f3g1', 'd8d7', 'a2a3', 'd7h3',
	'a7b8', 'h3e3', 'a3b4', 'e8d8', 'a1a5', 'e3c5', 'f2f3', 'c8f5', 'd2d4', 'c5c3', 'b1d2', 'c3c4', 'd4d5', 'c4c3', 'h2h3', 'e7e6',
	'a5a2', 'e6d5', 'b8c7', 'd8c7', 'a2a3', 'd5d4', 'a3a6', 'f8e7'];
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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
	await reloadWith(page, { fen: '8/P6k/7p/8/8/8/8/K7 w - - 0 1', moves: [], human: 8, level: 'novice' });
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
	const saved = await ownSave(page);
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
	const saved = await ownSave(page);
	assert.deepEqual([saved.fen, saved.moves.length], ['6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 0]);
});

await scenario('拍照复刻：截图导入 → 自动定位 → 识别 → 核对 → 开全新一局', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	// 轮到黑方（人）走：截图前电脑不会动棋
	const fen = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R b KQ - 0 8';
	await page.evaluate(() => localStorage.setItem('frostfall.v2', JSON.stringify({ board: 'pale', pieces: 'celtic' })));
	await reloadWith(page, { fen, moves: [], human: 16, level: 'novice', flipped: true });
	// 等启动遮罩淡出并移除：淡出途中截图，整页蒙着一层半透明底色，识别会偶发出错
	await page.waitForSelector('#boot', { state: 'detached' });
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

// 特效铁律：任何动效都不能遮挡棋子。测试时让特效/标记/箭头层也参与命中检测，
// 动画进行中逐个检查棋子中心，命中的必须是棋子本身。
async function assertPiecesUnobscured(page, label) {
	const bad = await page.evaluate(() => {
		const out = [];
		for (const el of document.querySelectorAll('#board2d .b2d-pieces .pc:not(.gone):not(.moving)')) {
			const r = el.getBoundingClientRect();
			const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			if (hit !== el) out.push(`${el.dataset.p} 被 ${hit?.className?.baseVal ?? hit?.className} 遮挡`);
		}
		return out;
	});
	assert.deepEqual(bad, [], `${label}：${bad.join('；')}`);
}
const exposeEffects = page => page.addStyleTag({ content: '.b2d-fx, .b2d-fx *, .b2d-marks, .b2d-marks *, .b2d-arrows, .b2d-arrows * { pointer-events: auto !important; }' });

// 装作有震动马达的触屏设备：记录震动调用。
const fakeVibrator = () => {
	window.vib = [];
	navigator.vibrate = p => { window.vib.push(p); return true; };
	const mm = window.matchMedia.bind(window);
	window.matchMedia = q => q === '(pointer: coarse)' ? { matches: true, media: q } : mm(q);
};

await scenario('特效不遮挡棋子：吃子波纹、将军脉冲、胜利金光、提示箭头', { width: 1280, height: 800 }, async page => {
	await page.addInitScript(fakeVibrator);
	await fresh(page);
	// 恢复一盘"正被将军"的存档：只显示将军标记，不重放将军脉冲、不震动
	await reloadWith(page, { fen: '4k3/8/8/8/4r3/8/8/4K3 w - - 0 1', moves: [], human: 8, level: 'novice' });
	await page.waitForTimeout(300);
	assert.equal(await page.locator('#board2d .mk.check').count(), 1, '被将军的王应有将军标记');
	assert.equal(await page.locator('#board2d .fx-check').count(), 0, '恢复存档不应重放将军脉冲');
	assert.deepEqual(await page.evaluate(() => window.vib), [], '恢复存档不应震动');

	// 白车 e1 吃 e4 并将军 e8：两个特效都不在 a8 角上，缩放漂移才测得出来
	await reloadWith(page, { fen: '4k3/8/8/8/4r3/8/8/4R1K1 w - - 0 1', moves: [], human: 8, level: 'novice' });
	await exposeEffects(page);
	await click(page, 'e1');
	await click(page, 'e4');
	const seen = new Set();
	let t = 0;
	for (const at of [40, 150, 260, 370]) {
		await page.waitForTimeout(at - t);
		t = at;
		for (const c of await page.$$eval('#board2d .fx', els => els.map(e => e.className))) seen.add(c);
		await assertPiecesUnobscured(page, `吃子+将军 ${t}ms`);
		// 动画中特效中心必须一直对准目标格中心
		const drift = await page.evaluate(() => {
			const g = document.querySelector('#board2d .b2d-grid').getBoundingClientRect(), s = g.width / 8;
			return [...document.querySelectorAll('#board2d .fx')].map(el => {
				const r = el.getBoundingClientRect(), x = +el.style.getPropertyValue('--x'), y = +el.style.getPropertyValue('--y');
				return Math.hypot(r.left + r.width / 2 - (g.left + (x + .5) * s), r.top + r.height / 2 - (g.top + (y + .5) * s)) / s;
			});
		});
		assert.ok(drift.every(d => d < .05), `${t}ms 特效偏离格心 ${drift.map(d => d.toFixed(2))} 格`);
	}
	assert.ok([...seen].some(c => c.includes('fx-capture')), '应出现吃子波纹');
	assert.ok([...seen].some(c => c.includes('fx-check')), '应出现将军脉冲');
	// 吃子同时将军只震将军的两下：连着调用时后一个会打断前一个，吃子那一下根本震不出来
	assert.deepEqual((await page.evaluate(() => window.vib))[0], [12, 60, 12], '吃子并将军：只震将军');
	await waitMoves(page, 2);
	assert.equal(await page.locator('#board2d .fx-check').count(), 0, '对方应着后，旧的将军脉冲应收掉');

	// 一步杀：Qg8#（后在 g1，王 b6 挡住对角线，黑王不在被将军状态），胜方王格金光
	await reloadWith(page, { fen: 'k7/8/1K6/8/8/8/8/6Q1 w - - 0 1', moves: [], human: 8, level: 'novice' });
	await exposeEffects(page);
	await page.keyboard.press('h');                      // 提示箭头（应在棋子之下）
	await page.waitForSelector('#board2d .b2d-arrows line', { state: 'attached', timeout: 8000 })   // 竖直的箭头包围盒宽为 0，按"可见"等会一直等不到;
	await assertPiecesUnobscured(page, '提示箭头');
	assert.equal(await page.locator('#board2d .mk.hint-from').count(), 1, '提示起点格应有绿框');
	assert.equal(await page.locator('#board2d .mk.hint-to').count(), 1, '提示落点格应有绿框（吃子时箭头头部在棋子下）');
	await click(page, 'g1');
	await click(page, 'g8');
	await page.waitForSelector('#board2d .fx-win', { timeout: 3000 });
	for (let i = 0; i < 4; i++) { await page.waitForTimeout(250); await assertPiecesUnobscured(page, `胜利金光 ${i}`); }
	assert.ok(await page.locator('#board2d .mk.win').count() === 1, '胜方王格应有金色底光');
	assert.match(await page.textContent('[data-slot=result-stats]'), /共 1 回合 · 用时 \d+:\d\d · 吃子 0 次/);
	assert.equal(await page.textContent('[data-slot=status]'), '你赢了！', '状态行要能看到胜负（小屏上结算卡可能在屏幕外）');
	assert.equal(await page.textContent('[data-slot=eval-text]'), '终局 1-0', '终局显示比分而不是过期的引擎分');
	// 金光还在播时翻转棋盘：金光要跟着白王一起到翻转后的位置
	assert.equal(await page.locator('#board2d .fx-win').count(), 1, '此时金光应仍在播放');
	await page.keyboard.press('f');
	const off = await page.evaluate(() => {
		const c = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
		const [fx, king] = [c(document.querySelector('#board2d .fx-win')), c(document.querySelector('#board2d .pc[data-p=wK]'))];
		return Math.hypot(fx[0] - king[0], fx[1] - king[1]) / (document.querySelector('#board2d .b2d-grid').getBoundingClientRect().width / 8);
	});
	assert.ok(off < .05, `翻转后金光偏离白王 ${off.toFixed(2)} 格`);
});

// 结算统计：用时只计在页面上下棋的时间（存档里记的是已用时长）；回合按棋谱编号算。
await scenario('结算统计：用时不含关页时间、黑先局面回合数', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	// 黑先局面：1... Kb8 已走（存档重放），轮到白方 2. Qg8#——两个半步跨两个回合编号。
	// 存档已用 2 分 5 秒；startedAt 是旧版字段（一天前），不应再被当作开局时刻。
	await reloadWith(page, {
		fen: 'k7/8/1K6/8/8/8/8/6Q1 b - - 0 1', moves: ['a8b8'], human: 8, level: 'novice',
		elapsed: 125000, startedAt: Date.now() - 86400000
	});
	// 思考一会儿后切到后台：应立刻存下已用时长（之前只在走子时存，刷新会丢掉这段思考时间）
	await page.waitForTimeout(1200);
	await hideTab(page);
	await showTab(page);
	const saved = (await ownSave(page)).elapsed;
	assert.ok(saved >= 126000 && saved < 130000, `切后台时应存下已用时长，实际 ${saved}`);
	await click(page, 'g1');
	await click(page, 'g8');
	await page.waitForSelector('[data-slot=result]:not([hidden])', { timeout: 3000 });
	assert.match(await page.textContent('[data-slot=result-stats]'), /^共 2 回合 · 用时 2:0\d · 吃子 0 次$/);
});

// 升变选择打开时悔棋，而且没有可悔的棋：棋盘要回到真实局面（兵在第 7 行），不能停在底线。
await scenario('升变待选时悔棋失败：兵回到原格', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: 'k7/4P3/8/8/8/8/8/K7 w - - 0 1', moves: [], human: 8, level: 'novice' });
	const [x1, y1] = await point(page, 'e7'), [x2, y2] = await point(page, 'e8');
	await page.mouse.move(x1, y1);
	await page.mouse.down();
	await page.mouse.move(x2, y2, { steps: 6 });
	await page.mouse.up();
	await page.waitForSelector('#board2d .b2d-promo:not([hidden])');
	await page.keyboard.press('u');
	await page.waitForTimeout(350);
	assert.ok(await page.locator('#board2d .b2d-promo').isHidden(), '升变选择应收起');
	const pawn = await page.$eval('#board2d .pc[data-p=wP]', el => [el.style.getPropertyValue('--x'), el.style.getPropertyValue('--y')]);
	assert.deepEqual(pawn, ['4', '1'], '兵应回到 e7');
	await click(page, 'e7');
	assert.ok(await page.locator('#board2d .mk.dot').count() >= 1, 'e7 的兵应能再次选中');
});

// 手机上棋谱是横排的一条：最新一步要滚进可见区，看起始局面时回到最左。
await scenario('手机横排棋谱：当前着法始终可见', { width: 375, height: 667 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: START, human: 8, level: 'novice', moves: LONG_GAME.slice(0, 32) });
	const visible = () => page.evaluate(() => {
		const box = document.querySelector('.moves').getBoundingClientRect(), r = document.querySelector('.moves .cur').getBoundingClientRect();
		return r.left >= box.left - 1 && r.right <= box.right + 1;
	});
	assert.ok(await page.evaluate(() => { const m = document.querySelector('.moves'); return m.scrollWidth > m.clientWidth; }), '棋谱应长到需要横向滚动');
	assert.ok(await visible(), '最新一步应在可见区');
	await page.locator('.moves [data-ply="0"]').click();
	await page.click('[data-act="review-prev"]');
	assert.equal(await page.evaluate(() => document.querySelector('.moves').scrollLeft), 0, '看起始局面时棋谱应回到最左');
});

// 小屏手机终局：结算卡把棋谱挤出屏幕，也不能带动整页滚动（棋盘顶行会藏到标题栏下）。
await scenario('小屏手机终局：页面不跳动、状态行看得到胜负', { width: 375, height: 667 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: 'k7/8/1K6/8/8/8/8/6Q1 w - - 0 1', moves: [], human: 8, level: 'novice' });
	await click(page, 'g1');
	await click(page, 'g8');
	await page.waitForSelector('[data-slot=result]:not([hidden])', { timeout: 3000 });
	await page.waitForTimeout(200);
	assert.equal(await page.evaluate(() => scrollY), 0, '终局时整页不应滚动');
	assert.equal(await page.textContent('[data-slot=status]'), '你赢了！');
});

// 每步动画落定后棋盘会按真实局面对账重建；玩家这时正拖着子，不能被打断。
await scenario('悔棋后立刻拖子：拖拽不被动画收尾打断', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	const [x1, y1] = await point(page, 'd2'), [x2, y2] = await point(page, 'd4');
	await page.keyboard.press('u');                      // 棋子开始滑回，约 230ms 后对账
	await page.mouse.move(x1, y1);
	await page.mouse.down();
	await page.mouse.move(x1, y1 - 20, { steps: 3 });
	await page.waitForTimeout(400);                      // 拖着不放，跨过对账时刻
	await page.mouse.move(x2, y2, { steps: 4 });
	await page.mouse.up();
	await waitMoves(page, 1);
	assert.equal((await moves(page))[0], 'd4', '悔棋后立刻拖的这步应生效');

	// 同样跨过对账时刻，但放到非法格：棋子要平滑弹回（同一个元素），不能被立即整盘重建打断
	await waitMoves(page, 2);
	const [x3, y3] = await point(page, 'c2'), [x4, y4] = await point(page, 'c6');
	await page.keyboard.press('u');
	await page.mouse.move(x3, y3);
	await page.mouse.down();
	await page.mouse.move(x3, y3 - 20, { steps: 3 });
	await page.evaluate(() => { window.held = document.querySelector('#board2d .pc.drag'); });
	await page.waitForTimeout(400);
	await page.mouse.move(x4, y4, { steps: 4 });
	await page.mouse.up();
	assert.ok(await page.evaluate(() => window.held?.isConnected), '弹回过程中棋子元素不应被替换');
	await page.waitForTimeout(400);
	assert.equal(await page.locator('#board2d .pc[data-p=wP]').count(), 8, '弹回后局面完整');
});

// 正常存档（带对局 id）刷新后：没走棋也要能存下用时和翻转（切后台/关页时）。
await scenario('刷新后切后台：用时与翻转照常存下', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	await page.reload();
	const before = await ownSave(page);
	await page.keyboard.press('f');
	await page.waitForTimeout(1200);
	await hideTab(page);
	const after = await ownSave(page);
	assert.equal(after.flipped, true, '翻转应存下');
	assert.ok(after.elapsed >= before.elapsed + 1000, `用时应增加：${before.elapsed} → ${after.elapsed}`);
});

// 在后台标签页里打开（如按住 Ctrl 点开、浏览器恢复会话）：切到前台之前不计时。
await scenario('后台标签页打开存档：切到前台前不计时', { width: 1280, height: 800 }, async page => {
	await page.addInitScript(() => {
		if (!localStorage.getItem('test.bg')) return;
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
		window.becomeVisible = () => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); };
	});
	await fresh(page);
	await page.evaluate(() => localStorage.setItem('test.bg', '1'));
	await reloadWith(page, { fen: 'k7/8/1K6/8/8/8/8/6Q1 w - - 0 1', moves: [], human: 8, level: 'novice', elapsed: 0 });
	await page.waitForTimeout(3000);                     // 在后台放了 3 秒
	await page.evaluate(() => window.becomeVisible());
	await click(page, 'g1');
	await click(page, 'g8');
	await page.waitForSelector('[data-slot=result]:not([hidden])', { timeout: 3000 });
	assert.match(await page.textContent('[data-slot=result-stats]'), /用时 0:0[01] /, '后台那 3 秒不应计入');
});

// 后台打开、又没有存档的页：用户切过来时要看到新对局对话框，而不是一个空棋盘。
await scenario('后台标签页打开（无存档）：切过来时看到新对局', { width: 1280, height: 800 }, async page => {
	await page.addInitScript(() => {
		if (!localStorage.getItem('test.bg')) return;
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
		window.becomeVisible = () => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); };
	});
	await fresh(page);
	await page.evaluate(() => localStorage.setItem('test.bg', '1'));
	await page.reload();
	await page.evaluate(() => window.becomeVisible());
	assert.ok(await page.isVisible('#dlg-new[open]'));
});

// 损坏或来路不明的存档（旧版本、手改、同域的别的应用）：不能卡在启动画面，按没有存档处理。
await scenario('损坏的存档：照常启动，回到新对局', { width: 1280, height: 800 }, async page => {
	for (const bad of [{ fen: '', moves: [], human: 8 }, { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [1], human: 8 }, { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], human: 3 },
		{ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], human: 16, level: 'toString' }]) {
		await fresh(page);
		await reloadWith(page, bad);
		await page.waitForSelector('#boot', { state: 'detached', timeout: 3000 });
		assert.ok(await page.isVisible('#dlg-new[open]'), `存档 ${JSON.stringify(bad)} 应按没有存档处理`);
	}
	// 没有 key 的合成键盘事件（自动填充、密码管理器会发）不应报错
	await page.evaluate(() => { dispatchEvent(new Event('keydown')); document.body.dispatchEvent(new Event('keydown', { bubbles: true })); });
});

// 浏览器禁用了 Web Audio：静音照常下棋，电脑照常应答。
await scenario('没有声音也能下：音频不可用时不影响走子', { width: 1280, height: 800 }, async page => {
	await page.addInitScript(() => {
		window.AudioContext = function () { throw new Error('Web Audio disabled'); };
		delete window.webkitAudioContext;
	});
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	assert.equal((await moves(page))[0], 'e4');
});

// 升变选择打开时去复盘或认输：选择框要收起，兵回到原格，不能留下"走了一半"的棋。
await scenario('升变待选时复盘、认输：选择框收起、棋盘不失步', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: 'k7/4P3/8/8/8/8/8/K7 w - - 0 1', moves: ['a1b1', 'a8b7'], human: 8, level: 'novice' });
	const promote = async () => {
		const [x1, y1] = await point(page, 'e7'), [x2, y2] = await point(page, 'e8');
		await page.mouse.move(x1, y1);
		await page.mouse.down();
		await page.mouse.move(x2, y2, { steps: 6 });
		await page.mouse.up();
		await page.waitForSelector('#board2d .b2d-promo:not([hidden])');
	};
	const pawnAt = () => page.$eval('#board2d .pc[data-p=wP]', el => [el.style.getPropertyValue('--x'), el.style.getPropertyValue('--y')]);
	await promote();
	await page.click('.moves [data-ply="1"]');           // 点的就是当前这一步：什么都不变，选择框应留着
	assert.ok(await page.locator('#board2d .b2d-promo').isVisible(), '没进入复盘时不应打断升变选择');
	await page.click('.moves [data-ply="0"]');           // 点更早的一步进入复盘
	assert.ok(await page.locator('#board2d .b2d-promo').isHidden(), '去复盘时升变选择应收起');
	await page.click('[data-act="review-exit"]');
	await page.waitForTimeout(350);
	assert.deepEqual(await pawnAt(), ['4', '1'], '回到当前局面，兵仍在 e7');
	// 翻转棋盘：选择框按翻转前的格子排布，应收起
	await promote();
	await page.keyboard.press('f');
	assert.ok(await page.locator('#board2d .b2d-promo').isHidden(), '翻转时升变选择应收起');
	assert.deepEqual(await pawnAt(), ['3', '6'], '翻转后兵在 e7（翻转坐标）');
	await page.keyboard.press('f');
	await page.waitForTimeout(300);
	await promote();
	await page.click('[data-act="resign"]');
	await page.click('[data-act="resign"]');
	await page.waitForSelector('[data-slot=result]:not([hidden])');
	await page.waitForTimeout(350);
	assert.ok(await page.locator('#board2d .b2d-promo').isHidden(), '认输后升变选择应收起');
	assert.deepEqual(await pawnAt(), ['4', '1'], '认输后兵画在 e7（那步升变没走成）');
});

// 悔棋动画还没落定就把兵拖到底线：选择框打开期间，动画收尾的对账不能把兵拉回原格。
await scenario('动画收尾时升变待选：兵停在底线等选择', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	// 已走 1. e8=Q+ Kb7；悔棋：后淡出、兵淡入、黑王滑回，约 230ms 后对账
	await reloadWith(page, { fen: 'k7/4P3/8/8/8/8/8/K7 w - - 0 1', moves: ['e7e8q', 'a8b7'], human: 8, level: 'novice' });
	const [x1, y1] = await point(page, 'e7'), [x2, y2] = await point(page, 'e8');
	await page.keyboard.press('u');
	await page.mouse.move(x1, y1);
	await page.mouse.down();
	await page.mouse.move(x2, y2, { steps: 3 });
	await page.mouse.up();
	await page.waitForSelector('#board2d .b2d-promo:not([hidden])');
	await page.waitForTimeout(400);                      // 跨过对账时刻
	const pawn = await page.$eval('#board2d .pc[data-p=wP]', el => el.style.getPropertyValue('--y'));
	assert.equal(pawn, '0', '选择框打开时兵应停在 e8');
	assert.equal(await page.locator('#board2d .pc.gone').count(), 0, '对账照常清掉淡出的残子（那颗后）');
	await page.click('#board2d .promo-choice[data-type="5"]');
	await page.waitForTimeout(300);
	assert.equal(await page.locator('#board2d .pc[data-p=wQ]').count(), 1, '选后升变为后');
});

// 按住方向键快速复盘：上一段的淡出还没收尾就开始下一段，看不见的残子不能越积越多。
await scenario('快速连按复盘：棋子元素不堆积', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: START, human: 8, level: 'novice', moves: LONG_GAME });
	// 往前走才会经过吃子、留下淡出的棋子：先退到开头，等落定，再快速往前
	for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
	await page.waitForTimeout(400);
	for (let i = 0; i < 39; i++) await page.keyboard.press('ArrowRight');
	const gone = await page.locator('#board2d .pc.gone').count();
	assert.ok(gone <= 1, `快速复盘时最多只剩最后一步正在淡出的棋子，实际 ${gone} 个`);
	await page.waitForTimeout(400);
	assert.equal(await page.locator('#board2d .pc.gone').count(), 0);
});

// 长对局认输：结算卡出现、棋谱区变矮（棋谱内容没变），最后一步仍要完整可见。
await scenario('长对局认输：结算卡出现后最后一步仍可见', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: START, human: 8, level: 'novice', moves: LONG_GAME });
	await page.click('[data-act="resign"]');
	await page.click('[data-act="resign"]');
	await page.waitForSelector('[data-slot=result]:not([hidden])');
	await page.waitForTimeout(100);
	assert.ok(await page.evaluate(() => {
		const box = document.querySelector('.moves').getBoundingClientRect(), r = document.querySelector('.moves .cur').getBoundingClientRect();
		return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
	}), '最后一步应完整可见');
});

// 棋谱：复盘换步只挪高亮（不重建列表）；用户手动翻看棋谱后，窗口尺寸变化不把它拽回当前步。
await scenario('棋谱：复盘只挪高亮，手动翻看不被拽回', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: START, human: 8, level: 'novice', moves: LONG_GAME });
	await page.evaluate(() => { document.querySelector('.moves [data-ply="5"]').marker = 1; });
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	assert.equal(await page.evaluate(() => document.querySelector('.moves [data-ply="5"]').marker), 1, '复盘换步不应重建棋谱列表');
	assert.equal(await page.locator('.moves .cur').getAttribute('data-ply'), '37');
	await page.evaluate(() => { document.querySelector('.moves').scrollTop = 0; });
	await page.waitForTimeout(100);
	await page.setViewportSize({ width: 1280, height: 700 });
	await page.waitForTimeout(200);
	assert.equal(await page.evaluate(() => document.querySelector('.moves').scrollTop), 0, '手动翻到开头后，缩放窗口不应把棋谱拽回当前步');
});

// 复盘到起始局面：棋谱列表回到顶部，而不是跳到最新几步。
await scenario('复盘到起始局面：棋谱列表回到顶部', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: START, human: 8, level: 'novice', moves: LONG_GAME });
	const list = await page.evaluate(() => { const m = document.querySelector('.moves'); return [m.scrollHeight, m.clientHeight, m.scrollTop]; });
	assert.ok(list[0] > list[1] && list[2] > 0, `棋谱应长到需要滚动，且停在最新处：${list}`);
	// 进入复盘时复盘条出现、棋谱区变矮：高亮的那步仍要完整可见
	await page.click('.moves [data-ply="38"]');
	assert.ok(await page.evaluate(() => {
		const box = document.querySelector('.moves').getBoundingClientRect(), r = document.querySelector('.moves .cur').getBoundingClientRect();
		return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
	}), '复盘条出现后，高亮的那步应完整可见');
	await page.click('.moves [data-ply="0"]');           // 点第一步进入复盘，再退到起始局面
	await page.click('[data-act="review-prev"]');
	assert.match(await page.textContent('[data-slot=review]'), /起始局面/);
	assert.equal(await page.evaluate(() => document.querySelector('.moves').scrollTop), 0, '看起始局面时棋谱应在顶部');
});

// 音频上下文建好了，但发声时出错（个别内核）：照常下棋。
await scenario('没有声音也能下：发声时出错不影响走子', { width: 1280, height: 800 }, async page => {
	await page.addInitScript(() => {
		const boom = () => { throw new Error('Web Audio broken'); };
		window.AudioContext = class {
			state = 'running'; currentTime = 0; sampleRate = 44100; destination = {};
			createWaveShaper() { return { connect: x => x }; }
			createGain() { return { gain: { value: 1 }, connect: x => x }; }
			createOscillator = boom; createBuffer = boom; createBufferSource = boom; createBiquadFilter = boom;
		};
	});
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	assert.equal((await moves(page))[0], 'e4');
});

// 沙箱 iframe、禁用站点数据等环境：一碰 localStorage 就抛错。页面照样能打开、能下棋（只是不存档）。
await scenario('存储不可用：页面照常可用', { width: 1280, height: 800 }, async page => {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
	});
	await page.goto(URL);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	assert.equal((await moves(page))[0], 'e4');
});

// "再按一次认输"只对当前这局有效：按了一次又改主意去开新局，新局里按一次不能直接认输。
await scenario('认输确认不跨局', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	await page.click('[data-act="resign"]');             // 按了一次（待确认）
	await page.click('.topbar [data-act="new"]');
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'd2');
	await click(page, 'd4');
	await waitMoves(page, 2);
	await page.click('[data-act="resign"]');             // 新局里只按一次
	await page.waitForTimeout(200);
	assert.ok(await page.isHidden('[data-slot=result]:not([hidden])'), '不应直接认输');
});

// 系统开了"减少动态效果"：特效不显示，被吃棋子不淡出，结算卡不浮起。
await scenario('减少动态效果：特效与过渡全部关闭', { width: 1280, height: 800 }, async page => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await fresh(page);
	const style = await page.evaluate(() => {
		const probe = (parent, cls) => { const el = document.createElement('i'); el.className = cls; parent.append(el); const cs = getComputedStyle(el); const r = { display: cs.display, transition: cs.transitionDuration, animation: cs.animationName }; el.remove(); return r; };
		const card = document.querySelector('.result-card');
		card.hidden = false;
		const cardAnim = getComputedStyle(card).animationName;
		card.hidden = true;
		return {
			fx: probe(document.querySelector('#board2d .b2d-fx'), 'fx fx-win').display,
			gone: probe(document.querySelector('#board2d .b2d-pieces'), 'pc wP gone').transition,
			card: cardAnim
		};
	});
	assert.deepEqual(style, { fx: 'none', gone: '0s', card: 'none' });
	// 正常模式下：淡出的棋子保留位移过渡（滑到一半被淡出时不先跳到终点）
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	const gone = await page.evaluate(() => {
		const el = Object.assign(document.createElement('i'), { className: 'pc wP gone' });
		document.querySelector('#board2d .b2d-pieces').append(el);
		const t = getComputedStyle(el).transitionProperty;
		el.remove();
		return t;
	});
	assert.match(gone, /transform/);
});

await scenario('设置：棋盘主题与棋子套装', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await page.click('[data-act="settings"]');
	await page.click('#dlg-settings [data-setting="board"] [data-value="mist"]');
	await page.click('#dlg-settings [data-setting="pieces"] [data-value="fantasy"]');
	assert.deepEqual(await page.evaluate(() => [document.body.dataset.board, document.body.dataset.pieces]), ['mist', 'fantasy']);
	// 定位开关本身（新旧版本都有这个元素）；桌面 Chrome 有 navigator.vibrate 但没有马达
	assert.ok(await page.locator('#dlg-settings [data-setting=haptics]').isHidden(), '桌面电脑没有震动马达，不显示震动开关');
	const [row, field] = await page.evaluate(() => {
		const seg = document.querySelector('#dlg-settings [data-setting=sound]');
		return [seg.parentElement.getBoundingClientRect().width, seg.closest('.field').getBoundingClientRect().width];
	});
	assert.ok(row > field * .9, `震动隐藏后「声音」应占满整行（${row}/${field}）`);
	await page.reload();
	assert.equal(await page.evaluate(() => document.body.dataset.board), 'mist', '设置应持久化');
});

await scenario('手机：触屏拖拽走子、震动反馈与开关', { width: 390, height: 844 }, async (page, ctx) => {
	await page.addInitScript(fakeVibrator);
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
	await waitMoves(page, 2);
	assert.deepEqual(await page.evaluate(() => window.vib), [8, 8], '人和电脑各走一步，各轻震一下');
	await page.click('[data-act="settings"]');
	await page.click('#dlg-settings [data-setting="haptics"] [data-value="off"]');
	await page.evaluate(() => { window.vib = []; });
	await page.keyboard.press('Escape');
	await click(page, 'e2'); await click(page, 'e4');
	await waitMoves(page, 4);
	assert.deepEqual(await page.evaluate(() => window.vib), [], '关掉震动后不应再震');
});

// 音效离线渲染：每声不削波；同一上下文里第一声与后续落子音量一致（曾因压限器初始状态，开局第一声小约 11 dB）。
await scenario('音效：不削波、第一声不偏小', { width: 800, height: 600 }, async page => {
	await page.goto(URL);
	const r = await page.evaluate(async () => {
		const { createAudio } = await import('/src/core/audio.js');
		const offline = () => {
			const off = new OfflineAudioContext(1, 44100 * 3, 44100);
			Object.defineProperty(off, 'state', { get: () => 'running' });   // 离线渲染没有"挂起待解锁"这回事
			off.go = off.resume.bind(off);
			off.resume = () => Promise.resolve();          // 由这里在排好声音后再继续渲染
			window.AudioContext = function () { return off; };
			return off;
		};
		const peak = (d, a = 0, b = d.length) => { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(d[i])); return p; };
		const loud = {};
		for (const [name, arg] of [['place'], ['capture'], ['castle'], ['promote'], ['check'], ['start'], ['end', 'win'], ['end', 'lose'], ['deny']]) {
			const off = offline();
			createAudio()[name](arg);
			loud[name + (arg ? '-' + arg : '')] = peak((await off.startRendering()).getChannelData(0));
		}
		const off = offline(), a = createAudio(), times = [0.5, 1, 2];
		a.place();
		for (const t of times) off.suspend(t).then(() => { a.place(); off.go(); });
		const d = (await off.startRendering()).getChannelData(0), cut = [0, ...times, 3].map(t => t * 44100);
		return { loud, seq: cut.slice(0, -1).map((c, i) => 20 * Math.log10(peak(d, c, cut[i + 1]))) };
	});
	for (const [k, p] of Object.entries(r.loud)) assert.ok(p > 0.01 && p < 0.9, `${k} 峰值 ${p.toFixed(3)} 应在 (0.01, 0.9)`);
	const spread = Math.max(...r.seq) - Math.min(...r.seq);
	assert.ok(spread < 3, `连续落子音量差 ${spread.toFixed(1)} dB（${r.seq.map(v => v.toFixed(1))}）`);
});

// 嵌在 iframe 里、焦点在开发者工具等：页面可见但 hasFocus() 为 false，照常打开时仍要恢复存档。
await scenario('可见但没有焦点时打开：照常恢复存档', { width: 1280, height: 800 }, async page => {
	await page.addInitScript(() => { if (localStorage.getItem('test.nofocus')) document.hasFocus = () => false; });
	await fresh(page);
	await page.evaluate(() => localStorage.setItem('test.nofocus', '1'));
	await reloadWith(page, { fen: START, moves: ['e2e4', 'e7e5'], human: 8, level: 'novice', elapsed: 0 });
	await page.waitForSelector('#boot', { state: 'detached', timeout: 3000 });
	assert.deepEqual(await moves(page), ['e4', 'e5']);
	assert.ok(await page.isHidden('#dlg-new[open]'), '不应弹出新对局对话框');
});

// 多个标签页各下各的：互不覆盖，各自刷新回到自己那局。新开的页在新对局对话框里列出没下完的局。
await scenario('多标签页：各下各的，刷新各回各的局', { width: 1280, height: 800 }, async (page, ctx) => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	const b = await ctx.newPage();
	await b.goto(URL);
	await b.waitForSelector('#dlg-new[open]');
	assert.equal(await b.locator('#dlg-new .saved-item').count(), 1, '新开的页列出 A 那局');
	await b.click('#dlg-new [data-act="start"]');      // B 开自己的新局
	await click(b, 'd2');
	await click(b, 'd4');
	await waitMoves(b, 2);
	await click(page, 'g1');                             // A 接着下自己的
	await click(page, 'f3');
	await waitMoves(page, 4);
	await page.reload();
	await b.reload();
	await waitMoves(page, 4);
	await waitMoves(b, 2);
	assert.equal((await moves(page))[0], 'e4');
	assert.equal((await moves(b))[0], 'd4');
	assert.ok(await page.isHidden('#dlg-new[open]') && await b.isHidden('#dlg-new[open]'), '刷新直接回到本页那局');
});

await scenario('多标签页：新开的页从列表选一局接着下，两边互不影响；下完的局不再列出', { width: 1280, height: 800 }, async (page, ctx) => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	const c = await ctx.newPage();
	await c.goto(URL);
	await c.click('#dlg-new .saved-item');
	await waitMoves(c, 2);
	assert.ok(await c.isHidden('#dlg-new[open]'));
	assert.equal((await moves(c))[0], 'e4');
	await click(c, 'd2');                                // C 接着下这局的一个分支
	await click(c, 'd4');
	await waitMoves(c, 4);
	await click(page, 'g1');                             // A 下另一个分支
	await click(page, 'f3');
	await waitMoves(page, 4);
	await page.reload();
	await c.reload();
	await waitMoves(page, 4);
	await waitMoves(c, 4);
	assert.equal((await moves(page))[2], 'Nf3');
	assert.equal((await moves(c))[2], 'd4');
	// C 认输：这局下完，新开的页只列出 A 那局
	await c.click('.controls [data-act="resign"]');
	await c.click('.controls [data-act="resign"]');
	await c.waitForSelector('[data-slot=result]:not([hidden])');
	const d = await ctx.newPage();
	await d.goto(URL);
	await d.waitForSelector('#dlg-new[open]');
	assert.equal(await d.locator('#dlg-new .saved-item').count(), 1);
});

await scenario('多标签页：列表里的局已在别的页面下完，点它刷新列表', { width: 1280, height: 800 }, async (page, ctx) => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	const b = await ctx.newPage();
	await b.goto(URL);
	await b.waitForSelector('#dlg-new .saved-item');
	await page.click('.controls [data-act="resign"]');
	await page.click('.controls [data-act="resign"]');
	await page.waitForSelector('[data-slot=result]:not([hidden])');
	await b.click('#dlg-new .saved-item');
	await b.waitForSelector('#dlg-new [data-slot=saved][hidden]', { state: 'attached', timeout: 1000 });
	assert.ok(await b.isVisible('#dlg-new[open]'), '弹窗留着，可以开新局');
});

// 列表里的局恢复出来直接是终局（比如旧版本写下的）：只结束这局，本页原来那局要留在列表里。
await scenario('接着下的局恢复后即终局：本页原来那局不被删', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'e2');
	await click(page, 'e4');
	await waitMoves(page, 2);
	await page.evaluate(start => localStorage.setItem('frostfall.game.mated', JSON.stringify(
		{ fen: start, moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'], human: 8, level: 'novice', elapsed: 0, savedAt: Date.now() })), START);
	await page.click('.topbar [data-act="new"]');
	await page.click('#dlg-new .saved-item >> nth=0');
	await page.waitForSelector('[data-slot=result]:not([hidden])');
	await page.click('.topbar [data-act="new"]');
	assert.equal(await page.locator('#dlg-new .saved-item').count(), 1, '原来那局还在列表里');
});

await scenario('存档列表：不是今年的局带上年份', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.evaluate(start => localStorage.setItem('frostfall.game.old', JSON.stringify(
		{ fen: start, moves: ['e2e4'], human: 8, level: 'novice', elapsed: 0, savedAt: new Date(2020, 9, 21, 9, 5).getTime() })), START);
	await page.reload();
	assert.match(await page.textContent('#dlg-new .saved-item span'), /2020年10月21日 09:05/);
});

// ── 主链路：只用界面，随机走合法着法直到终局 ─────────────────────────
// 每一步后都拿规则引擎按棋谱重放出的局面，对照棋盘上实际画出的棋子；中途插入悔棋、提示、翻转、复盘、刷新。
// 随机着法会自然走到吃子、易位、吃过路兵、升变（含选择框）等。

const CODE = 'PNBRQK';
function replay(fen, sans) {
	const pos = fromFen(fen);
	for (const san of sans) {
		const move = generateMoves(pos).find(m => sanOf(pos, m) === san);
		assert.ok(move, `棋谱里的 ${san} 在该局面下不合法（${sans.join(' ')}）`);
		makeMove(pos, move);
	}
	return pos;
}
const expected = pos => pieceList(pos).map(({ sq, type, color }) => squareName(sq) + (color === WHITE ? 'w' : 'b') + CODE[type - 1]).sort();
const drawn = page => page.evaluate(() => {
	const flipped = document.querySelector('#board2d .cf')?.textContent === 'h';
	return [...document.querySelectorAll('#board2d .b2d-pieces .pc:not(.gone)')].map(el => {
		let x = Number(el.style.getPropertyValue('--x')), y = Number(el.style.getPropertyValue('--y'));
		if (flipped) { x = 7 - x; y = 7 - y; }
		return 'abcdefgh'[x] + (8 - y) + el.dataset.p;
	}).sort();
});
// 棋盘画面与规则局面一致（动画收尾有先后，给 1.5 秒）。
async function boardMatches(page, pos, label) {
	const want = expected(pos);
	let got;
	for (let i = 0; i < 15; i++) {
		got = await drawn(page);
		if (got.join() === want.join()) return;
		await page.waitForTimeout(100);
	}
	assert.deepEqual(got, want, `${label}：棋盘画面与规则局面不一致`);
}
const resultShown = page => page.isVisible('[data-slot=result]:not([hidden])');

async function playOut(page, { fen = START, human, seed, maxPlies = 160, label }) {
	let r = seed;
	const rand = n => { r = (r * 1103515245 + 12345) >>> 0; return (r >>> 16) % n; };
	const humanColor = human === 'b' ? 16 : 8;
	let step = 0;
	for (;;) {
		// 等到轮到人走（电脑应完）或终局
		await page.waitForFunction(([hc]) => {
			if (!document.querySelector('[data-slot=result]')?.hidden) return true;
			const n = document.querySelectorAll('.moves [data-ply]').length;
			return window.__turnOf?.(n) === hc;
		}, [humanColor], { timeout: 30000 }).catch(() => {});
		const sans = await moves(page);
		const pos = replay(fen, sans);
		await boardMatches(page, pos, `${label} 第 ${sans.length} 步后`);
		if (await resultShown(page)) {
			const legal = generateMoves(pos);
			assert.ok(!legal.length || pos.half >= 100 || /和|认输|重复|子力/.test(await page.textContent('[data-slot=result]')), `${label}：还有合法着法却显示了结算（${sans.join(' ')}）`);
			return sans;
		}
		assert.equal(pos.turn, humanColor, `${label}：等到的不是人走（${sans.join(' ')}）`);
		const legal = generateMoves(pos);
		assert.ok(legal.length, `${label}：没有合法着法却没显示结算（${sans.join(' ')}）`);
		if (sans.length >= maxPlies) {                        // 太长：认输收尾
			await page.click('.controls [data-act="resign"]');
			await page.click('.controls [data-act="resign"]');
			await page.waitForSelector('[data-slot=result]:not([hidden])', { timeout: 3000 });
			return sans;
		}
		step++;
		// 穿插辅助操作
		if (step === 3) {                                     // 提示：出现箭头
			await page.click('.controls [data-act="hint"]');
			await page.waitForSelector('#board2d .b2d-arrows line', { state: 'attached', timeout: 8000 });
		}
		if (step === 4) {                                     // 翻转
			await page.click('.controls [data-act="flip"]');
			await boardMatches(page, pos, `${label} 翻转后`);
		}
		if (step === 5 && sans.length >= 3) {                 // 复盘到第 1 步，再回到当前
			await page.click('.moves [data-ply] >> nth=0');
			await boardMatches(page, replay(fen, sans.slice(0, 1)), `${label} 复盘第 1 步`);
			await page.click('[data-act="review-exit"]');
			await boardMatches(page, pos, `${label} 复盘回到当前`);
		}
		if (step === 6) {                                     // 刷新：回到同一局
			await page.reload();
			await page.waitForSelector('#boot', { state: 'detached', timeout: 5000 });
			assert.deepEqual(await moves(page), sans, `${label}：刷新后棋谱应不变`);
			await boardMatches(page, pos, `${label} 刷新后`);
		}
		if (step === 8 && sans.length >= 4) {                 // 悔棋：退回上一次轮到人走
			await page.click('.controls [data-act="undo"]');
			await page.waitForTimeout(400);
			const back = await moves(page);
			assert.ok(back.length < sans.length, `${label}：悔棋后棋谱应变短`);
			await boardMatches(page, replay(fen, back), `${label} 悔棋后`);
			continue;
		}
		const move = legal[rand(legal.length)];
		await click(page, squareName(move.from));
		await click(page, squareName(move.to));
		if (move.promotion) {
			await page.click(`.promo-choice[data-type="${move.promotion}"]`);
		}
		await page.waitForFunction(n => document.querySelectorAll('.moves [data-ply]').length > n, sans.length, { timeout: 5000 })
			.catch(() => { throw new Error(`${label}：点 ${squareName(move.from)}→${squareName(move.to)}（${sanOf(pos, move)}）没有走出（${sans.join(' ')}）`); });
	}
}

// 页面里给测试用的"第 n 步后轮到谁"：按棋谱条数与起始行棋方推算。
const exposeTurn = (page, fen) => page.addInitScript(f => {
	const first = f.split(' ')[1] === 'b' ? 16 : 8;
	window.__turnOf = n => (n % 2 === 0 ? first : (first === 8 ? 16 : 8));
}, fen);

for (const [label, viewport, side, seed] of [
	['桌面执白', { width: 1280, height: 800 }, 'w', 7],
	['手机执黑', { width: 390, height: 844 }, 'b', 11],
	['桌面执白 2', { width: 1280, height: 800 }, 'w', 29]
]) {
	await scenario(`主链路：${label}，随机走完整盘，画面始终与规则一致`, viewport, async page => {
		await exposeTurn(page, START);
		await fresh(page);
		await page.click(`#dlg-new [data-setting="side"] [data-value="${side}"]`);
		await page.click('#dlg-new [data-setting="level"] [data-value="novice"]');
		await page.click('#dlg-new [data-act="start"]');
		const sans = await playOut(page, { human: side, seed, label });
		assert.ok(await resultShown(page), `${label}：应显示结算`);
		const special = ['O-O', 'x', '='].filter(t => sans.some(m => m.includes(t))).join(' ');
		console.log(`     ${label}：${sans.length} 步，${(await page.textContent('[data-slot=result-title]')).trim()}；出现过 ${special}`);
		// 再来一局：同一执子方的全新一局
		await page.click('[data-act="rematch"]');
		await page.waitForFunction(() => document.querySelector('[data-slot=result]').hidden);
		if (side === 'b') await waitMoves(page, 1);
		assert.ok((await moves(page)).length <= 1, `${label}：再来一局应清空棋谱（上一局 ${sans.length} 步）`);
		await boardMatches(page, replay(START, await moves(page)), `${label} 再来一局`);
	});
}

await scenario('主链路：界面上易位、吃过路兵', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	// 白王车在原位、可短易位；e5 兵旁边黑兵刚走 d7d5，可吃过路兵
	const fen = 'r3k2r/ppp2ppp/8/3pP3/8/8/PPP2PPP/R3K2R w KQkq d6 0 1';
	await exposeTurn(page, fen);
	await reloadWith(page, { fen, moves: [], human: 8, level: 'novice', elapsed: 0 });
	await page.waitForSelector('#boot', { state: 'detached', timeout: 3000 });
	await click(page, 'e5');
	await click(page, 'd6');
	await waitMoves(page, 2);
	let sans = await moves(page);
	assert.equal(sans[0], 'exd6');
	await boardMatches(page, replay(fen, sans), '吃过路兵后');
	const pos = replay(fen, sans);
	if (generateMoves(pos).some(m => sanOf(pos, m) === 'O-O')) {
		await click(page, 'e1');
		await click(page, 'g1');
		await waitMoves(page, 4);
		sans = await moves(page);
		assert.equal(sans[2], 'O-O');
		await boardMatches(page, replay(fen, sans), '易位后');
	}
});

await scenario('主链路：逼和显示和棋', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await reloadWith(page, { fen: '7k/5K2/8/8/8/8/8/6Q1 w - - 0 1', moves: [], human: 8, level: 'novice', elapsed: 0 });
	await page.waitForSelector('#boot', { state: 'detached', timeout: 3000 });
	await click(page, 'g1');
	await click(page, 'g6');
	await page.waitForSelector('[data-slot=result]:not([hidden])', { timeout: 3000 });
	assert.match(await page.textContent('[data-slot=result]'), /和/);
});

await scenario('主链路：窄手机横放，棋盘仍然够大', { width: 640, height: 360 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	const box = await page.locator('#board2d .b2d').boundingBox();
	assert.ok(box.width >= 200, `棋盘只有 ${Math.round(box.width)}px`);
	assert.ok(box.y + box.height <= 360, '棋盘应在屏幕内');
});

await scenario('主链路：摆棋时粘贴不带易位权的 FEN，开局后不能易位', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="setup"]');
	await page.click('#editor [data-ed="clear"]');
	await page.fill('#ed-fen', 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w - - 0 1');
	await page.locator('#ed-fen').blur();
	assert.equal(await page.inputValue('#ed-fen'), 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w - - 0 1');
	assert.equal(await page.locator('#editor [data-slot="castling"] input:checked').count(), 0);
});

await scenario('主链路：再点一次没有着法的已选棋子，取消选择', { width: 1280, height: 800 }, async page => {
	await fresh(page);
	await page.click('#dlg-new [data-act="start"]');
	await click(page, 'a1');
	await page.waitForSelector('.mk.sel');
	await click(page, 'a1');
	await page.waitForTimeout(150);
	assert.equal(await page.locator('.mk.sel').count(), 0);
});

await browser.close();
server.close();
if (errors.length) { console.log('页面错误：\n  ' + errors.join('\n  ')); process.exitCode = 1; }
console.log(`\n${passed} 个场景通过${process.exitCode ? '，有失败' : ''}`);
