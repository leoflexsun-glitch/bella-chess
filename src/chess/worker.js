import { fromFen, squareName } from './engine.js';
import { search } from './ai.js';

self.onmessage = ({ data }) => {
	if (data.type !== 'search') return;
	const pos = fromFen(data.fen);
	const started = performance.now();
	const result = search(pos, { level: data.level });
	self.postMessage({
		type: 'result',
		id: data.id,
		from: result.move ? squareName(result.move.from) : null,
		to: result.move ? squareName(result.move.to) : null,
		promotion: result.move?.promotion || 0,
		score: result.score,
		depth: result.depth,
		nodes: result.nodes,
		ms: performance.now() - started
	});
};
