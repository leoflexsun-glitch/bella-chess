import * as THREE from 'three';
import { WHITE, BLACK, KNIGHT, colorOf, pieceList, EP, KCASTLE, QCASTLE } from '../chess/engine.js';
import { pieceGeometries, PIECE_TOP } from './pieces.js';
import { pieceMaterial } from './materials.js';
import { createBadge } from './badges.js';
import { squareToWorld } from './board.js';

const LIFT = 0.62;
const SNOW = new THREE.Color(0xd8e8ff);
const SHARD = { [WHITE]: new THREE.Color(0xf3e6cc), [BLACK]: new THREE.Color(0x7c93c6) };

const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

// ── 诊断日志：吃子/销毁/悔棋全程留痕，出现残影时可一键导出 ──
const CHESS_LOG = [];
const LOG_MAX = 400;
function logEvent(type, detail = '') {
	const line = `${new Date().toISOString().slice(11, 19)} ${type} ${detail}`;
	CHESS_LOG.push(line);
	if (CHESS_LOG.length > LOG_MAX) CHESS_LOG.splice(0, CHESS_LOG.length - LOG_MAX);
	if (typeof window !== 'undefined') window.__CHESS_LOG = CHESS_LOG;
}
if (typeof window !== 'undefined') window.__CHESS_LOG = CHESS_LOG;

