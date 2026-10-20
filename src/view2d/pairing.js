// 局面平滑过渡（悔棋、复盘）时给棋子配对：哪个旧棋子滑到哪个新格。
// have：原位对不上的旧棋子；need：还没有棋子的新格；元素都是 { sq, code }（0x88 格号、棋子代码）。
// 同种棋子之间按曼哈顿距离由近到远全局配对：沿直线退一格的兵优先于斜着的。
// 若按格子顺序逐个找最近的，撤回 1.e4 d5 2.exd5 c6 时会把 c6 的兵滑到 d5，而 c7 凭空淡入。

export function pairPieces(have, need) {
	const pairs = [];
	for (const a of have) {
		for (const b of need) {
			if (a.code !== b.code) continue;
			const d = Math.abs((a.sq & 15) - (b.sq & 15)) + Math.abs((a.sq >> 4) - (b.sq >> 4));
			pairs.push({ from: a.sq, to: b.sq, d });
		}
	}
	pairs.sort((x, y) => x.d - y.d);
	const used = new Set(), filled = new Set(), moves = [];
	for (const { from, to } of pairs) {
		if (used.has(from) || filled.has(to)) continue;
		used.add(from);
		filled.add(to);
		moves.push([from, to]);
	}
	return {
		moves,                                                    // [[from, to]]：滑过去
		appear: need.filter(b => !filled.has(b.sq)).map(b => b.sq), // 淡入
		vanish: have.filter(a => !used.has(a.sq)).map(a => a.sq)    // 淡出
	};
}
