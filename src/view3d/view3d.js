// 3D 雪林视图：把 three.js 世界包装成与 2D 棋盘相同的视图接口。
// 首次切到 3D 时才建场景（2D 用户永远不初始化 WebGL）；隐藏时停掉渲染循环。

import * as THREE from 'three';
import { createStage } from '../scene/stage.js';
import { createLighting } from '../scene/lighting.js';
import { createSky } from '../world/sky.js';
import { createGround } from '../world/ground.js';
import { createForest } from '../world/forest.js';
import { createSnowfall } from '../world/snowfall.js';
import { createProps } from '../world/props.js';
import { createBoard, worldToSquare } from '../game/board.js';
import { createTable } from '../game/table.js';
import { createBursts } from '../game/fx.js';
import { clone } from '../chess/engine.js';

const SNOW = { heavy: 1, light: 0.45, off: 0 };

export function createView3d({ canvas, settings, intents, askPromotion, onQualityDrop }) {
	let w = null;          // 场景各部件，懒建
	let pendingSync = null; // 动画进行中收到的整盘同步，落定后再执行
	let visible = false;

	function build() {
		const stage = createStage(canvas, settings.quality);
		const { scene, camera, renderer } = stage;
		const lighting = createLighting(scene, stage.state.cfg);
		const sky = createSky(scene, lighting.sunDir);
		const ground = createGround(scene);
		const forest = createForest(scene, stage.state.cfg);
		const snowfall = createSnowfall(scene, stage.state.cfg);
		const props = createProps(scene);
		const bursts = createBursts(scene);

		// 只从天空穹顶烘出来的一次性辐照环境贴图——便宜，而且正是它
		// 让象牙和黑曜带上冷冽开阔的天光感。
		{
			const envScene = new THREE.Scene();
			envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 24), sky.dome.material));
			const pmrem = new THREE.PMREMGenerator(renderer);
			scene.environment = pmrem.fromScene(envScene, 0, 0.5, 60).texture;
			scene.environmentIntensity = 0.9;
			pmrem.dispose();
		}

		const board = createBoard(scene);
		const table = createTable(scene, bursts);
		board.setHints(true);
		// 手机/触屏：着色器提示在 mediump 精度下会丢，强制启用实体网格提示。
		if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) board.setOverlay(true);
		table.setBadges(settings.badges === 'on');
		snowfall.setDensity(SNOW[settings.snow] ?? 1);

		stage.onQuality((next, automatic) => {
			lighting.setQuality(stage.state.cfg);
			snowfall.setQuality(stage.state.cfg);
			ground.setQuality(stage.state.cfg);
			bursts.setQuality(stage.state.cfg);
			if (automatic) onQualityDrop?.(next);
		});

		stage.onUpdate((dt, time) => {
			lighting.update(dt, time);
			sky.update(dt, time);
			ground.update(dt, time);
			forest.update(dt, time);
			snowfall.update(dt, time, camera);
			props.update(dt, time);
			board.update(dt, time);
			table.update(dt, time);
			bursts.update(dt, time);
			if (pendingSync && table.isIdle()) { table.sync(pendingSync); pendingSync = null; }
		});

		// ── 拾取：射线先找棋子，再找棋盘格 ──
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();
		const pick = event => {
			pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
			raycaster.setFromCamera(pointer, camera);
			const onPiece = raycaster.intersectObjects(table.meshes, false)[0];
			if (onPiece) {
				const sq = table.squareOfMesh(onPiece.object);
				if (sq >= 0) return sq;
			}
			const onBoard = raycaster.intersectObject(board.field, false)[0];
			return onBoard ? worldToSquare(onBoard.point) : -1;
		};
		let downAt = null;
		canvas.addEventListener('pointermove', event => board.setHover(intents.active() ? pick(event) : -1));
		canvas.addEventListener('pointerdown', event => { downAt = { x: event.clientX, y: event.clientY }; });
		canvas.addEventListener('pointerup', event => {
			if (!downAt) return;
			// 拖拽是在转视角，不算点格子。
			const dragged = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6;
			downAt = null;
			if (dragged || !intents.active()) return;
			const sq = pick(event);
			// 3D 只有点按：按下与抬起合成一次点击。
			intents.press(sq);
			intents.release(sq, sq, false);
		});

		w = { stage, board, table, snowfall, bursts };
	}

	function syncNow(pos) {
		if (w.table.isIdle()) { w.table.sync(pos); pendingSync = null; }
		else pendingSync = clone(pos);
	}

	return {
		kind: '3d',
		get built() { return Boolean(w); },

		show(pos) {
			if (!w) build();
			visible = true;
			canvas.hidden = false;
			w.stage.start();
			w.stage.setAttract(false);
			syncNow(pos);
		},
		hide() {
			visible = false;
			canvas.hidden = true;
			w?.stage.stop();
		},

		setPosition(pos) { if (w) syncNow(pos); },

		playMove(move, after) {
			if (!w || !visible) { if (w) syncNow(after); return; }
			if (pendingSync) { pendingSync = clone(after); return; }
			w.table.playMove(move);
			// 动画落定后对一次账：桌面棋子与逻辑状态不一致立即自愈。
			const audit = () => { if (w.table.isIdle()) w.table.audit(after); else setTimeout(audit, 120); };
			setTimeout(audit, 60);
		},

		setMarks({ lastMove, selected = -1, targets = [], check = -1 } = {}) {
			if (!w) return;
			const b = w.board;
			b.clearMarks();
			if (lastMove) { b.setMark(lastMove.from, 3, 0.7); b.setMark(lastMove.to, 3, 1); }
			if (selected >= 0) b.setMark(selected, 0, 1);
			for (const t of targets) b.setMark(t.sq, t.capture ? 2 : 1, 1);
			if (check >= 0) b.setMark(check, 2, 1);
			w.table.select(selected);
		},

		setFlipped(on) {
			if (!w) return;
			if (w.stage.state.flipped !== on) w.stage.flip();
			w.board.setFlipped(on);
		},

		askPromotion: (to, color) => askPromotion(color),
		isIdle: () => !w || (w.table.isIdle() && !pendingSync),

		// 3D 专属
		setQuality(q) { w?.stage.setQuality(q); },
		setSnow(v) { w?.snowfall.setDensity(SNOW[v] ?? 1); },
		setBadges(on) { w?.table.setBadges(on); },
		moveTo(view) { w?.stage.moveTo(view); }
	};
}
