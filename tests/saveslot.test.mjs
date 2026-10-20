// 存档位的多标签页规则：几个句柄共用一个存储，模拟几个标签页；engage() 表示用户在那一页有了操作。
// 每条守卫都至少有一个用例在去掉它时会失败（已做变异检查）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveSlot } from '../src/game/saveslot.js';

const memory = () => {
	const m = new Map();
	return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const game = (id, moves = [], extra = {}) => ({ id, fen: 'start', moves, ...extra });
const tab = store => createSaveSlot(store);

test('单个标签页：走子、电脑应着、刷新后切后台都能存；终局清空', () => {
	const store = memory(), a = tab(store);
	a.engage();
	assert.ok(a.save(game('g1', ['e2e4'])));
	assert.ok(a.save(game('g1', ['e2e4', 'e7e5'])), '电脑应着');
	const reloaded = tab(store);                                  // 刷新：新页在前台打开
	reloaded.engage();
	assert.deepEqual(reloaded.load().moves, ['e2e4', 'e7e5']);
	assert.ok(reloaded.save(game('g1', ['e2e4', 'e7e5'], { flipped: true })), '没走棋也能存翻转、用时');
	assert.ok(reloaded.end('g1'));
	assert.equal(reloaded.load(), null);
});

test('旁观页：用户回到正在下的页后，旁观页不再写入，也写不回自己的用时/翻转/电脑应着', () => {
	const store = memory(), a = tab(store), b = tab(store);
	a.engage();
	a.save(game('g1', ['e2e4']));
	b.engage();                                                   // 用户打开 B 看了一眼
	assert.ok(b.save(game('g1', ['e2e4', 'g8f6'])), 'B 当时是写入方（它自己的电脑应着）');
	a.engage();                                                   // 用户回到 A
	assert.ok(a.save(game('g1', ['e2e4', 'e7e5'], { elapsed: 600000, flipped: true })), 'A 关页时存下自己的局面');
	assert.equal(b.save(game('g1', ['e2e4', 'g8f6'], { elapsed: 1000 })), false, 'B 之后切后台不写');
	assert.deepEqual(b.load().moves, ['e2e4', 'e7e5']);
	assert.equal(b.load().elapsed, 600000);
});

test('旧标签页不覆盖别的页刚开的新局；也清不掉它', () => {
	const store = memory(), a = tab(store), e = tab(store);
	a.engage();
	a.save(game('x', ['e2e4']));
	e.engage();
	e.save(game('y'));                                            // E 开新局
	assert.equal(a.save(game('x', ['e2e4', 'e7e5'])), false, 'A 的电脑应着不抢存档位');
	assert.equal(a.end('x'), false);
	assert.equal(a.load().id, 'y');
});

test('后台页的电脑把同一局将死：用户正在另一页接着下这局，不清档', () => {
	const store = memory(), a = tab(store), b = tab(store);
	a.engage();
	a.save(game('g1', ['e2e4']));
	b.engage();                                                   // 用户到 B 接着下同一局
	b.save(game('g1', ['e2e4', 'e7e5', 'g1f3']));
	assert.equal(a.end('g1'), false);
	assert.equal(b.load().moves.length, 3);
});

test('存档位空着时，停在开局对话框的空闲页不妨碍别的页把进行中的局存进去', () => {
	const store = memory(), a = tab(store), idle = tab(store);
	a.engage();
	a.save(game('x'));
	a.end('x');                                                   // 位空出
	idle.engage();                                                // 用户打开一个新页（还没开局）
	const c = tab(store);
	assert.ok(c.save(game('w', ['d2d4'])), '进行中的 w 接上');
});

test('终局只清掉位里的本局', () => {
	const store = memory(), a = tab(store);
	a.engage();
	a.save(game('y'));
	assert.equal(a.end('x'), false, '位里是 y');
	assert.equal(a.load().id, 'y');
});

test('存档位空出后：进行中的别的局可以接上，已结束的局不能写回', () => {
	const store = memory(), a = tab(store), b = tab(store), c = tab(store);
	a.engage();
	a.save(game('x', ['e2e4']));
	b.engage();                                                   // B 打开同一局
	b.save(game('x', ['e2e4', 'e7e5']));
	assert.ok(b.end('x'), 'B 把这局下完');
	assert.equal(a.save(game('x', ['e2e4'])), false, '已结束的局不能复活');

	c.engage();
	c.save(game('z', ['c2c4']));
	assert.equal(a.save(game('w', ['d2d4'])), false, '位被 z 占着（写入方是 C）');
	assert.ok(c.end('z'));
	assert.ok(a.save(game('w', ['d2d4'])), 'z 结束后位空出，进行中的 w 可以接上');
	assert.ok(a.save(game('w', ['d2d4', 'd7d5'])), '接上之后 A 是写入方，继续存');
	assert.equal(a.load().id, 'w');
	assert.equal(c.save(game('v')), false, '接上之后 A 是写入方，C 要等用户在它那里有操作');
});

test('"已结束"名单去重、记得不止一局', () => {
	const store = memory(), a = tab(store), b = tab(store);
	a.engage();
	a.save(game('x'));
	a.end('x');
	b.engage();
	for (let i = 0; i < 25; i++) {                                // 同一局反复"终局—悔棋接着下—终局"
		b.engage();                                               // 点「悔棋接着下」
		assert.ok(b.save(game('g')));
		assert.ok(b.end('g'));
	}
	assert.equal(a.save(game('x')), false, 'x 仍在名单里，不能复活');
});

test('旧版存档（没有元数据）可以读出；用户在本页操作后照常存取', () => {
	const store = memory();
	store.setItem('frostfall.game', JSON.stringify({ fen: 'start', moves: ['e2e4'] }));
	store.setItem('frostfall.meta', JSON.stringify({ rev: 3, id: 'old', ended: 'z' }));   // 上一版的元数据格式
	const a = tab(store);
	assert.deepEqual(a.load().moves, ['e2e4']);
	assert.equal(a.save(game('g1', ['e2e4'])), false, '还没操作：不写');
	a.engage();
	assert.ok(a.save(game('g1', ['e2e4'])));
	assert.ok(a.end('g1'));
});

test('存储不可用（沙箱 iframe 等）时不抛错', () => {
	const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	const a = tab(broken);
	assert.equal(a.load(), null);
	assert.doesNotThrow(() => { a.engage(); a.save(game('g1')); a.end('g1'); });
	const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
	try {
		assert.equal(createSaveSlot().load(), null);
	} finally {
		if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage;
	}
});
