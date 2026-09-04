import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../chess/engine.js';

const LATHE_SEGMENTS = 44;

// 车床和盒体几何带索引，挤出的不带；合并前先拍平。
const merge = parts => {
	const flat = parts.map(g => (g.index ? g.toNonIndexed() : g));
	const out = mergeGeometries(flat, false);
	flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
	parts.forEach(g => g.dispose());
	return out;
};
const V2 = (x, y) => new THREE.Vector2(x, y);
const lerp = THREE.MathUtils.lerp;

// 给车床剖面用的小型车工语言：直线、二次圆角和圆弧，
// 全部以棋盘为单位（一格 = 1.0）。
function turn() {
	const pts = [];
	const api = {
		pts,
		at(r, y) { pts.push(V2(r, y)); return api; },
		line(r, y, n = 1) {
			const a = pts[pts.length - 1];
			for (let i = 1; i <= n; i++) pts.push(V2(lerp(a.x, r, i / n), lerp(a.y, y, i / n)));
			return api;
		},
		quad(cr, cy, r, y, n = 8) {
			const a = pts[pts.length - 1].clone();
			for (let i = 1; i <= n; i++) {
				const t = i / n, s = 1 - t;
				pts.push(V2(s * s * a.x + 2 * s * t * cr + t * t * r, s * s * a.y + 2 * s * t * cy + t * t * y));
			}
			return api;
		},
		arc(cx, cy, radius, from, to, n = 16) {
			for (let i = 1; i <= n; i++) {
				const a = lerp(from, to, i / n) * Math.PI / 180;
				pts.push(V2(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
			}
			return api;
		},
		build() {
			return new THREE.LatheGeometry(pts, LATHE_SEGMENTS);
		}
	};
	return api;
}

// 每个棋子共用的底座：压重的圆盘、倒角和一圈箍。
function foot(p, r) {
	return p.at(0, 0).line(r * 0.55, 0, 2).line(r, 0, 2)
		.line(r, 0.028, 1)
		.quad(r, 0.056, r * 0.88, 0.066, 5)
		.quad(r * 0.76, 0.072, r * 0.74, 0.088, 4)
		.quad(r * 0.56, 0.100, r * 0.42, 0.122, 6);
}

function pawn() {
	const p = foot(turn(), 0.232);
	p.quad(0.098, 0.150, 0.082, 0.205, 7)
		.quad(0.076, 0.238, 0.086, 0.256, 5)
		.quad(0.128, 0.268, 0.130, 0.282, 5)
		.quad(0.104, 0.296, 0.072, 0.306, 5)
		.arc(0, 0.398, 0.110, -60, 90, 18)
		.at(0, 0.508);
	return p.build();
}

function rook() {
	const p = foot(turn(), 0.252);
	p.quad(0.112, 0.150, 0.104, 0.230, 7)
		.quad(0.104, 0.290, 0.126, 0.318, 6)
		.quad(0.176, 0.336, 0.178, 0.360, 6)
		.line(0.170, 0.470, 2)
		.quad(0.172, 0.500, 0.196, 0.512, 5)
		.line(0.196, 0.548, 1)
		.line(0.150, 0.548, 1)
		.line(0.150, 0.516, 1)
		.line(0, 0.516, 3);
	const parts = [p.build()];

	const merlon = new THREE.BoxGeometry(0.086, 0.082, 0.062);
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2;
		const m = merlon.clone();
		m.rotateY(-a);
		m.translate(Math.sin(a) * 0.156, 0.578, Math.cos(a) * 0.156);
		parts.push(m);
	}
	merlon.dispose();
	return merge(parts);
}

function bishop() {
	const p = foot(turn(), 0.248);
	p.quad(0.104, 0.156, 0.090, 0.222, 7)
		.quad(0.086, 0.262, 0.126, 0.286, 6)
		.quad(0.150, 0.300, 0.148, 0.318, 5)
		.quad(0.118, 0.334, 0.112, 0.352, 5)
		.quad(0.152, 0.392, 0.152, 0.446, 8)
		.line(0.148, 0.486, 2)
		.quad(0.142, 0.520, 0.116, 0.538, 6)
		.quad(0.106, 0.548, 0.116, 0.560, 4)
		.quad(0.124, 0.572, 0.100, 0.586, 4)
		.quad(0.072, 0.630, 0.044, 0.676, 9)
		.quad(0.030, 0.692, 0.030, 0.702, 3)
		.arc(0, 0.734, 0.048, -52, 90, 12)
		.at(0, 0.782);
	return p.build();
}

function queen() {
	const p = foot(turn(), 0.268);
	p.quad(0.116, 0.168, 0.100, 0.250, 8)
		.quad(0.096, 0.310, 0.132, 0.342, 6)
		.quad(0.158, 0.358, 0.156, 0.378, 5)
		.quad(0.126, 0.396, 0.122, 0.418, 5)
		.quad(0.196, 0.470, 0.208, 0.552, 10)
		.quad(0.212, 0.578, 0.196, 0.590, 5)
		.line(0.150, 0.590, 1)
		.quad(0.146, 0.566, 0.120, 0.560, 5)
		.line(0, 0.560, 3);
	const parts = [p.build()];

	const point = new THREE.ConeGeometry(0.036, 0.086, 7);
	for (let i = 0; i < 9; i++) {
		const a = (i / 9) * Math.PI * 2;
		const s = point.clone();
		s.translate(Math.sin(a) * 0.180, 0.628, Math.cos(a) * 0.180);
		parts.push(s);
	}
	point.dispose();

	const collar = new THREE.CylinderGeometry(0.062, 0.078, 0.052, 16);
	collar.translate(0, 0.600, 0);
	const finial = new THREE.SphereGeometry(0.058, 16, 12);
	finial.translate(0, 0.664, 0);
	parts.push(collar, finial);
	return merge(parts);
}

function king() {
	const p = foot(turn(), 0.278);
	p.quad(0.122, 0.176, 0.106, 0.268, 8)
		.quad(0.102, 0.336, 0.140, 0.370, 6)
		.quad(0.166, 0.386, 0.164, 0.408, 5)
		.quad(0.132, 0.428, 0.128, 0.452, 5)
		.quad(0.204, 0.512, 0.216, 0.600, 10)
		.quad(0.220, 0.630, 0.202, 0.644, 5)
		.line(0.158, 0.644, 1)
		.quad(0.156, 0.618, 0.128, 0.612, 5)
		.quad(0.126, 0.660, 0.086, 0.688, 6)
		.quad(0.070, 0.700, 0.068, 0.716, 4)
		.line(0, 0.716, 3);
	const parts = [p.build()];

	const crownPoint = new THREE.ConeGeometry(0.034, 0.070, 8);
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		const c = crownPoint.clone();
		c.translate(Math.sin(a) * 0.184, 0.672, Math.cos(a) * 0.184);
		parts.push(c);
	}
	crownPoint.dispose();

	const stem = new THREE.BoxGeometry(0.050, 0.200, 0.050);
	stem.translate(0, 0.812, 0);
	const arm = new THREE.BoxGeometry(0.150, 0.048, 0.048);
	arm.translate(0, 0.842, 0);
	parts.push(stem, arm);
	return merge(parts);
}

