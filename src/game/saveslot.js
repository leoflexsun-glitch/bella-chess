// 存档：每局一条（KEY_PREFIX + id），标签页之间互不覆盖。
// 每个键只由生成它的那一页写：开新局时生成新键；从列表里接着下某局时，把它挪到本页新生成的键下（先写后删）。
// 所以同一局即使在两页里各接着下，也只会分成两条存档，谁也不会覆盖谁。
// 本页正在下哪一局记在 sessionStorage（每个标签页一份、刷新还在）：刷新后接着下本页这局；新开的页从列表里选。

import { jsonStore } from '../core/store.js';

const KEY_PREFIX = 'frostfall.game.';
const CURRENT = 'frostfall.current';
const KEEP = 8;            // 最多留几局没下完的；更早的自动删掉

const valid = g => g && typeof g.fen === 'string' && Array.isArray(g.moves) ? g : null;

export function createSaveSlots({ storage, session, now = Date.now } = {}) {
	const store = jsonStore(storage), tab = jsonStore(session, 'sessionStorage');
	let key = null;        // 本页这局的存档键

	const keys = () => {
		try {
			const s = storage ?? globalThis.localStorage;
			return Array.from({ length: s.length }, (_, i) => s.key(i)).filter(k => k?.startsWith(KEY_PREFIX));
		} catch {
			return [];
		}
	};
	const all = () => keys().map(k => ({ key: k, game: valid(store.get(k)) })).filter(e => e.game)
		.sort((a, b) => (b.game.savedAt ?? 0) - (a.game.savedAt ?? 0));

	// 旧版本只有一个存档位：挪成列表里的一条，删掉旧版的"谁在下"标记。
	const legacy = store.get('frostfall.game');
	if (legacy !== null) {
		if (valid(legacy)) store.set(KEY_PREFIX + 'legacy', legacy);
		store.set('frostfall.game', null);
	}
	store.set('frostfall.active', null);

	return {
		// 没下完的各局，新的在前；不含本页正在下的这局。
		list: () => all().filter(e => e.key !== key),
		// 本页刷新前在下的那局的键（没有则 null）。
		get previous() { return tab.get(CURRENT); },
		get(k) { return valid(store.get(k)); },
		// 本页开始下一局。from 是接着下的那条存档：挪到本页的新键下。
		begin(from = null) {
			key = KEY_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
			if (from) {
				const game = store.get(from);
				if (game) store.set(key, game);
				store.set(from, null);
				tab.set(CURRENT, key);
			} else {
				tab.set(CURRENT, null);
			}
			for (const e of all().slice(KEEP)) store.set(e.key, null);
		},
		save(snapshot) {
			if (!key) return false;
			tab.set(CURRENT, key);
			return store.set(key, { ...snapshot, savedAt: now() });
		},
		// 本局下完：从列表里删掉（悔棋接着下时再存回来）。
		finish() {
			if (!key) return;
			store.set(key, null);
			tab.set(CURRENT, null);
		}
	};
}
