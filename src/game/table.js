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

export function createTable(scene, bursts) {
	const group = new THREE.Group();
	scene.add(group);

	const geometries = pieceGeometries();
	const bySquare = new Map();
	const tweens = [];
	const meshes = [];
	let badgesOn = false;
	let badgeIcons = false;

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
		if (badgeIcons) badge.material.map = badge.userData.maps.icon;
		badge.visible = badgesOn;
		badge.material.opacity = badgesOn ? 1 : 0;
		if (badgeIcons) badge.scale.set(0.52, 0.60, 1);
		group.add(badge);

		const entry = { mesh, badge, type, color, sq, lift: 0, selected: false, bob: Math.random() * 6.28 };
		bySquare.set(sq, entry);
		return entry;
	}

	function destroy(entry) {
		group.remove(entry.mesh, entry.badge);
		entry.mesh.material.dispose();
		entry.badge.material.dispose();
		meshes.splice(meshes.indexOf(entry.mesh), 1);
	}

	function clear() {
		for (const entry of bySquare.values()) destroy(entry);
		bySquare.clear();
		tweens.length = 0;
	}

	function sync(pos) {
		clear();
		for (const { sq, type, color } of pieceList(pos)) spawn(type, color, sq);
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
		entry.badge.visible = false;
		tween(0.52, k => {
			entry.mesh.position.y = from.y + easeOut(k) * 0.7;
			entry.mesh.rotation.y += 0.16;
			entry.mesh.scale.setScalar(Math.max(0.001, 1 - easeOut(k)));
		}, () => {
			bursts.emit(from.clone().setY(from.y + 0.3), 34, {
				color: SHARD[entry.color], spread: 1.9, rise: 1.4, size: 5.5, life: 0.9
			});
			destroy(entry);
		});
	}

	function playMove(move_, { onDone } = {}) {
		const mover = bySquare.get(move_.from);
		if (!mover) { onDone?.(); return; }

		const captureSq = move_.flags & EP ? move_.to + (colorOf(move_.piece) === WHITE ? 16 : -16) : move_.to;
		const victim = move_.captured ? bySquare.get(captureSq) : null;

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
		// 俯瞰模式：换成棋形图案，并放大到格子里一眼可辨。
		setBadgeIcons(on) {
			badgeIcons = on;
			for (const entry of bySquare.values()) {
				entry.badge.material.map = on ? entry.badge.userData.maps.icon : entry.badge.userData.maps.letter;
				entry.badge.scale.set(on ? 0.52 : 0.26, on ? 0.60 : 0.30, 1);
			}
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

				if (entry.animating) entry.lift = 0;
				else {
					const want = entry.selected ? 0.30 + Math.sin(time * 2.6 + entry.bob) * 0.035 : 0;
					entry.lift += (want - entry.lift) * Math.min(1, dt * 11);
					entry.mesh.position.y = entry.lift;
				}

				if (entry.badge.visible) {
					entry.badge.position.set(
						entry.mesh.position.x,
						entry.mesh.position.y + PIECE_TOP[entry.type] + (badgeIcons ? 0.12 : 0.26),
						entry.mesh.position.z
					);
					entry.badge.material.opacity += (1 - entry.badge.material.opacity) * Math.min(1, dt * 6);
				}
			}
		}
	};
}
