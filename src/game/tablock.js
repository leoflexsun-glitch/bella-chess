// 同一时刻只让一个标签页"在下"存档里的这盘棋——用户正看着（切到前台、点按、按键）的那一页。
// 其余标签页待命：不跑电脑思考、不计时、不写存档，几个页面就不会同时写同一个存档位、互相覆盖。
// 谁在下只记在存储里一处（KEY）。held 是缓存，给频繁调用的地方用；写存档、清档、接手等关键时刻用 check()
// 现读存储——标签页被冻结、从往返缓存恢复等情况下错过了通知，也能借此发现并转为待命。
// 别的页接手时本页通常能通过 storage 事件立刻得知（onLost），好停下思考、显示待命。
// 存储写不进去时只有本页能用存档，算本页在下；一旦别的页接手（收到"谁在下"变化的通知）就取消。

import { jsonStore } from '../core/store.js';

const KEY = 'frostfall.active';

export function createTabLock({ storage, events = globalThis, onLost, onCleared } = {}) {
	const store = jsonStore(storage);
	const tabId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	let solo = false;
	let held = false;
	const owned = () => solo || store.get(KEY) === tabId;
	const lose = () => { held = false; onLost?.(); };
	// 重新登记后让调用方重新存档。先定好 solo 再回调：存储读不出也写不进时，回调里的 check() 走 solo，
	// 不会再次判定"被清空"而无限递归。
	const reclaim = () => { solo = !store.set(KEY, tabId); onCleared?.(); };

	events.addEventListener?.('storage', event => {
		// 存储被整个清空（同域的别的页面、清除站点数据）：没有别的页接手，本页在下就接着下——
		// 重新登记，并让调用方把对局重新存上（onCleared）。
		if (event.key === null) {
			if (held && !solo) reclaim();
			return;
		}
		// 只看"谁在下"这个键。别的页写进了它，说明别的页接手了：本页因写入失败而"独占"也到此为止。
		if (event.key !== KEY) return;
		solo = false;
		if (held && !owned()) lose();
	});

	return {
		get held() { return held; },
		check() {
			if (held && !solo && store.get(KEY) === null) {
				// "谁在下"被清掉了（本页里清空了存储，收不到通知）：没有别的页接手，重新登记、接着下。
				reclaim();
				return true;
			}
			const now = owned();
			if (held && !now) lose();
			return now;
		},
		// 接手。返回接手前是否本来就是本页在下——不是的话，调用方要从存档重新读出最新局面。
		claim() {
			const had = owned();
			if (!had) solo = !store.set(KEY, tabId);
			held = true;
			return had;
		}
	};
}
