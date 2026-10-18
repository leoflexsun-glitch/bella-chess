// 离线棋图识别：截图/翻拍里的 2D 棋盘 → FEN 摆放串。零运行时依赖，浏览器与 Node ≥ 22 通用。
// 图像参数均为 ImageData 兼容对象 { width, height, data: Uint8ClampedArray(RGBA) }。

import { locateBoard as locate } from './locate.js';
import { warpGray, normalizeBoard, cutTiles } from './warp.js';
import { loadNet, classifyTiles, flatMask } from './net.js';
import { applyPriors, guessFlipped as guess, toPlacement as placement } from './chess.js';
import { WEIGHTS } from './weights.js';

const TILE = 32, BOARD = TILE * 8;
let packed = WEIGHTS, net = null;

// 权重延迟解码：只做定位的调用方不必付出这几毫秒
function getNet() {
	if (!net) net = loadNet(packed);
	return net;
}

// 评测脚本用：换一套权重（不属于对外 API）
export function _setWeights(w) { packed = w; net = null; }

// 找棋盘四角 → { corners: [TL,TR,BR,BL], score: 0..1 } | null
export function locateBoard(img) {
	return locate(img);
}

// 按四角（可为透视四边形）做单应性重采样，逐格分类 → { squares: string[64], confidence: Float32Array(64) }
export function readBoard(img, corners) {
	const raw = warpGray(img, corners, BOARD);
	const tiles = cutTiles(normalizeBoard(raw), BOARD);
	const probs = classifyTiles(getNet(), tiles, 64, flatMask(cutTiles(raw, BOARD), TILE, 64));
	return applyPriors(probs);
}

// 是否从黑方视角显示（黑子在下）
export function guessFlipped(squares) {
	return guess(squares);
}

// 显示顺序的 64 格 → FEN 摆放字段（第 8 横线在前）
export function toPlacement(squares, flipped) {
	return placement(squares, flipped);
}

// 定位 + 读盘 + 判方向一步到位；找不到棋盘时返回 null。额外附带定位得分 score 供界面决定是否提示手动校正。
export function recognize(img) {
	const loc = locate(img);
	if (!loc) return null;
	const { squares, confidence } = readBoard(img, loc.corners);
	const flipped = guess(squares);
	return { corners: loc.corners, squares, confidence, flipped, placement: placement(squares, flipped), score: loc.score };
}