export function createTable(scene, bursts) {
	const group = new THREE.Group();
	scene.add(group);

	const geometries = pieceGeometries();
	const bySquare = new Map();
	const vanishingPieces = new Set();
	const tweens = [];
	const meshes = [];
	let badgesOn = false;

	function spawn(type, color, sq) {
		const mesh = new THREE.Mesh(geometries[type], pieceMaterial(color === WHITE ? 'ivory' : 'obsidian'));
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		squareToWorld(sq, mesh.position);
		const outward = ((sq & 15) < 4 ? -1 : 1) * (color === WHITE ? 1 : -1);
		mesh.rotation.y = type === KNIGHT
			? (color === BLACK ? Math.PI : 0) + outward * 0.44
			: Math.random() * Math.PI * 2;
		group.add(mesh);
		meshes.push(mesh);

		const badge = createBadge(type, color);
		badge.visible = badgesOn;
		badge.material.opacity = badgesOn ? 1 : 0;
		group.add(badge);

		const entry = { mesh, badge, type, color, sq, lift: 0, selected: false, bob: Math.random() * 6.28 };
		bySquare.set(sq, entry);
		return entry;
	}

	function destroy(entry) {
		group.remove(entry.mesh, entry.badge);
		entry.mesh.material.dispose();
		entry.badge.material.dispose();
		const mi = meshes.indexOf(entry.mesh);
		if (mi >= 0) meshes.splice(mi, 1);
	}

	function clear() {
		logEvent('CLEAR', `bySq=${bySquare.size} vanishing=${vanishingPieces.size} tweens=${tweens.length}`);
		for (const entry of bySquare.values()) destroy(entry);
		bySquare.clear();
		// 正在碎裂的棋子已不在 bySquare 里，这里一并销毁；
		// 否则悔棋/重开发生在碎裂窗口内时，碎到一半的棋子会冻结成残影。
		for (const entry of vanishingPieces) destroy(entry);
		vanishingPieces.clear();
		tweens.length = 0;
	}

	function sync(pos) {
		clear();
		for (const { sq, type, color } of pieceList(pos)) spawn(type, color, sq);
		logEvent('SYNC', `spawned=${bySquare.size}`);
	}

	function move(entry, sq) {
		bySquare.delete(entry.sq);
		entry.sq = sq;
		bySquare.set(sq, entry);
	}

	function tween(dur, update, done) {
		tweens.push({ t: 0, dur, update, done });
	}

	function vanish(entry) {
		const from = entry.mesh.position.clone();
		bySquare.delete(entry.sq);
		entry.vanishing = true;
		vanishingPieces.add(entry);
		logEvent('VANISH', `${entry.color===WHITE?'W':'B'}${entry.type}@sq${entry.sq} tweens=${tweens.length}`);
		// 徽章不跟碎裂动画，直接隐藏。
		entry.badge.visible = false;
		tween(0.52, k => {
			entry.mesh.position.y = from.y + easeOut(k) * 0.7;
			entry.mesh.rotation.y += 0.16;
			entry.mesh.scale.setScalar(Math.max(0.001, 1 - easeOut(k)));
		}, () => {
			vanishingPieces.delete(entry);
			bursts.emit(from.clone().setY(from.y + 0.3), 34, {
				color: SHARD[entry.color], spread: 1.9, rise: 1.4, size: 5.5, life: 0.9
			});
			logEvent('VANISH-DONE', `sq${entry.sq} vanishing=${vanishingPieces.size} bySq=${bySquare.size}`);
			destroy(entry);
		});
	}

	function playMove(move_, { onDone } = {}) {
		const mover = bySquare.get(move_.from);
		if (!mover) { onDone?.(); return; }

		const captureSq = move_.flags & EP ? move_.to + (colorOf(move_.piece) === WHITE ? 16 : -16) : move_.to;
		let victim = move_.captured ? bySquare.get(captureSq) : null;
		// 快棋竞态：对方吃子后目标棋子仍在 0.52s 碎裂中，已不在 bySquare，
		// 而它"占了"的格子我们立刻要吃/落子。把它从碎裂集合里捞出来立刻销毁。
		if (move_.captured && !victim) {
			for (const entry of vanishingPieces) {
				if (entry.sq === captureSq) { victim = entry; break; }
			}
			if (victim) {
				vanishingPieces.delete(victim);
				logEvent('RACE-KILL', `sq${captureSq} ${victim.color===WHITE?'W':'B'}${victim.type} 在碎裂中被连吃`);
				destroy(victim);
				victim = null;
			}
		}

		const start = mover.mesh.position.clone();
		const end = squareToWorld(move_.to, new THREE.Vector3());
		const hop = mover.type === KNIGHT ? 1.05 : 0.0;
		const travel = 0.14 + Math.min(0.34, start.distanceTo(end) * 0.055);

		mover.selected = false;
		mover.animating = true;
		mover.lift = 0;
		mover.mesh.renderOrder = 2;

		tween(0.13, k => { mover.mesh.position.y = easeOut(k) * LIFT; }, () => {
			if (victim) vanish(victim);
			tween(travel, k => {
				const e = easeInOut(k);
				mover.mesh.position.x = start.x + (end.x - start.x) * e;
				mover.mesh.position.z = start.z + (end.z - start.z) * e;
				mover.mesh.position.y = LIFT + Math.sin(k * Math.PI) * hop;
			}, () => {
				tween(0.12, k => { mover.mesh.position.y = LIFT * (1 - easeOut(k)); }, () => {
					mover.mesh.position.copy(end);
					mover.mesh.renderOrder = 0;
					mover.animating = false;
					bursts.emit(end.clone().setY(0.03), 16, { color: SNOW, spread: 0.9, rise: 0.7, size: 4, life: 0.6 });
					move(mover, move_.to);
					logEvent('MOVE-DONE', `sq${move_.from}->sq${move_.to}${move_.captured?' x'+move_.captured:''}${move_.promotion?' ='+move_.promotion:''} bySq=${bySquare.size} tweens=${tweens.length}`);
					if (move_.promotion) {
						mover.type = move_.promotion;
						mover.mesh.geometry = geometries[move_.promotion];
						const swap = createBadge(move_.promotion, mover.color);
						swap.visible = mover.badge.visible;
						swap.material.opacity = mover.badge.material.opacity;
						group.remove(mover.badge);
						mover.badge.material.dispose();
						mover.badge = swap;
						group.add(swap);
						bursts.emit(end.clone().setY(0.4), 40, { color: SHARD[mover.color], spread: 1.1, rise: 1.8, size: 5, life: 1.0 });
					}
					onDone?.();
				});
			});
		});

		if (move_.flags & (KCASTLE | QCASTLE)) {
			const kingSide = Boolean(move_.flags & KCASTLE);
			const rookFrom = kingSide ? move_.to + 1 : move_.to - 2;
			const rookTo = kingSide ? move_.to - 1 : move_.to + 1;
			const rook = bySquare.get(rookFrom);
			if (rook) {
				const rs = rook.mesh.position.clone();
				const re = squareToWorld(rookTo, new THREE.Vector3());
				move(rook, rookTo);
				rook.animating = true;
				tween(0.42, k => {
					const e = easeInOut(k);
					rook.mesh.position.lerpVectors(rs, re, e);
					rook.mesh.position.y = Math.sin(k * Math.PI) * 0.18;
				}, () => {
					rook.mesh.position.copy(re);
					rook.animating = false;
					bursts.emit(re.clone().setY(0.03), 10, { color: SNOW, spread: 0.7, rise: 0.5, size: 3.4, life: 0.5 });
				});
			}
		}
	}

	function select(sq) {
		for (const entry of bySquare.values()) entry.selected = entry.sq === sq;
	}

	return {
		group,
		meshes,
		sync,
		playMove,
		// 所有走子/碎裂动画都已落定（悔棋重建前必须满足，
		// 否则进行中的 tween 闭包会抓住旧棋子不放，重建后回写出残子）。
		isIdle: () => tweens.length === 0,
		// 残影自检：把三维桌面上的棋子和棋盘逻辑状态逐格对账，
		// 任何多出来/少掉的棋子都记进日志并当场修正（碎裂中的棋子本就暂时缺席，跳过）。
		audit(pos) {
			const want = new Map();
			for (const { sq, type, color } of pieceList(pos)) want.set(sq, `${color}:${type}`);
			const have = new Map();
			for (const [sq, entry] of bySquare) have.set(sq, `${entry.color}:${entry.type}`);
			let bad = 0;
			for (const [sq, sig] of have) {
				if (want.get(sq) !== sig) { bad++; logEvent('GHOST-EXTRA', `sq${sq} have=${sig} want=${want.get(sq) || 'empty'}`); }
			}
			for (const [sq, sig] of want) {
				if (have.get(sq) !== sig) { bad++; logEvent('GHOST-MISSING', `sq${sq} want=${sig} have=${have.get(sq) || 'empty'}`); }
			}
			if (vanishingPieces.size) logEvent('GHOST-VANISHING', `stuck=${vanishingPieces.size} idle=${tweens.length === 0}`);
			if (bad) {
				logEvent('GHOST-SUMMARY', `mismatch=${bad} bySq=${bySquare.size} meshes=${meshes.length} want=${want.size} —— 自动重建桌面`);
				// 兜底自愈：出现残子/缺子直接按逻辑状态重建，用户侧无感。
				this.sync(pos);
			}
			return bad;
		},
		select,
		at: sq => bySquare.get(sq),
		squareOfMesh(mesh) {
			for (const entry of bySquare.values()) if (entry.mesh === mesh) return entry.sq;
			return -1;
		},
		setBadges(on) {
			badgesOn = on;
			for (const entry of bySquare.values()) entry.badge.visible = on;
		},
		update(dt, time) {
			for (let i = tweens.length - 1; i >= 0; i--) {
				const tw = tweens[i];
				tw.t = Math.min(1, tw.t + dt / tw.dur);
				tw.update(tw.t);
				if (tw.t >= 1) { tweens.splice(i, 1); tw.done?.(); }
			}
			for (const entry of bySquare.values()) {
				const glow = entry.mesh.material.userData.uniforms.uLift;
				glow.value += ((entry.selected ? 0.55 : 0) - glow.value) * Math.min(1, dt * 8);

				if (entry.animating || entry.vanishing) entry.lift = 0;
				else {
					const want = entry.selected ? 0.30 + Math.sin(time * 2.6 + entry.bob) * 0.035 : 0;
					entry.lift += (want - entry.lift) * Math.min(1, dt * 11);
					entry.mesh.position.y = entry.lift;
				}

				if (entry.badge.visible) {
					entry.badge.position.set(
						entry.mesh.position.x,
						entry.mesh.position.y + PIECE_TOP[entry.type] + 0.26,
						entry.mesh.position.z
					);
					entry.badge.material.opacity += (1 - entry.badge.material.opacity) * Math.min(1, dt * 6);
				}
			}
		}
	};
}
