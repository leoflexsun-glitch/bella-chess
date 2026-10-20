import {
	WHITE, BLACK, QUEEN, START_FEN,
	fromFen, toFen, generateMoves, makeMove, sanOf, status, findMove,
	parseSquare, squareName, other
} from '../chess/engine.js';
import { normalize } from '../chess/setup.js';
import { balance } from '../chess/material.js';
import { evaluate } from '../chess/ai.js';
import { runSearch } from '../chess/searcher.js';

// 搜索常常二十毫秒就回了开局着法，读起来像对手压着你走。
// 每个等级都会把手按在棋子上等一会儿：[下限, 随机区间]，单位毫秒。
const PACE = {
	novice: [450, 550],
	club: [900, 1000],
	expert: [1250, 1400],
	master: [1600, 2000]
};

const PROMO_LETTER = { 2: 'n', 3: 'b', 4: 'r', 5: 'q' };
const LETTER_PROMO = { n: 2, b: 3, r: 4, q: 5 };

const positionKey = pos => toFen(pos).split(' ').slice(0, 4).join(' ');
export const uciOf = move => squareName(move.from) + squareName(move.to) + (move.promotion ? PROMO_LETTER[move.promotion] : '');

// 搜索引擎：优先放进 worker（主线程不卡）。托管环境若禁止 worker（CSP、沙箱 iframe），
// 构造时抛错或稍后报 error，都退回主线程计算——对手照样会走棋，只是思考时界面会顿一下。
function createEngine(onResult) {
	let worker = null;
	let pending = null;
	const inline = data => setTimeout(() => onResult(runSearch(data)), 30);
	try {
		worker = typeof __INLINE_WORKER__ === 'string'
			// 单文件部署：worker 代码在打包时内联成字符串，Blob 化使用。
			? new Worker(URL.createObjectURL(new Blob([__INLINE_WORKER__], { type: 'application/javascript' })))
			// 多文件开发环境。
			: new Worker(new URL('../chess/worker.js', import.meta.url), { type: 'module' });
		worker.onmessage = ({ data }) => { pending = null; onResult(data); };
		worker.onerror = () => {
			worker = null;
			if (pending) inline(pending);
			pending = null;
		};
	} catch {
		worker = null;
	}
	return {
		post(data) {
			if (!worker) { inline(data); return; }
			pending = data;
			worker.postMessage(data);
		},
		terminate() { worker?.terminate(); },
		get inWorker() { return Boolean(worker); }
	};
}

