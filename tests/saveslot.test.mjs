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

test('存档：读、写、终局标记；坏数据与存储不可用时按没有存档处理', () => {
	const tab = browser().open(), slot = createSaveSlot(tab.storage);
	assert.deepEqual([slot.load(), slot.finished], [null, false], '空存档不等于"已下完"');
	assert.ok(slot.save({ fen: 'start', moves: ['e2e4'] }));
	assert.deepEqual([slot.load().moves, slot.finished], [['e2e4'], false]);
	assert.ok(slot.finish());
	assert.deepEqual([slot.load(), slot.finished], [null, true]);
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

test('错过了通知（标签页被冻结等）：check 现读存储发现并转为待命；回来接手时知道要重读', () => {
	const br = browser(), a = br.open(), b = br.open();
	let lost = 0;
	const la = createTabLock({ storage: a.storage, events: {}, onLost: () => lost++ });   // A 收不到 storage 事件
	const lb = createTabLock({ storage: b.storage, events: b.events });
	la.claim();
	lb.claim();
	assert.equal(la.held, true, '缓存还以为在下');
	assert.equal(la.check(), false, '现读发现已不是');
	assert.deepEqual([la.held, lost], [false, 1]);
	assert.equal(la.check(), false);
	assert.equal(lost, 1, '只通知一次');
	assert.equal(la.claim(), false, 'A 回来接手时知道要重读存档');
});

test('某次写入临时失败后，一旦收到别的页的通知就不再"独占"', () => {
	const br = browser(), a = br.open(), b = br.open();
	let fail = true, lost = 0;
	const flaky = { ...a.storage, setItem: (k, v) => { if (fail) throw new Error('QuotaExceededError'); a.storage.setItem(k, v); } };
	const la = createTabLock({ storage: flaky, events: a.events, onLost: () => lost++ });
	const lb = createTabLock({ storage: b.storage, events: b.events });
	la.claim();
	assert.equal(la.check(), true, '写不进去时算本页在下');
	fail = false;
	lb.claim();                                                   // B 接手，A 收到通知
	assert.deepEqual([la.check(), lost], [false, 1]);
});

test('交接：别的键变化不影响；存储被整个清空时本页接着下（重新登记并通知重新存档）', () => {
	const br = browser(), a = br.open(), b = br.open();
	let lost = 0, cleared = 0;
	const la = createTabLock({ storage: a.storage, events: a.events, onLost: () => lost++, onCleared: () => cleared++ });
	la.claim();
	b.storage.setItem('frostfall.game', '{}');
	assert.deepEqual([la.held, lost], [true, 0]);
	b.storage.clear();
	assert.deepEqual([la.held, la.check(), lost, cleared], [true, true, 0, 1], '没有别的页接手：不转待命');
	const lb = createTabLock({ storage: b.storage, events: b.events });
	assert.equal(lb.held, false);
	assert.equal(lb.claim(), false, '重新登记后，别的页要接手仍按正常交接');
	assert.deepEqual([la.held, lost], [false, 1]);
});

test('存储不可用时只有本页，接手照样成功', () => {
	const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	const lock = createTabLock({ storage: broken, events: {} });
	assert.equal(lock.claim(), false);
	assert.deepEqual([lock.held, lock.check()], [true, true]);
	assert.equal(lock.claim(), true);
});
