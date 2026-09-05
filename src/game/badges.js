import * as THREE from 'three';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE } from '../chess/engine.js';

const LETTER = { [PAWN]: 'P', [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };
const ICON = { [PAWN]: '♟', [KNIGHT]: '♞', [BISHOP]: '♝', [ROOK]: '♜', [QUEEN]: '♛', [KING]: '♚' };
const cache = new Map();

function badgeTexture(type, color, icon = false) {
	const key = `${type}:${color}:${icon ? 'icon' : 'letter'}`;
	if (cache.has(key)) return cache.get(key);

	const W = 128, H = 148, S = 2;
	const canvas = document.createElement('canvas');
	canvas.width = W * S;
	canvas.height = H * S;
	const ctx = canvas.getContext('2d');
	ctx.scale(S, S);

	if (icon) {
		// 俯瞰模式：画成标准二维棋子的样子——不要底牌，只要棋形。
		// 白子：象牙白填充 + 深描边；黑子：深黑填充 + 亮描边。
		// 粗描边 + 软阴影，落在深浅格子上都分得开。
		const fill = color === WHITE ? '#f6efe0' : '#131b29';
		const stroke = color === WHITE ? 'rgba(12,19,32,.92)' : 'rgba(238,246,252,.88)';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = '108px "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", sans-serif';
		ctx.lineJoin = 'round';
		ctx.shadowColor = 'rgba(0,3,8,.6)';
		ctx.shadowBlur = 9;
		ctx.shadowOffsetY = 3;
		ctx.lineWidth = 9;
		ctx.strokeStyle = stroke;
		ctx.strokeText(ICON[type], 64, 76);
		ctx.shadowColor = 'transparent';
		ctx.shadowBlur = 0;
		ctx.shadowOffsetY = 0;
		ctx.fillStyle = fill;
		ctx.fillText(ICON[type], 64, 76);
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
	texture.anisotropy = 4;
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
