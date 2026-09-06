import {
	WHITE, BLACK, QUEEN,
	fromFen, toFen, generateMoves, makeMove, sanOf, status, findMove,
	parseSquare, typeOf, other
} from '../chess/engine.js';
import { evaluate } from '../chess/ai.js';

const MATERIAL = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 0 };

// 搜索常常二十毫秒就回了开局着法，读起来像对手压着你走。
// 每个等级都会把手按在棋子上等一会儿：[下限, 随机区间]，单位毫秒。
const PACE = {
	novice: [450, 550],
	club: [900, 1000],
	expert: [1250, 1400],
	master: [1600, 2000]
};

const positionKey = pos => toFen(pos).split(' ').slice(0, 4).join(' ');

export function createMatch(hooks = {}) {
	const worker = new Worker(new URL('../chess/worker.js', import.meta.url), { type: 'module' });
	let requestId = 0;

	const state = {
		pos: fromFen(),
		history: [],
		human: WHITE,
		level: 'club',
		clocks: { [WHITE]: 600000, [BLACK]: 600000 },
		increment: 5000,
		thinking: false,
		over: null,
		eval: 0,
		lastMove: null,
		repeats: new Map(),
		started: false
	};

	let askedAt = 0;
	let paceTimer = 0;

	worker.onmessage = ({ data }) => {
		if (data.id !== requestId) return;
		if (data.type !== 'result') return;
		if (state.over || !data.from) { state.thinking = false; return; }

		const move = findMove(state.pos, parseSquare(data.from), parseSquare(data.to), data.promotion || QUEEN);
		if (!move) { state.thinking = false; hooks.onError?.('对手的思路断了。'); return; }

		const play = () => {
			paceTimer = 0;
			state.thinking = false;
			if (state.over) return;
			state.eval = (state.pos.turn === WHITE ? 1 : -1) * data.score / 100;
			commit(move, { thinkMs: data.ms, depth: data.depth });
		};

		const [floor, spread] = PACE[state.level] || PACE.club;
		const owed = floor + Math.random() * spread - (performance.now() - askedAt);
		if (owed > 0) paceTimer = setTimeout(play, owed);
		else play();
	};

	function tally() {
		const counts = { [WHITE]: 0, [BLACK]: 0 };
		for (const entry of state.history) {
			if (!entry.captured) continue;
			counts[entry.mover] += MATERIAL[typeOf(entry.captured)] || 0;
		}
		return { [WHITE]: counts[WHITE] - counts[BLACK], [BLACK]: counts[BLACK] - counts[WHITE] };
	}

	function finish(reason, winner) {
		state.over = { reason, winner };
		state.thinking = false;
		hooks.onEnd?.(state.over);
	}

	function commit(move, meta = {}) {
		const mover = state.pos.turn;
		const san = sanOf(state.pos, move);
		const before = toFen(state.pos);
		const captured = move.captured;
		makeMove(state.pos, move);

		if (state.timed !== false) state.clocks[mover] += state.increment;
		state.lastMove = move;
		state.history.push({ san, move, before, mover, captured, ...meta });

		const key = positionKey(state.pos);
		const seen = (state.repeats.get(key) || 0) + 1;
		state.repeats.set(key, seen);

		state.eval = evaluate(state.pos) / 100 * (state.pos.turn === WHITE ? 1 : -1);

		hooks.onMove?.(move, { san, mover, captured, material: tally() });

		const result = status(state.pos);
		if (result === 'checkmate') finish('checkmate', mover);
		else if (result === 'stalemate') finish('stalemate', null);
		else if (result === 'fifty') finish('fifty-move rule', null);
		else if (result === 'material') finish('insufficient material', null);
		else if (seen >= 3) finish('threefold repetition', null);
		else {
			hooks.onTurn?.(state.pos.turn, result === 'check');
			if (state.pos.turn !== state.human) think();
		}
	}

	function think() {
		if (state.over) return;
		clearTimeout(paceTimer);
		paceTimer = 0;
		state.thinking = true;
		askedAt = performance.now();
		requestId++;
		hooks.onThink?.(state.pos.turn);
		worker.postMessage({ type: 'search', id: requestId, fen: toFen(state.pos), level: state.level });
	}

	return {
		state,

		newGame({ human = WHITE, level = 'club', minutes = 10, increment = 5 } = {}) {
			requestId++;
			clearTimeout(paceTimer);
			paceTimer = 0;
			state.pos = fromFen();
			state.history = [];
			state.human = human;
			state.level = level;
			state.clocks = { [WHITE]: minutes * 60000, [BLACK]: minutes * 60000 };
			state.increment = increment * 1000;
			state.timed = false; // 用户要求：不要倒计时，轻松下棋不读秒
			state.thinking = false;
			state.over = null;
			state.eval = 0;
			state.lastMove = null;
			state.repeats = new Map([[positionKey(state.pos), 1]]);
			state.started = true;
			hooks.onReset?.();
			hooks.onTurn?.(WHITE, false);
			if (human !== WHITE) think();
		},

		movesFrom: sq => (state.over || state.thinking || state.pos.turn !== state.human)
			? [] : generateMoves(state.pos, { from: sq }),

		play(from, to, promotion = QUEEN) {
			if (state.over || state.thinking || state.pos.turn !== state.human) return null;
			const move = findMove(state.pos, from, to, promotion);
			if (!move) return null;
			commit(move);
			return move;
		},

		// 倒回人类玩家的上一回合：他的那步加上对手的回应。
		// 随时可悔——对手是电脑，思考中、终局后都能悔，连按就连悔。
		undo() {
			if (!state.history.length) return false;
			const target = state.history.findLastIndex(h => h.mover === state.human);
			if (target < 0) return false;
			const entry = state.history[target];
			state.history = state.history.slice(0, target);
			state.pos = fromFen(entry.before);
			state.over = null;
			state.lastMove = state.history.length ? state.history[state.history.length - 1].move : null;
			state.repeats = new Map();
			state.eval = evaluate(state.pos) / 100 * (state.pos.turn === WHITE ? 1 : -1);
			requestId++;
			clearTimeout(paceTimer);
			paceTimer = 0;
			state.thinking = false;
			hooks.onReset?.();
			hooks.onTurn?.(state.pos.turn, false);
			return true;
		},

		resign() {
			if (state.over) return;
			finish('resignation', other(state.human));
		},

		tick(dt) {
			if (state.over || !state.started || state.timed === false) return;
			const side = state.pos.turn;
			state.clocks[side] = Math.max(0, state.clocks[side] - dt * 1000);
			if (state.clocks[side] === 0) finish('flag fall', other(side));
		},

		tally,
		pgn() {
			const moves = state.history.map((h, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + h.san).join(' ');
			const tail = state.over
				? state.over.winner === WHITE ? ' 1-0' : state.over.winner === BLACK ? ' 0-1' : ' 1/2-1/2'
				: ' *';
			return moves + tail;
		},
		dispose() { clearTimeout(paceTimer); worker.terminate(); }
	};
}