export function createMatch(hooks = {}) {
	const worker = createEngine(data => onEngine(data));
	let requestId = 0;

	const state = {
		pos: fromFen(),
		startFen: START_FEN,
		history: [],
		human: WHITE,
		level: 'club',
		thinking: false,
		over: null,
		eval: 0,
		lastMove: null,
		repeats: new Map(),
		started: false
	};

	let askedAt = 0;
	let paceTimer = 0;
	let hint = null;   // { id, fen, done }：进行中的"提示一步"请求

	function onEngine(data) {
		if (hint && data.id === hint.id) {
			const { fen, done } = hint;
			hint = null;
			// 局面已经变了（走子/悔棋），提示作废。
			if (fen !== toFen(state.pos) || !data.from) { done(null); return; }
			done(findMove(state.pos, parseSquare(data.from), parseSquare(data.to), data.promotion || QUEEN));
			return;
		}
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
	}

	// 比分（PGN 记法）：'1-0' / '0-1' / '1/2-1/2'，未结束为 '*'。
	function result() {
		if (!state.over) return '*';
		return state.over.winner === WHITE ? '1-0' : state.over.winner === BLACK ? '0-1' : '1/2-1/2';
	}

	// 净子力分：正数表示该方多子。
	function tally() {
		const b = balance(state.pos);
		return { [WHITE]: b[WHITE].score, [BLACK]: b[BLACK].score };
	}

	function cancelThinking() {
		requestId++;
		clearTimeout(paceTimer);
		paceTimer = 0;
		state.thinking = false;
	}

	// 开新局（包括拍照/摆棋得到的局面）一律从零开始：上一局的思考、提示、棋谱、结局全部作废。
	function reset({ human = WHITE, level = 'club', fen = START_FEN } = {}) {
		cancelThinking();
		hint = null;
		state.pos = normalize(fromFen(fen));
		state.startFen = toFen(state.pos);
		state.history = [];
		state.human = human;
		state.level = level;
		state.over = null;
		state.eval = evaluate(state.pos) / 100 * (state.pos.turn === WHITE ? 1 : -1);
		state.lastMove = null;
		state.repeats = new Map([[positionKey(state.pos), 1]]);
		state.started = true;
	}

	// 终局判定；返回结局或 null。
	function verdict(mover, seen) {
		const result = status(state.pos);
		if (result === 'checkmate') return { reason: 'checkmate', winner: mover };
		if (result === 'stalemate') return { reason: 'stalemate', winner: null };
		if (result === 'fifty') return { reason: 'fifty-move rule', winner: null };
		if (result === 'material') return { reason: 'insufficient material', winner: null };
		if (seen >= 3) return { reason: 'threefold repetition', winner: null };
		return null;
	}

	// silent：恢复存档时静默重放，不逐步通知界面、不叫电脑思考。
	function commit(move, meta = {}, silent = false) {
		const mover = state.pos.turn;
		const san = sanOf(state.pos, move);
		const before = toFen(state.pos);
		const no = state.pos.full;
		const captured = move.captured;
		makeMove(state.pos, move);

		state.lastMove = move;
		state.history.push({ san, move, before, no, mover, captured, ...meta });

		const key = positionKey(state.pos);
		const seen = (state.repeats.get(key) || 0) + 1;
		state.repeats.set(key, seen);

		// 局势：电脑每步都带回搜索分（在 worker 回调里已写入，比静态评估可靠得多）；
		// 人走子后沿用上一次判断，直到电脑应答。
		const over = verdict(mover, seen);
		if (over) state.over = over;
		if (silent) return;

		hooks.onMove?.(move, { san, mover, captured, material: tally() });
		if (over) { hooks.onEnd?.(over); return; }
		if (state.pos.turn !== state.human) think();
	}

	function think() {
		if (state.over) return;
		cancelThinking();
		state.thinking = true;
		askedAt = performance.now();
		hooks.onThink?.(state.pos.turn);
		worker.post({ type: 'search', id: requestId, fen: toFen(state.pos), level: state.level });
	}

	// 界面已同步到 state 之后，告诉它轮到谁；轮到电脑就开想。
	// reason：'new' 新开一局 / 'restore' 恢复存档 / 'undo' 悔棋。界面据此决定是否平滑过渡。
	function announce(reason) {
		hooks.onReset?.(reason);
		if (state.over) { hooks.onEnd?.(state.over); return; }
		if (state.pos.turn !== state.human) think();
	}

	return {
		state,

		// fen：从任意局面开局（摆棋编辑器/拍照复刻），调用方负责先用 setup.prepare() 校验。
		newGame(options = {}) {
			reset(options);
			announce('new');
		},

		// 恢复存档：从起始局面静默重放 UCI 着法，任何一步对不上就停在那里。
		restore({ human, level, fen, moves = [] }) {
			reset({ human, level, fen });
			for (const uci of moves) {
				if (state.over) break;
				const move = findMove(state.pos, parseSquare(uci.slice(0, 2)), parseSquare(uci.slice(2, 4)), LETTER_PROMO[uci[4]] || QUEEN);
				if (!move) break;
				commit(move, {}, true);
			}
			state.eval = evaluate(state.pos) / 100 * (state.pos.turn === WHITE ? 1 : -1);
			announce('restore');
		},

		// 替人类算一步好棋；done(move | null)。负数 id 与对手搜索的序号互不冲突。
		suggest(done) {
			if (state.over || state.thinking || state.pos.turn !== state.human || hint) return false;
			hint = { id: -(++requestId), fen: toFen(state.pos), done };
			worker.post({ type: 'search', id: hint.id, fen: hint.fen, level: 'hint' });
			return true;
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

		// 悔棋：每一步都退到人类上一次落子之前（连同对手的回应一起撤掉）。
		// 对手是电脑，思考中、终局后都能悔；steps 允许一次退多步。
		undo(steps = 1) {
			let target = state.history.length;
			for (let i = 0; i < steps; i++) {
				const t = state.history.findLastIndex((h, idx) => idx < target && h.mover === state.human);
				if (t < 0) break;
				target = t;
			}
			if (target === state.history.length) return false;

			cancelThinking();
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
			announce('undo');
			return true;
		},

		resign() {
			if (state.over || !state.started) return;
			cancelThinking();
			state.over = { reason: 'resignation', winner: other(state.human) };
			hooks.onEnd?.(state.over);
		},

		// 第 ply 步走完后的局面（-1 为起始局面）；复盘浏览用。
		fenAfter(ply) {
			if (ply < 0) return state.startFen;
			if (ply + 1 < state.history.length) return state.history[ply + 1].before;
			return toFen(state.pos);
		},

		moves: () => state.history.map(h => uciOf(h.move)),

		tally,
		result,
		pgn() {
			const moves = state.history.map((h, i) => {
				if (h.mover === WHITE) return `${h.no}. ${h.san}`;
				return i === 0 ? `${h.no}... ${h.san}` : h.san;
			}).join(' ');
			// 非标准开局按 PGN 规范带上起始局面，其他软件才能正确复现。
			const header = state.startFen === START_FEN ? ''
				: `[SetUp "1"]\n[FEN "${state.startFen}"]\n\n`;
			return `${header}${moves ? moves + ' ' : ''}${result()}`;
		},
		dispose() { cancelThinking(); worker.terminate(); }
	};
}
