// 对局存档：刷新或关掉标签页后能接着下。
// 几个标签页不会同时写它：同一时刻只有一个标签页在下这盘棋（见 tablock.js），由那一页读写。

import { jsonStore } from '../core/store.js';

const GAME = 'frostfall.game';

export function createSaveSlot(storage) {
	const store = jsonStore(storage);
	return {
		load() {
			const g = store.get(GAME);
			return g && typeof g.fen === 'string' && Array.isArray(g.moves) ? g : null;
		},
		save: snapshot => store.set(GAME, snapshot),
		clear: () => store.set(GAME, null)
	};
}
