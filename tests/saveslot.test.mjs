// 存档位的多标签页规则：几个句柄共用一个存储，模拟几个标签页。
// 每条守卫都至少有一个用例在去掉它时会失败（已做变异检查）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveSlot } from '../src/game/saveslot.js';

const memory = () => {
	const m = new Map();
	return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const game = (id, moves = [], extra = {}) => ({ id, fen: 'start', moves, elapsed: 0, flipped: false, ...extra });
const human = { by: 'human' }, engine = { by: 'engine' };

test('单个标签页：走子、电脑应着、刷新后存用时与翻转、终局清空', () => {
	const store = memory(), a = createSaveSlot(store);
	assert.equal(a.load(), null);
	assert.ok(a.commit(game('g1', ['e2e4']), human));
	assert.ok(a.commit(game('g1', ['e2e4', 'e7e5']), engine), '电脑应着');
	const r = createSaveSlot(store);                              // 刷新页面
	assert.deepEqual(r.load().moves, ['e2e4', 'e7e5']);
	assert.ok(r.touch(game('g1', ['e2e4', 'e7e5'], { elapsed: 5000 })), '没走棋也能存用时');
	assert.ok(r.setFlipped('g1', true));
	assert.deepEqual([r.load().elapsed, r.load().flipped], [5000, true]);
	assert.ok(r.end('g1'));
	assert.equal(r.load(), null);
});

test('旁观页：它算出的电脑应着不写；切后台只把用时取大，不动着法和翻转', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.commit(game('g1', ['e2e4'], { elapsed: 1000 }), human);
	b.load();
	assert.equal(b.commit(game('g1', ['e2e4', 'g8f6']), engine), false, 'B 的应着不抢先');
	assert.ok(a.commit(game('g1', ['e2e4', 'e7e5'], { elapsed: 1000 }), engine), 'A 的应着照常写');
	a.setFlipped('g1', true);
	a.touch(game('g1', ['e2e4', 'e7e5'], { elapsed: 600000 }));
	b.touch(game('g1', ['e2e4'], { elapsed: 2000 }));            // B 落后了：不写
	b.load();                                                     // 就算 B 跟上了版本……
	b.touch(game('g1', ['e2e4', 'e7e5'], { elapsed: 2000 }));     // ……用时也只取大
	const g = a.load();
	assert.deepEqual([g.moves, g.elapsed, g.flipped], [['e2e4', 'e7e5'], 600000, true]);
});

test('旧标签页：别处推进过之后，它的电脑应着、用时都不写，终局也不清', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.commit(game('g1', ['e2e4']), human);
	b.load();
	b.commit(game('g1', ['e2e4', 'e7e5', 'g1f3']), human);       // 用户在 B 接着下
	assert.equal(a.commit(game('g1', ['e2e4', 'd7d5']), engine), false);
	assert.equal(a.touch(game('g1', ['e2e4'], { elapsed: 9e6 })), false);
	assert.equal(a.end('g1'), false, 'A 里这局结束了也不清掉 B 的进度');
	assert.equal(b.load().moves.length, 3);
});

test('别的页开了新局：旧页的电脑应着、用时、翻转都不碰它', () => {
	const store = memory(), a = createSaveSlot(store), e = createSaveSlot(store);
	a.commit(game('x', ['e2e4']), human);
	e.commit(game('y'), human);
	assert.equal(a.commit(game('x', ['e2e4', 'e7e5']), engine), false);
	assert.equal(a.touch(game('x', ['e2e4'])), false);
	assert.equal(a.setFlipped('x', true), false);
	assert.equal(a.end('x'), false);
	assert.equal(e.load().id, 'y');
});

