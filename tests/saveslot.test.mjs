// 存档位的多标签页规则：几个句柄共用一个存储，模拟几个标签页。
// 每条守卫都至少有一个用例在去掉它时会失败。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveSlot } from '../src/game/saveslot.js';

const memory = () => {
	const m = new Map();
	return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const game = (id, moves = []) => ({ id, fen: 'start', moves });

test('单个标签页：走子、电脑应着、刷新后切后台都能存；终局清空', () => {
	const store = memory(), a = createSaveSlot(store);
	assert.equal(a.load(), null);
	assert.ok(a.save(game('g1', ['e2e4']), { claim: true }));
	assert.ok(a.save(game('g1', ['e2e4', 'e7e5'])), '电脑应着');
	const reloaded = createSaveSlot(store);                       // 刷新页面
	assert.deepEqual(reloaded.load().moves, ['e2e4', 'e7e5']);
	assert.ok(reloaded.save(game('g1', ['e2e4', 'e7e5'])), '刷新后没走棋也能存（用时、翻转）');
	assert.ok(reloaded.save(game('g1', ['e2e4', 'e7e5', 'g1f3'])));
	assert.ok(reloaded.end('g1'));
	assert.equal(reloaded.load(), null);
});

test('别的页做过真实操作后，本页不再被动写入（即使着法是延续）', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('g1', ['e2e4']), { claim: true });
	b.load();
	a.save(game('g1', ['e2e4', 'e7e5']), { claim: true });
	assert.equal(b.save(game('g1', ['e2e4', 'e7e5', 'g1f3'])), false);
	assert.equal(b.load().moves.length, 2);
});

test('位里是别的局时，同步的页也不能被动写入', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('y'), { claim: true });
	b.load();                                                     // 同步了，但 B 手里是 x 局
	assert.equal(b.save(game('x', ['e2e4'])), false);
	assert.equal(b.load().id, 'y');
});

test('被动写入只能延续位里的着法：分叉或倒退都不写，相同则写（更新用时等）', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('g1', ['e2e4']), { claim: true });
	a.save(game('g1', ['e2e4', 'e7e5']));                         // A 的电脑应着
	b.load();
	assert.equal(b.save(game('g1', ['e2e4', 'd7d5'])), false, '分叉的电脑应着');
	assert.equal(b.save(game('g1', ['e2e4'])), false, '倒退');
	assert.ok(b.save(game('g1', ['e2e4', 'e7e5'])), '相同');
});

test('旁观页的被动写入不会把正在下的页挤出同步', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('g1', ['e2e4']), { claim: true });
	b.load();
	assert.ok(b.save(game('g1', ['e2e4'])), 'B 切后台');
	assert.ok(a.save(game('g1', ['e2e4', 'e7e5'])), 'A 的电脑应着照常保存');
	assert.ok(a.end('g1'), 'A 终局照常清档');
});

test('存档位空出后：进行中的别的局可以写进去，已结束的局不能写回', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('x', ['e2e4']), { claim: true });
	b.load();
	a.end('x');
	assert.equal(b.save(game('x', ['e2e4'])), false, '已结束的局不能复活');

	const c = createSaveSlot(store), d = createSaveSlot(store);
	c.save(game('y', ['d2d4']), { claim: true });
	d.save(game('z', ['c2c4']), { claim: true });
	assert.equal(c.save(game('y', ['d2d4', 'd7d5'])), false, '位被 z 占着');
	d.end('z');
	assert.ok(c.save(game('y', ['d2d4', 'd7d5'])), 'z 结束后位空出，y 可以接上');
	assert.equal(c.load().id, 'y');
});

test('"已结束"名单记得不止一局', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('x', ['e2e4']), { claim: true });
	b.load();
	b.save(game('x', ['e2e4', 'e7e5']), { claim: true });
	b.end('x');
	b.save(game('y'), { claim: true });
	b.end('y');
	assert.equal(a.save(game('x', ['e2e4'])), false, 'x 结束后又有 y 结束，x 仍不能复活');
});

test('终局只清掉存着本局、且没被别的页接着下过的存档位', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('x'), { claim: true });
	b.save(game('y'), { claim: true });
	assert.equal(a.end('x'), false, '位里是 y');
	assert.equal(a.load().id, 'y');
	assert.equal(a.end('x'), false, '即使已与当前版本同步，也只清本局');
	assert.equal(a.load().id, 'y');

	const c = createSaveSlot(store), d = createSaveSlot(store);
	c.save(game('g1', ['e2e4']), { claim: true });
	d.load();
	d.save(game('g1', ['e2e4', 'e7e5', 'g1f3']), { claim: true });  // D 接着这局下
	assert.equal(c.end('g1'), false, '旧页 C 认输不清掉 D 的进度');
	assert.ok(d.save(game('g1', ['e2e4', 'e7e5', 'g1f3', 'b8c6'])), 'D 之后照常保存');
});

test('旧版存档（没有元数据）可以读出并接着存', () => {
	const store = memory();
	store.setItem('frostfall.game', JSON.stringify({ fen: 'start', moves: ['e2e4'] }));
	const a = createSaveSlot(store);
	assert.deepEqual(a.load().moves, ['e2e4']);
	assert.ok(a.save(game('g1', ['e2e4']), { claim: true }));
	assert.ok(a.end('g1'));
});

test('存储不可用（沙箱 iframe 等）时不抛错', () => {
	const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	const a = createSaveSlot(broken);
	assert.equal(a.load(), null);
	assert.doesNotThrow(() => a.save(game('g1'), { claim: true }));
	const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
	try {
		assert.equal(createSaveSlot().load(), null);
	} finally {
		if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage;
	}
});
