import * as THREE from 'three';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE } from '../chess/engine.js';

const LETTER = { [PAWN]: 'P', [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };
// 扁平模式：白子用空心字形（白填充+灰描边），黑子用实心字形（深灰平底）——
// 就是常见二维棋谱的画法。
const ICON_W = { [PAWN]: '♙', [KNIGHT]: '♘', [BISHOP]: '♗', [ROOK]: '♖', [QUEEN]: '♕', [KING]: '♔' };
const ICON_B = { [PAWN]: '♟', [KNIGHT]: '♞', [BISHOP]: '♝', [ROOK]: '♜', [QUEEN]: '♛', [KING]: '♚' };
const cache = new Map();

function badgeTexture(type, color, icon = false) {
	const key = `${type}:${color}:${icon ? 'icon' : 'letter'}`;
	if (cache.has(key)) return cache.get(key);

	const S = 4;
	// 图标是正方形画布（棋子就是全部内容），字母徽章保留竖版盾牌。
	const W = icon ? 256 : 128, H = icon ? 256 : 148;
	const canvas = document.createElement('canvas');
	canvas.width = W * S;
	canvas.height = H * S;
	const ctx = canvas.getContext('2d');
	ctx.scale(S, S);

	if (icon) {
		// 双方都用实心字形（♝ 的斜切口、♞ 的马头在小尺寸下依然分明），
		// 只靠颜色区分敌我：白子=白填充+深描边，黑子=纯深填充。
		// 空心字形 ♗/♙ 缩到棋子大小时轮廓几乎一样，分不清象和兵。
		const glyph = ICON_B[type];
		// 加粗黑子填充（双笔画），在浅色格子上也压得住。
		const fill = color === WHITE ? '#ffffff' : '#1c1916';
		const stroke = color === WHITE ? '#333a42' : '#161310';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = '106px "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", sans-serif';
		ctx.lineJoin = 'round';
		// 轻投影，让棋子像贴纸一样落在格子上。
		ctx.shadowColor = 'rgba(30,34,40,.34)';
		ctx.shadowBlur = 5;
		ctx.shadowOffsetY = 3;
		// 白子描边粗一点，实心字形内部细节（象的切口等）才不会被填充吃掉。
		ctx.lineWidth = color === WHITE ? 7 : 8;
		ctx.strokeStyle = stroke;
		ctx.strokeText(glyph, 64, 68);
		ctx.shadowColor = 'transparent';
		ctx.shadowBlur = 0;
		ctx.shadowOffsetY = 0;
		ctx.fillStyle = fill;
		ctx.fillText(glyph, 64, 68);
	} else {
		const tint = color === WHITE ? '#cfe0f8' : '#ff9d86';
		const ink = color === WHITE ? 'rgba(10,18,32,.82)' : 'rgba(30,10,10,.82)';

		// 盾形：圆顶，下端收成尖。
		ctx.beginPath();
		ctx.moveTo(14, 26);
		ctx.quadraticCurveTo(14, 12, 30, 12);
		ctx.lineTo(98, 12);
		ctx.quadraticCurveTo(114, 12, 114, 26);
		ctx.lineTo(114, 92);
		ctx.quadraticCurveTo(114, 108, 96, 116);
		ctx.lineTo(64, 134);
		ctx.lineTo(32, 116);
		ctx.quadraticCurveTo(14, 108, 14, 92);
		ctx.closePath();

		ctx.fillStyle = ink;
		ctx.fill();
		ctx.strokeStyle = tint;
		ctx.lineWidth = 3;
		ctx.stroke();

		ctx.fillStyle = tint;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = '500 58px "Geist Mono", ui-monospace, monospace';
		ctx.fillText(LETTER[type], 64, 66);
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	cache.set(key, texture);
	return texture;
}

export function createBadge(type, color) {
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
		map: badgeTexture(type, color, false),
		transparent: true,
		depthTest: false,
		depthWrite: false,
		opacity: 0
	}));
	sprite.userData.maps = {
		letter: badgeTexture(type, color, false),
		icon: badgeTexture(type, color, true)
	};
	sprite.scale.set(0.26, 0.30, 1);
	sprite.renderOrder = 6;
	sprite.visible = false;
	return sprite;
}
