// 对局存档位：刷新或关掉标签页后能接着下。几个标签页共用一个存档位，用版本号做乐观并发控制。
// 元数据单独存一个小键（判断时不必解析整份棋谱）：
//   rev   每次写入/清空加一
//   id    存档位里那盘的对局 id（空位为 null）
//   ended 最近结束（被清掉）的对局 id
// 每个标签页各有一个句柄，记着自己上次读写时看到的 rev：
//   save(claim)  真实操作（人走子、新开局、悔棋）总是写入；
//   save()       其余时机（电脑应着、切后台、关页）只用来保存本页自己的进度：本页做过真实操作，
//                且存档位自本页上次读写后没被别的页动过、或已空出且空出的不是本局时才写——
//                只是打开看看的页不会写，旧标签页不会覆盖新棋，也不会复活已结束的局；
//   end(id)      终局时，存档位里正是本局、且自本页上次读写后没被别的页动过，才清掉。

const GAME = 'frostfall.game';
const META = 'frostfall.meta';

export function createSaveSlot(storage) {
	let seen = 0;
	let acted = false;           // 本页做过真实操作后，才有"自己的进度"可在被动时机保存
	// 惰性取存储：沙箱 iframe 等环境里一碰 localStorage 就抛错，只能在 try 里访问。
	const store = () => storage ?? globalThis.localStorage;
	const get = key => {
		try { return JSON.parse(store().getItem(key) || 'null'); } catch { return null; }
	};
	const put = (key, value) => {
		try {
			if (value === null) store().removeItem(key);
			else store().setItem(key, JSON.stringify(value));
		} catch { /* 隐私模式等存不了：只在本次会话生效 */ }
	};
	const meta = () => ({ rev: 0, id: null, ended: null, ...get(META) });
	const commit = next => { put(META, next); seen = next.rev; };

	return {
		// 读出存档并记下此刻的版本；旧版存档没有 id。
		load() {
			seen = meta().rev;
			const g = get(GAME);
			return g && typeof g.fen === 'string' && Array.isArray(g.moves) ? g : null;
		},

		// 写入进行中的对局（snapshot.id 为对局 id）；返回是否写了。
		save(snapshot, { claim = false } = {}) {
			const m = meta();
			if (!claim) {
				if (!acted) return false;
				const free = !m.id && m.ended !== snapshot.id;
				if (m.rev !== seen && !free) return false;
			}
			acted = true;
			put(GAME, snapshot);
			commit({ rev: m.rev + 1, id: snapshot.id, ended: m.ended });
			return true;
		},

		// 本局结束：存档位里正是本局、且没被别的页动过才清掉（别的页可能接着这局下了更多步）；返回是否清了。
		end(id) {
			const m = meta();
			if (m.id !== id || m.rev !== seen) return false;
			put(GAME, null);
			commit({ rev: m.rev + 1, id: null, ended: id });
			return true;
		}
	};
}