// 骑士是车床做不出来的那个棋子：一个底座加一块雕出来的侧面
// 轮廓，厚度上逐点收细，所以从每个角度看都是一颗马头，而不是
// 一块板。它面朝 -z，朝向棋盘前方。
function knight() {
	const p = foot(turn(), 0.252);
	p.quad(0.116, 0.156, 0.108, 0.212, 7)
		.quad(0.108, 0.244, 0.136, 0.258, 5)
		.line(0.140, 0.272, 1)
		.quad(0.132, 0.292, 0.112, 0.298, 4)
		.line(0, 0.298, 3);
	const parts = [p.build()];

	const head = new THREE.Shape();
	head.moveTo(-0.150, 0.264);
	head.bezierCurveTo(-0.196, 0.362, -0.186, 0.478, -0.154, 0.560);
	head.bezierCurveTo(-0.138, 0.606, -0.114, 0.646, -0.094, 0.672);
	head.lineTo(-0.116, 0.732);
	head.lineTo(-0.040, 0.696);
	head.bezierCurveTo(-0.014, 0.740, 0.022, 0.750, 0.050, 0.734);
	head.bezierCurveTo(0.086, 0.712, 0.114, 0.666, 0.144, 0.620);
	head.bezierCurveTo(0.184, 0.562, 0.222, 0.526, 0.246, 0.498);
	head.bezierCurveTo(0.266, 0.474, 0.258, 0.446, 0.230, 0.434);
	head.bezierCurveTo(0.196, 0.420, 0.152, 0.420, 0.118, 0.414);
	head.bezierCurveTo(0.078, 0.404, 0.052, 0.378, 0.040, 0.342);
	head.bezierCurveTo(0.028, 0.306, 0.030, 0.286, 0.042, 0.264);
	head.lineTo(-0.150, 0.264);

	const headGeo = new THREE.ExtrudeGeometry(head, {
		depth: 0.190, bevelEnabled: true, bevelSize: 0.030, bevelThickness: 0.024, bevelSegments: 3, curveSegments: 16
	});
	headGeo.translate(0, 0, -0.095);

	// 朝马嘴和耳朵方向收窄；面颊保持饱满。
	const attr = headGeo.attributes.position;
	for (let i = 0; i < attr.count; i++) {
		const x = attr.getX(i), y = attr.getY(i);
		const muzzle = THREE.MathUtils.clamp((x - 0.02) / 0.24, 0, 1);
		const ears = THREE.MathUtils.clamp((y - 0.60) / 0.14, 0, 1);
		const jaw = THREE.MathUtils.clamp((0.30 - y) / 0.10, 0, 1);
		attr.setZ(i, attr.getZ(i) * (1 - 0.46 * muzzle) * (1 - 0.34 * ears) * (1 - 0.20 * jaw));
	}
	headGeo.rotateY(Math.PI / 2);
	headGeo.computeVertexNormals();
	parts.push(headGeo);

	return merge(parts);
}

const BUILDERS = { [PAWN]: pawn, [KNIGHT]: knight, [BISHOP]: bishop, [ROOK]: rook, [QUEEN]: queen, [KING]: king };

export const PIECE_TOP = { [PAWN]: 0.51, [KNIGHT]: 0.75, [BISHOP]: 0.78, [ROOK]: 0.62, [QUEEN]: 0.73, [KING]: 0.94 };

let cache = null;

export function pieceGeometries() {
	if (cache) return cache;
	cache = {};
	for (const [kind, build] of Object.entries(BUILDERS)) {
		const geo = build();
		geo.computeBoundingBox();
		geo.computeBoundingSphere();
		cache[kind] = geo;
	}
	return cache;
}
