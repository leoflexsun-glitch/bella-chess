// 对局存档位：刷新或关掉标签页后能接着下。几个标签页共用一个存档位。
// 规则只有一条主线：同一时刻只有"写入方"一个标签页写——用户最近在哪一页有过操作
// （在前台打开、切到前台、点按、按键），就是哪一页；其余页只是旁观，不写不清。
// 所以旧标签页不会覆盖新棋，旁观页不会写回自己的用时、翻转或电脑应着，也不会复活已结束的局。
// 唯一的补充：存档位空着时（某局结束清档后），仍在进行的别的局可以接上并成为写入方（已结束的局除外）。
// 元数据单独一个小键：writer（写入方）、id（位里那盘的对局 id）、ended（最近结束的若干对局 id）。

import { jsonStore } from '../core/store.js';

const GAME = 'frostfall.game';
const META = 'frostfall.meta';
const KEEP_ENDED = 20;

const randomId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function createSaveSlot(storage, tabId = randomId()) {
	const store = jsonStore(storage);
	const meta = () => {
		const m = { writer: null, id: null, ...store.get(META) };
		m.ended = Array.isArray(m.ended) ? m.ended : [];
		return m;
	};

	return {
		// 用户在本页有操作：本页成为写入方。
		engage() {
			const m = meta();
			if (m.writer !== tabId) store.set(META, { ...m, writer: tabId });
		},

		// 读出存档；旧版存档没有 id。
		load() {
			const g = store.get(GAME);
			return g && typeof g.fen === 'string' && Array.isArray(g.moves) ? g : null;
		},

		// 写入进行中的对局（snapshot.id 为对局 id）：本页是写入方，或存档位空着且本局没结束过；返回是否写了。
		// （位空着时写入方若是别的页，那一页手里没有进行中的局，不妨碍本局接上。）
		save(snapshot) {
			const m = meta();
			const free = !m.id && !m.ended.includes(snapshot.id);
			if (m.writer !== tabId && !free) return false;
			store.set(GAME, snapshot);
			store.set(META, { ...m, writer: tabId, id: snapshot.id });
			return true;
		},

		// 本局结束：本页是写入方、且位里正是本局才清掉；返回是否清了。
		end(id) {
			const m = meta();
			if (m.writer !== tabId || m.id !== id) return false;
			store.set(GAME, null);
			store.set(META, { ...m, id: null, ended: [...m.ended.filter(e => e !== id), id].slice(-KEEP_ENDED) });
			return true;
		}
	};
}