test('存档位空出后：进行中的别的局可以接上，已结束的局不能写回', () => {
	const store = memory(), a = createSaveSlot(store), c = createSaveSlot(store), x = createSaveSlot(store);
	a.commit(game('g1', ['e2e4']), human);
	c.load();                                                     // C 开着同一局
	a.end('g1');                                                  // A 把它下完
	assert.equal(c.touch(game('g1', ['e2e4'])), false, '已结束的局，用时写入不能复活它');
	assert.equal(c.commit(game('g1', ['e2e4', 'e7e5']), engine), false, '电脑应着也不能');

	x.commit(game('w', ['d2d4']), human);
	const z = createSaveSlot(store);
	z.commit(game('z', ['c2c4']), human);
	z.end('z');
	assert.ok(x.commit(game('w', ['d2d4', 'g8f6']), engine), 'z 结束后位空出，w 的电脑应着直接接上');
	z.commit(game('z2'), human);
	z.end('z2');
	assert.ok(x.touch(game('w', ['d2d4'])), '用时写入也能接上空位');
	assert.ok(x.commit(game('w', ['d2d4', 'd7d5']), engine), '接上之后照常存电脑应着');
	assert.equal(x.load().id, 'w');
});

test('"已结束"名单去重、记得不止一局', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.commit(game('x'), human);
	a.end('x');
	for (let i = 0; i < 25; i++) {                                // 同一局反复"终局—悔棋接着下—终局"
		assert.ok(b.commit(game('g', [String(i)]), human));
		assert.ok(b.end('g'));
	}
	assert.equal(a.touch(game('x')), false, 'x 仍在名单里，不能复活');
});

test('终局只清掉位里的本局', () => {
	const store = memory(), a = createSaveSlot(store);
	a.commit(game('y'), human);
	assert.equal(a.end('x'), false);
	assert.equal(a.load().id, 'y');
});

test('旧版存档（没有 id / token）可以读出；认领后照常存取与清档', () => {
	const store = memory();
	store.setItem('frostfall.game', JSON.stringify({ fen: 'start', moves: ['e2e4'] }));
	const a = createSaveSlot(store);
	assert.deepEqual(a.load().moves, ['e2e4']);
	assert.equal(a.end('g1'), false, '未认领前认不出');
	assert.ok(a.commit(game('g1', ['e2e4']), human));
	assert.ok(a.end('g1'));
});

test('新局第一笔没写进去时，它的电脑应着、用时不会盖到旧局上', () => {
	const m = memory();
	let fail = false;
	const flaky = { ...m, setItem: (k, v) => { if (fail) throw new Error('QuotaExceededError'); m.setItem(k, v); } };
	const a = createSaveSlot(flaky);
	a.commit(game('old', ['e2e4']), human);
	fail = true;
	assert.equal(a.commit(game('new'), human), false, '新开局没写进去');
	fail = false;
	assert.equal(a.commit(game('new', ['e2e4']), engine), false);
	assert.equal(a.touch(game('new', [], { elapsed: 9e6 })), false);
	assert.deepEqual([a.load().id, a.load().elapsed], ['old', 0]);
});

test('重新读出别的页写的状态后，本页不再算作者（它的电脑应着不写）', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.commit(game('g1', ['e2e4']), human);
	b.load();
	b.commit(game('g1', ['e2e4', 'e7e5', 'g1f3']), human);
	a.load();
	assert.equal(a.commit(game('g1', ['e2e4', 'e7e5', 'g1f3', 'b8c6']), engine), false);
});

test('写不进去（存满、被禁用）时不当作已写入', () => {
	const store = memory(), a = createSaveSlot(store);
	a.commit(game('g1', ['e2e4']), human);
	const full = { ...store, setItem() { throw new Error('QuotaExceededError'); } };
	const b = createSaveSlot(full);
	b.load();
	assert.equal(b.commit(game('g1', ['e2e4', 'e7e5']), human), false);
	assert.equal(b.end('g1'), true, '读得到、删得掉：清档不受影响');
});

test('存储不可用（沙箱 iframe 等）时不抛错', () => {
	const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	const a = createSaveSlot(broken);
	assert.equal(a.load(), null);
	assert.doesNotThrow(() => { a.commit(game('g1'), human); a.touch(game('g1')); a.setFlipped('g1', true); a.end('g1'); });
	const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
	try {
		assert.equal(createSaveSlot().load(), null);
	} finally {
		if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage;
	}
});
