// 对局存档位：刷新或关掉标签页后能接着下。几个标签页共用一个存档位，用版本号做乐观并发控制。
// 元数据单独存一个小键：
//   rev   每次"真实操作"写入、换局或清空时加一
//   id    存档位里那盘的对局 id（空位为 null）
//   ended 最近结束（被清掉）的若干对局 id
// 每个标签页各有一个句柄，记着自己上次同步时看到的 rev（seen）：
//   save(claim)  真实操作（人走子、新开局、悔棋）：总是写入，rev 加一。
//   save()       其余时机（电脑应着、切后台、关页）：
//                a) 自本页同步后别的页没做过真实操作、位里是同一局、且本页的着法是位里着法的延续
//                   （只多不少、不分叉）——原样更新，rev 不变，因此不会把正在下的那页挤出同步；
//                b) 或存档位空着、且本局不在"已结束"名单里——写进去，rev 加一。
//                所以旧标签页不会覆盖新棋、不会写回分叉的电脑应着，也不会复活已结束的局。
//   end(id)      终局：位里正是本局、且自本页同步后别的页没做过真实操作，才清掉。

import { jsonStore } from '../core/store.js';

const GAME = 'frostfall.game';
const META = 'frostfall.meta';
const KEEP_ENDED = 20;

const extendsLine = (moves, base) => moves.length >= base.length && base.every((m, i) => moves[i] === m);

export function createSaveSlot(storage) {
	const store = jsonStore(storage);
	let seen = 0;
	const meta = () => {
		const m = { rev: 0, id: null, ...store.get(META) };
		m.ended = Array.isArray(m.ended) ? m.ended : m.ended ? [m.ended] : [];
		return m;
	};
	const commit = next => { store.set(META, next); seen = next.rev; };

	return {
		// 读出存档并与当前版本同步；旧版存档没有 id。
		load() {
			seen = meta().rev;
			const g = store.get(GAME);
			return g && typeof g.fen === 'string' && Array.isArray(g.moves) ? g : null;
		},

		// 写入进行中的对局（snapshot.id 为对局 id）；返回是否写了。
		save(snapshot, { claim = false } = {}) {
			const m = meta();
			if (!claim) {
				if (m.rev === seen && m.id === snapshot.id && extendsLine(snapshot.moves, store.get(GAME)?.moves ?? [])) {
					store.set(GAME, snapshot);
					return true;
				}
				if (m.id || m.ended.includes(snapshot.id)) return false;
			}
			store.set(GAME, snapshot);
			commit({ ...m, rev: m.rev + 1, id: snapshot.id });
			return true;
		},

		// 本局结束：位里正是本局、且没被别的页接着下过才清掉；返回是否清了。
		end(id) {
			const m = meta();
			if (m.id !== id || m.rev !== seen) return false;
			store.set(GAME, null);
			commit({ rev: m.rev + 1, id: null, ended: [...m.ended, id].slice(-KEEP_ENDED) });
			return true;
		}
	};
}
