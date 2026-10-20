// 对局存档：刷新或关掉标签页后能接着下。
// 几个标签页不会同时写它：同一时刻只有一个标签页在下这盘棋（见 tablock.js），由那一页读写。
// 一局结束时写入"已结束"标记而不是删掉：存档为空（比如存储被清空）不代表那盘已经下完。

import { jsonStore } from '../core/store.js';

const GAME = 'frostfall.game';

export function createSaveSlot(storage) {
	const store = jsonStore(storage);
	return {
		// 进行中的对局；没有（或已结束）则为 null
		load() {
			const g = store.get(GAME);
			return g && typeof g.fen === 'string' && Array.isArray(g.moves) ? g : null;
		},
		// 存档里的那盘是否已经下完
		get finished() { return store.get(GAME)?.ended === true; },
		save: snapshot => store.set(GAME, snapshot),
		finish: () => store.set(GAME, { ended: true })
	};
}
