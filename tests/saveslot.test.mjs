// 存档读写与"同一时刻只有一页在下"的交接（两个句柄共用一个存储，模拟两个标签页）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveSlot } from '../src/game/saveslot.js';
import { createTabLock } from '../src/game/tablock.js';

// 共享存储 + storage 事件：写入时通知"别的标签页"（不通知写入者自己），与浏览器一致。
function browser() {
	const data = new Map(), tabs = [];
	const storage = writer => ({
		getItem: k => data.get(k) ?? null,
		setItem: (k, v) => { data.set(k, String(v)); notify(writer, k); },
		removeItem: k => { data.delete(k); notify(writer, k); },
		clear: () => { data.clear(); notify(writer, null); }
	});
	const notify = (writer, key) => { for (const t of tabs) if (t !== writer) t.listeners.forEach(fn => fn({ key })); };
	return {
		open() {
			const t = { listeners: [] };
			tabs.push(t);
			t.storage = storage(t);
			t.events = { addEventListener: (type, fn) => { if (type === 'storage') t.listeners.push(fn); } };
			return t;
		}
	};
}

test('存档：读、写、清；坏数据与存储不可用时按没有存档处理', () => {
	const tab = browser().open(), slot = createSaveSlot(tab.storage);
	assert.equal(slot.load(), null);
	assert.ok(slot.save({ fen: 'start', moves: ['e2e4'] }));
	assert.deepEqual(slot.load().moves, ['e2e4']);
	assert.ok(slot.clear());
	assert.equal(slot.load(), null);
	tab.storage.setItem('frostfall.game', '{"fen":1}');
	assert.equal(slot.load(), null);
	const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	const b = createSaveSlot(broken);
	assert.equal(b.load(), null);
	assert.equal(b.save({ fen: 'start', moves: [] }), false);
});

test('交接：后接手的页拿到"在下"，先前那页收到通知转为待命；回来再接手', () => {
	const br = browser(), a = br.open(), b = br.open();
	const lost = [];
	const la = createTabLock({ storage: a.storage, events: a.events, onLost: () => lost.push('a') });
	const lb = createTabLock({ storage: b.storage, events: b.events, onLost: () => lost.push('b') });
	assert.equal(la.claim(), false, '第一次接手：之前不是本页');
	assert.deepEqual([la.held, lb.held], [true, false]);
	assert.equal(lb.claim(), false);
	assert.deepEqual([la.held, lb.held, lost], [false, true, ['a']]);
	assert.equal(la.claim(), false, '回来接手：之前是 B 在下，要重新读存档');
	assert.deepEqual([la.held, lb.held, lost], [true, false, ['a', 'b']]);
	assert.equal(la.claim(), true, '本来就是本页在下：不必重读');
	assert.deepEqual(lost, ['a', 'b'], '重复接手不打扰别人');
});

test('错过了通知（标签页被冻结等）：held 现读存储，不会误以为自己还在下', () => {
	const br = browser(), a = br.open(), b = br.open();
	const la = createTabLock({ storage: a.storage, events: {} });   // A 收不到 storage 事件
	const lb = createTabLock({ storage: b.storage, events: b.events });
	la.claim();
	lb.claim();
	assert.equal(la.held, false);
	assert.equal(la.claim(), false, 'A 回来接手时知道要重读存档');
});

test('交接：别的键变化不影响；存储被整个清空时视为失去', () => {
	const br = browser(), a = br.open(), b = br.open();
	let lost = 0;
	const la = createTabLock({ storage: a.storage, events: a.events, onLost: () => lost++ });
	la.claim();
	b.storage.setItem('frostfall.game', '{}');
	assert.deepEqual([la.held, lost], [true, 0]);
	b.storage.clear();
	assert.deepEqual([la.held, lost], [false, 1]);
});

test('存储不可用时只有本页，接手照样成功', () => {
	const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	const lock = createTabLock({ storage: broken, events: {} });
	assert.equal(lock.claim(), false);
	assert.equal(lock.held, true);
	assert.equal(lock.claim(), true);
});
