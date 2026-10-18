import {
	WHITE, BLACK, QUEEN, START_FEN,
	fromFen, toFen, generateMoves, makeMove, sanOf, status, findMove, inCheck,
	parseSquare, other
} from '../chess/engine.js';
import { normalize } from '../chess/setup.js';
import { balance } from '../chess/material.js';
import { evaluate } from '../chess/ai.js';

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
	// 单文件部署：worker 代码在打包时内联成字符串，Blob 化使用；多文件开发环境回退到原路径。
	const worker = (() => {
		if (typeof __INLINE_WORKER__ === 'string') {
			return new Worker(URL.createObjectURL(new Blob([__INLINE_WORKER__], { type: 'application/javascript' })));
		}
		return new Worker(new URL('../chess/worker.js', import.meta.url), { type: 'module' });
	})();
	let requestId = 0;

	const state = {
		pos: fromFen(),
		startFen: START_FEN,
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

	// 净子力分：正数表示该方多子。
	function tally() {
		const b = balance(state.pos);
		return { [WHITE]: b[WHITE].score, [BLACK]: b[BLACK].score };
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
		const no = state.pos.full;
		const captured = move.captured;
		makeMove(state.pos, move);

		if (state.timed !== false) state.clocks[mover] += state.increment;
		state.lastMove = move;
		state.history.push({ san, move, before, no, mover, captured, ...meta });

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

		// fen：从任意局面开局（摆棋编辑器/拍照复刻），调用方负责先用 setup.prepare() 校验。
		newGame({ human = WHITE, level = 'club', minutes = 10, increment = 5, fen = START_FEN } = {}) {
			requestId++;
			clearTimeout(paceTimer);
			paceTimer = 0;
			state.pos = normalize(fromFen(fen));
			state.startFen = toFen(state.pos);
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
			hooks.onTurn?.(state.pos.turn, inCheck(state.pos));
			if (state.pos.turn !== human) think();
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
		// plies = 要回退的步数（默认回退到人类上一手：自己那步 + 对手回应）。
		// 连按悔棋时每按一次多退两手，不会出现"按了没反应"。
		undo(plies = 0) {
			if (!state.history.length) return false;
			let target;
			if (plies > 0) {
				target = Math.max(0, state.history.length - plies);
				// 目标不能停在对手着法中间——退到完整回合边界。
				const last = state.history[target - 1];
				if (last && last.mover !== state.human) target = Math.max(0, target - 1);
			} else {
				target = state.history.findLastIndex(h => h.mover === state.human);
				if (target < 0) return false;
			}
			const entry = state.history[target];
			state.history = state.history.slice(0, target);
			state.pos = fromFen(entry.before);
			state.over = null;
			state.lastMove = state.history.length ? state.history[state.history.length - 1].move : null;
			// 重复局面计数按剩余棋谱重算，悔棋后三次重复判和依然准确。
			state.repeats = new Map();
			for (const key of [...state.history.map(h => positionKey(fromFen(h.before))), positionKey(state.pos)]) {
				state.repeats.set(key, (state.repeats.get(key) || 0) + 1);
			}
			state.eval = evaluate(state.pos) / 100 * (state.pos.turn === WHITE ? 1 : -1);
			requestId++;
			clearTimeout(paceTimer);
			paceTimer = 0;
			state.thinking = false;
			hooks.onReset?.();
			hooks.onTurn?.(state.pos.turn, inCheck(state.pos));
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
			const result = state.over
				? state.over.winner === WHITE ? '1-0' : state.over.winner === BLACK ? '0-1' : '1/2-1/2'
				: '*';
			const moves = state.history.map((h, i) => {
				if (h.mover === WHITE) return `${h.no}. ${h.san}`;
				return i === 0 ? `${h.no}... ${h.san}` : h.san;
			}).join(' ');
			// 非标准开局按 PGN 规范带上起始局面，其他软件才能正确复现。
			const header = state.startFen === START_FEN ? ''
				: `[SetUp "1"]\n[FEN "${state.startFen}"]\n\n`;
			return `${header}${moves ? moves + ' ' : ''}${result}`;
		},
		dispose() { clearTimeout(paceTimer); worker.terminate(); }
	};
}
