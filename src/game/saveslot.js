// 存档：每局一条（KEY_PREFIX + id），标签页之间互不覆盖。
// 每个键只由生成它的那一页写：开新局时生成新键；从列表里接着下某局时，把它挪到本页新生成的键下（先写后删）。
// 所以同一局即使在两页里各接着下，也只会分成两条存档，谁也不会覆盖谁。
// 本页正在下哪一局记在 sessionStorage（每个标签页一份、刷新还在）：刷新后接着下本页这局；新开的页从列表里选。

import { jsonStore } from '../core/store.js';
import { START_FEN } from '../chess/engine.js';

const KEY_PREFIX = 'frostfall.game.';
const CURRENT = 'frostfall.current';
const KEEP = 8;            // 没下完的局超过这么多时，删掉更早且一个月没动过的
const STALE = 30 * 86400000;

const valid = g => g && typeof g.fen === 'string' && Array.isArray(g.moves) ? g : null;
// 标准开局、一步没走：开了就放下的局，不值得留。摆棋、拍照得到的局面即使没走也要留。
const blank = g => !g.moves.length && g.fen === START_FEN;

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

	// 旧版本只有一个存档位：挪成列表里的一条。还开着的旧版页面会接着写它（旧版的"谁在下"标记不碰，免得那页以为被接手而停下）：
	// 同一局（起始局面、执子相同，着法接着上次挪来的往下走）并到上次那条，别的局另起一条，谁也不覆盖谁。
	// 写进去了才删旧位；旧版的"已下完"标记（不是对局）留着，还开着的旧版页面靠它知道这局已结束。
	const legacy = valid(store.get('frostfall.game'));
	if (legacy) {
		const same = all().find(({ key: k, game: g }) => k.startsWith(KEY_PREFIX + 'legacy') && g.fen === legacy.fen && g.human === legacy.human
			&& legacy.moves.join().startsWith(g.moves.join()));
		const moved = store.set(same?.key ?? KEY_PREFIX + 'legacy' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), { ...legacy, savedAt: legacy.savedAt ?? now() });
		if (moved) store.set('frostfall.game', null);
	}

	return {
		// 没下完的各局，新的在前；不含本页正在下的这局和空局。
		list: () => all().filter(e => e.key !== key && !blank(e.game)),
		// 本页刷新前在下的那局的键（没有则 null）。
		get previous() { return tab.get(CURRENT); },
		get(k) { return valid(store.get(k)); },
		// 本页开始下一局。from 是接着下的那条存档：挪到本页的新键下（记为刚存的，免得马上被当成最旧的删掉）。
		// 新键写不进去（存满、被禁用）就不删原条——也不改写原条：它可能正在别的页里下。本页原来那局是空局的话不留。
		begin(from = null) {
			const own = key && valid(store.get(key));
			if (own && blank(own)) store.set(key, null);
			key = KEY_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
			if (from) {
				const game = store.get(from);
				if (!game || store.set(key, { ...game, savedAt: now() })) store.set(from, null);
				tab.set(CURRENT, key);
			} else {
				tab.set(CURRENT, null);
			}
			// 空局（开了就关掉的页留下的，列表里不显示）与其他局分开限量：前者不能挤掉后者。
			// 其他局只删一个月没动过的：最近的可能正在别的页里下（后台页面随时会被浏览器回收，回来时要靠存档恢复）。
			const others = all().filter(e => e.key !== key);
			const kept = others.filter(e => !blank(e.game)).slice(KEEP).filter(e => now() - (e.game.savedAt ?? 0) > STALE);
			for (const e of [...kept, ...others.filter(e => blank(e.game)).slice(KEEP)]) store.set(e.key, null);
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
