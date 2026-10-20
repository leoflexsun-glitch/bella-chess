// 对局存档位：刷新或关掉标签页后能接着下。几个标签页可能同时开着同一局或不同的局，共用这一个存档位。
// 存档里带对局 id 和状态令牌 token（着法每变一次换一个新令牌）。每个标签页记着：
//   synced  本页所基于的存档状态（上次读出或写入的 token）
//   author  这个状态是不是本页写进去的
// 规则（所有"旧数据覆盖新数据"的情形都由 token 拦下）：
//   commit(by 'human')   人走子、悔棋、新开局：总是写入——存档位留给用户最近操作的那盘。
//   commit(by 'engine')  电脑应着：存档位仍停在本页写入的状态时才写。只是打开旁观的页、
//                        或已被别处推进过的旧页，算出来的应着不写（不会抢先，也不会分叉）。
//   touch                用时：存档位仍停在本页所基于的状态时，取较大的用时写回，不动着法。
//   setFlipped           翻转是用户在本页的操作：位里是本局就改。
//   end                  终局：存档位仍停在本页所基于的状态时清掉，并记入"已结束"名单。
//   存档位空着时（某局结束清档后），进行中的、没结束过的局可以由电脑应着或用时写入接上。

import { jsonStore } from '../core/store.js';
import { randomId } from '../core/id.js';

const GAME = 'frostfall.game';
const ENDED = 'frostfall.ended';
const KEEP_ENDED = 20;

const valid = g => (g && typeof g.fen === 'string' && Array.isArray(g.moves) ? g : null);

export function createSaveSlot(storage) {
	const store = jsonStore(storage);
	let synced = null;
	let author = false;

	const slot = () => valid(store.get(GAME));
	const ended = () => { const e = store.get(ENDED); return Array.isArray(e) ? e : []; };
	const vacantFor = id => !slot() && !ended().includes(id);
	const write = snapshot => {
		const token = randomId();
		if (!store.set(GAME, { ...snapshot, token })) return false;
		synced = token;
		author = true;
		return true;
	};

	return {
		// 读出存档（旧版存档没有 id / token），本页基于它。
		load() {
			const g = slot();
			synced = g?.token ?? null;
			author = false;
			return g;
		},

		// 着法有变化时写入 snapshot（含对局 id）；返回是否写了。
		commit(snapshot, { by }) {
			if (by !== 'human') {
				const g = slot();
				const mine = author && g?.id === snapshot.id && g.token === synced;
				if (!mine && !vacantFor(snapshot.id)) return false;
			}
			return write(snapshot);
		},

		// 存下用时（切后台、关页时）；返回是否写了。
		touch(snapshot) {
			const g = slot();
			if (g?.id === snapshot.id && g.token === synced) {
				return store.set(GAME, { ...g, elapsed: Math.max(g.elapsed || 0, snapshot.elapsed || 0) });
			}
			return vacantFor(snapshot.id) && write(snapshot);
		},

		setFlipped(id, flipped) {
			const g = slot();
			return g?.id === id && store.set(GAME, { ...g, flipped });
		},

		// 本局结束：存档位仍停在本页所基于的状态才清掉；返回是否清了。
		end(id) {
			const g = slot();
			if (!g || g.id !== id || g.token !== synced) return false;
			store.set(GAME, null);
			store.set(ENDED, [...ended().filter(e => e !== id), id].slice(-KEEP_ENDED));
			return true;
		}
	};
}
