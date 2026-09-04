import * as THREE from 'three';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE } from '../chess/engine.js';

const LETTER = { [PAWN]: 'P', [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };
const cache = new Map();

function badgeTexture(type, color) {
	const key = `${type}:${color}`;
	if (cache.has(key)) return cache.get(key);

	const W = 128, H = 148, S = 2;
	const canvas = document.createElement('canvas');
	canvas.width = W * S;
	canvas.height = H * S;
	const ctx = canvas.getContext('2d');
	ctx.scale(S, S);

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
	ctx.font = '500 58px "Geist Mono", ui-monospace, monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(LETTER[type], 64, 66);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	cache.set(key, texture);
	return texture;
}

export function createBadge(type, color) {
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
		map: badgeTexture(type, color),
		transparent: true,
		depthTest: false,
		depthWrite: false,
		opacity: 0
	}));
	sprite.scale.set(0.26, 0.30, 1);
	sprite.renderOrder = 6;
	sprite.visible = false;
	return sprite;
}
