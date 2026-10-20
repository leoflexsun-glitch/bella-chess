// 存档位的多标签页规则：两个句柄共用一个存储，模拟两个标签页。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveSlot } from '../src/game/saveslot.js';

const memory = () => {
	const m = new Map();
	return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const game = (id, moves = []) => ({ id, fen: 'start', moves });

test('单个标签页：走子写入，电脑应着与关页也写入，终局清空', () => {
	const store = memory(), a = createSaveSlot(store);
	assert.equal(a.load(), null);
	assert.ok(a.save(game('g1', ['e2e4']), { claim: true }));
	assert.ok(a.save(game('g1', ['e2e4', 'e7e5'])));            // 电脑应着（非人的操作）
	assert.deepEqual(a.load().moves, ['e2e4', 'e7e5']);
	assert.ok(a.end('g1'));
	assert.equal(a.load(), null);
});

test('同一局开在两页：旧页关页不覆盖另一页的新着法', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('g1', ['e2e4']), { claim: true });
	b.load();                                                     // B 打开，恢复同一局
	a.save(game('g1', ['e2e4', 'e7e5', 'g1f3']), { claim: true });
	assert.equal(b.save(game('g1', ['e2e4'])), false);
	assert.equal(a.load().moves.length, 3);
});

test('后台页的电脑应着不抢另一页刚开的新局', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('x', ['e2e4']), { claim: true });
	b.load();
	b.save(game('y'), { claim: true });                           // B 开新局
	assert.equal(a.save(game('x', ['e2e4', 'e7e5'])), false);     // A 的电脑应着
	assert.equal(a.load().id, 'y');
});

test('已结束的局不会被另一页复活；别的局结束后空出的位可以写', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('g1', ['e2e4']), { claim: true });
	b.load();                                                     // B 恢复同一局
	a.end('g1');                                                  // A 把这局下完
	assert.equal(b.save(game('g1', ['e2e4'])), false, '不应复活');
	assert.equal(b.load(), null);

	const c = createSaveSlot(store);
	c.save(game('g2', ['d2d4']), { claim: true });
	const d = createSaveSlot(store);
	d.save(game('g3', ['c2c4']), { claim: true });               // D 后下，占了存档位
	c.load();
	d.end('g3');                                                  // D 那局结束，位空出
	assert.ok(c.save(game('g2', ['d2d4', 'd7d5'])), '空出的位可以存进行中的局');
	assert.equal(c.load().id, 'g2');
});

test('终局只清掉存着本局的存档位', () => {
	const store = memory(), a = createSaveSlot(store), b = createSaveSlot(store);
	a.save(game('x'), { claim: true });
	b.save(game('y'), { claim: true });
	assert.equal(a.end('x'), false);
	assert.equal(a.load().id, 'y');
});

test('旧版存档（没有元数据）可以读出，且允许写入', () => {
	const store = memory();
	store.setItem('frostfall.game', JSON.stringify({ fen: 'start', moves: ['e2e4'] }));
	const a = createSaveSlot(store);
	assert.deepEqual(a.load().moves, ['e2e4']);
	assert.ok(a.save(game('g1', ['e2e4'])));
});
