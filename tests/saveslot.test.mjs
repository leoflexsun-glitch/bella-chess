// 存档：每局一条，各标签页只写自己的那条（两个句柄共用 localStorage、各有一份 sessionStorage，模拟两个标签页）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveSlots } from '../src/game/saveslot.js';

function memory() {
	const data = new Map();
	return {
		get length() { return data.size; },
		key: i => [...data.keys()][i] ?? null,
		getItem: k => data.get(k) ?? null,
		setItem: (k, v) => data.set(k, String(v)),
		removeItem: k => data.delete(k)
	};
}
const game = n => ({ fen: 'start', moves: Array(n).fill('e2e4') });
let t = 0;
const tick = () => ++t;                 // 每次存档时间各不相同

test('两页各下各的：互不覆盖，各自刷新回到自己那局', () => {
	const local = memory(), sa = memory(), sb = memory();
	const a = createSaveSlots({ storage: local, session: sa }), b = createSaveSlots({ storage: local, session: sb });
	a.begin(); a.save(game(3));
	b.begin(); b.save(game(5));
	const a2 = createSaveSlots({ storage: local, session: sa }), b2 = createSaveSlots({ storage: local, session: sb });
	assert.equal(a2.get(a2.previous).moves.length, 3);
	assert.equal(b2.get(b2.previous).moves.length, 5);
});

test('新开的页：没有"本页上一局"，列表里列出各局（新的在前），选一局后挪到本页名下', () => {
	const local = memory(), a = createSaveSlots({ storage: local, session: memory(), now: tick });
	a.begin(); a.save(game(1));
	a.begin(); a.save(game(2));            // 本页又开一局：上一局留在列表里
	const c = createSaveSlots({ storage: local, session: memory() });
	assert.equal(c.previous, null);
	const list = c.list();
	assert.deepEqual(list.map(e => e.game.moves.length), [2, 1]);
	c.begin(list[1].key);
	assert.equal(c.get(list[1].key), null, '原来那条已挪走');
	assert.deepEqual(c.list().map(e => e.game.moves.length), [2], '列表不含本页正在下的这局');
	c.save(game(4));
	a.save(game(3));                       // 原页接着下它那局：写的是它自己的键
	assert.equal(c.get(c.previous).moves.length, 4, '互不覆盖');
});

test('下完从列表删掉；悔棋接着下再存回来', () => {
	const local = memory(), s = memory(), a = createSaveSlots({ storage: local, session: s });
	a.begin(); a.save(game(2));
	a.finish();
	assert.equal(createSaveSlots({ storage: local, session: s }).previous, null);
	assert.equal(createSaveSlots({ storage: local, session: memory() }).list().length, 0);
	a.save(game(1));
	assert.equal(createSaveSlots({ storage: local, session: memory() }).list().length, 1);
});

test('最多留 8 局；坏数据不列出；旧版单一存档并入列表', () => {
	const local = memory();
	local.setItem('frostfall.game', JSON.stringify(game(7)));
	local.setItem('frostfall.active', '"x"');
	local.setItem('frostfall.game.bad', '{"fen":1}');
	const a = createSaveSlots({ storage: local, session: memory(), now: tick });
	assert.deepEqual(a.list().map(e => e.game.moves.length), [7]);
	assert.equal(local.getItem('frostfall.game'), null);
	assert.equal(local.getItem('frostfall.active'), null);
	for (let i = 0; i < 10; i++) { a.begin(); a.save(game(i + 1)); }
	const left = createSaveSlots({ storage: local, session: memory() }).list().map(e => e.game.moves.length);
	assert.deepEqual(left, [10, 9, 8, 7, 6, 5, 4, 3, 2], '留下最新的：本页这局 + 之前 8 局');
});

test('挪存档时新键写不进去：沿用原条，不删', () => {
	const local = memory();
	local.setItem('frostfall.game.x', JSON.stringify(game(3)));
	const full = { ...local, get length() { return local.length; }, key: i => local.key(i), getItem: k => local.getItem(k), removeItem: k => local.removeItem(k),
		setItem: (k, v) => { if (k !== 'frostfall.game.x') throw new Error('quota'); local.setItem(k, v); } };
	const session = memory(), a = createSaveSlots({ storage: full, session });
	a.begin('frostfall.game.x');
	assert.equal(local.getItem('frostfall.game.x') !== null, true, '原条还在');
	assert.equal(a.previous, 'frostfall.game.x');
	assert.equal(a.save(game(4)), true, '接着写原条');
});

test('一步没走的局不留：反复开新局不会挤掉没下完的局', () => {
	const local = memory(), a = createSaveSlots({ storage: local, session: memory(), now: tick });
	for (let i = 0; i < 8; i++) { a.begin(); a.save(game(i + 1)); }
	for (let i = 0; i < 10; i++) { a.begin(); a.save(game(0)); }   // 连开 10 局都没走棋
	const left = createSaveSlots({ storage: local, session: memory() }).list();
	assert.deepEqual(left.filter(e => e.game.moves.length).map(e => e.game.moves.length), [8, 7, 6, 5, 4, 3, 2, 1]);
});

test('别的页开了就关、一步没走的空局：不挤掉没下完的局', () => {
	const local = memory(), a = createSaveSlots({ storage: local, session: memory(), now: tick });
	for (let i = 0; i < 8; i++) { a.begin(); a.save(game(i + 1)); }
	for (let i = 0; i < 10; i++) {                       // 每次新开一页、开局后不走就关掉
		const t = createSaveSlots({ storage: local, session: memory(), now: tick });
		t.begin(); t.save(game(0));
	}
	a.begin();
	const left = createSaveSlots({ storage: local, session: memory() }).list();
	assert.deepEqual(left.filter(e => e.game.moves.length).map(e => e.game.moves.length), [8, 7, 6, 5, 4, 3, 2, 1]);
	assert.ok(left.filter(e => !e.game.moves.length).length <= 8, '空局也限量');
});

test('选中最旧的那局接着下：不会马上被当成最旧的删掉', () => {
	const local = memory(), a = createSaveSlots({ storage: local, session: memory(), now: tick });
	for (let i = 0; i < 9; i++) { a.begin(); a.save(game(i + 1)); }
	const c = createSaveSlots({ storage: local, session: memory(), now: tick });
	const oldest = c.list().at(-1);
	c.begin(oldest.key);
	assert.equal(c.get(c.previous)?.moves.length, oldest.game.moves.length);
});

test('旧版存档并入列表时记上时间', () => {
	const local = memory();
	local.setItem('frostfall.game', JSON.stringify(game(2)));
	const [e] = createSaveSlots({ storage: local, session: memory(), now: () => 12345 }).list();
	assert.equal(e.game.savedAt, 12345);
});

test('存储不可用：不报错，按没有存档处理', () => {
	const broken = { get length() { throw new Error('denied'); }, key() { throw new Error('denied'); }, getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	const a = createSaveSlots({ storage: broken, session: broken });
	assert.equal(a.previous, null);
	assert.deepEqual(a.list(), []);
	a.begin();
	assert.equal(a.save(game(1)), false);
	a.finish();
});
