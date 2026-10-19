// 一次搜索请求 → 结果消息。worker 与主线程兜底共用这一份，保证两条路走出来的棋完全一样。
import { fromFen, squareName } from './engine.js';
import { search } from './ai.js';

export function runSearch(data) {
	const pos = fromFen(data.fen);
	const started = performance.now();
	const result = search(pos, { level: data.level });
	return {
		type: 'result',
		id: data.id,
		from: result.move ? squareName(result.move.from) : null,
		to: result.move ? squareName(result.move.to) : null,
		promotion: result.move?.promotion || 0,
		score: result.score,
		depth: result.depth,
		nodes: result.nodes,
		ms: performance.now() - started
	};
}
