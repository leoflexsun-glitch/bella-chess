// 拍照复刻：取图（拍照/选图/粘贴/拖入）→ 自动定位棋盘 → 手动微调四角 → 本机识别 → 交给摆棋编辑器核对。
// 识别器由调用方注入（src/vision），这里只管交互。图片不离开本机。

const MAX_SIDE = 1600;          // 大照片先缩到这个尺寸再处理，又快又够清楚
const LOW_CONFIDENCE = 0.8;     // 低于它的格子在编辑器里标橙，提醒核对
const $ = (name, root) => root.querySelector(`[data-slot="${name}"]`);

export function createPhoto({ recognizer, onResult, toast }) {
	const root = document.getElementById('photo');
	const pick = $('photo-pick', root);
	const adjust = $('photo-adjust', root);
	const canvas = $('photo-canvas', root);
	const quadSvg = $('photo-quad', root);
	const statusEl = $('photo-status', root);
	const drop = root.querySelector('.drop');

	let open = false;
	let image = null;         // ImageData
	let corners = null;       // [[x,y] × 4]：左上、右上、右下、左下
	let orient = 'auto';
	let dragging = -1;

	// ── 取图 ───────────────────────────────────────────────

	async function loadBlob(blob) {
		if (!blob || !blob.type.startsWith('image/')) { toast('这不是图片'); return; }
		try {
			const bitmap = await (window.createImageBitmap ? createImageBitmap(blob) : blobToImage(blob));
			const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
			const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			ctx.drawImage(bitmap, 0, 0, w, h);
			image = ctx.getImageData(0, 0, w, h);
			bitmap.close?.();
			pick.hidden = true;
			adjust.hidden = false;
			detect();
		} catch {
			toast('图片读取失败，换一张试试');
		}
	}

	function blobToImage(blob) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
			img.onerror = reject;
			img.src = URL.createObjectURL(blob);
		});
	}

	for (const input of root.querySelectorAll('[data-ph="file"]')) {
		input.addEventListener('change', () => { loadBlob(input.files?.[0]); input.value = ''; });
	}
	document.addEventListener('paste', event => {
		if (!open) return;
		const item = [...(event.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
		if (item) { event.preventDefault(); loadBlob(item.getAsFile()); }
	});
	drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('over'); });
	drop.addEventListener('dragleave', () => drop.classList.remove('over'));
	drop.addEventListener('drop', event => {
		event.preventDefault();
		drop.classList.remove('over');
		loadBlob(event.dataTransfer?.files?.[0]);
	});

	// ── 定位与四角微调 ──────────────────────────────────────

	function detect() {
		statusEl.textContent = '正在寻找棋盘…';
		paintQuad(null);
		// 让状态先画出来再跑定位。
		setTimeout(() => {
			let found = null;
			try { found = recognizer.locateBoard(image); } catch { found = null; }
			if (found) {
				corners = found.corners.map(([x, y]) => [x, y]);
				// 定位得分低（多见于翻拍照片）就明确请用户核对四角。
				statusEl.textContent = found.score >= 0.5 ? '找到棋盘了，核对一下网格' : '大致找到了棋盘，请拖动四角对准';
			} else {
				const s = Math.min(image.width, image.height) * 0.8;
				const x = (image.width - s) / 2, y = (image.height - s) / 2;
				corners = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
				statusEl.textContent = '没找到棋盘，请手动拖动四个角';
			}
			paintQuad(corners);
		}, 30);
	}

	// 四角之间按双线性插值画 8×8 网格（视觉参考，识别时用真正的透视变换）。
	const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
	function paintQuad(q) {
		if (!q) { quadSvg.innerHTML = ''; return; }
		quadSvg.setAttribute('viewBox', `0 0 ${image.width} ${image.height}`);
		const [tl, tr, br, bl] = q;
		let grid = '';
		for (let i = 1; i < 8; i++) {
			const t = i / 8;
			const a = lerp(tl, bl, t), b = lerp(tr, br, t);
			const c = lerp(tl, tr, t), d = lerp(bl, br, t);
			grid += `M${a}L${b}M${c}L${d}`;
		}
		const r = Math.max(9, Math.min(image.width, image.height) * 0.022);
		quadSvg.innerHTML =
			`<polygon class="edge" points="${q.map(p => p.join(',')).join(' ')}" style="stroke-width:${r / 3}"/>` +
			`<path class="grid-under" d="${grid}" style="stroke-width:${r / 3}"/>` +
			`<path class="grid" d="${grid}" style="stroke-width:${r / 6}"/>` +
			q.map((p, i) => `<circle class="handle" data-corner="${i}" cx="${p[0]}" cy="${p[1]}" r="${r}" style="stroke-width:${r / 3}"/>`).join('');
	}

	function toImage(event) {
		const rect = canvas.getBoundingClientRect();
		return [
			Math.max(0, Math.min(image.width, (event.clientX - rect.left) / rect.width * image.width)),
			Math.max(0, Math.min(image.height, (event.clientY - rect.top) / rect.height * image.height))
		];
	}

	quadSvg.addEventListener('pointerdown', event => {
		if (!corners) return;
		const handle = event.target.closest('[data-corner]');
		// 没点中把手就选最近的角，手指粗也好用。
		const p = toImage(event);
		dragging = handle ? Number(handle.dataset.corner)
			: corners.reduce((best, c, i) => Math.hypot(c[0] - p[0], c[1] - p[1]) < Math.hypot(corners[best][0] - p[0], corners[best][1] - p[1]) ? i : best, 0);
		quadSvg.setPointerCapture(event.pointerId);
		corners[dragging] = p;
		paintQuad(corners);
		event.preventDefault();
	});
	quadSvg.addEventListener('pointermove', event => {
		if (dragging < 0) return;
		corners[dragging] = toImage(event);
		paintQuad(corners);
	});
	const stop = () => { dragging = -1; };
	quadSvg.addEventListener('pointerup', stop);
	quadSvg.addEventListener('pointercancel', stop);

	// ── 识别 ───────────────────────────────────────────────

	function read() {
		statusEl.textContent = '正在识别…';
		setTimeout(() => {
			try {
				const { squares, confidence } = recognizer.readBoard(image, corners);
				const flipped = orient === 'auto' ? recognizer.guessFlipped(squares) : orient === 'b';
				const placement = recognizer.toPlacement(squares, flipped);
				// 显示序号（左上起逐行）→ 0x88 格号；翻转时整盘旋转 180°。
				const warn = [];
				confidence.forEach((c, i) => {
					if (c >= LOW_CONFIDENCE) return;
					const row = i >> 3, col = i & 7;
					warn.push(flipped ? (7 - row) * 16 + (7 - col) : row * 16 + col);
				});
				close();
				onResult({ placement, flipped, warn });
			} catch {
				statusEl.textContent = '识别失败：请检查四个角是否对准棋盘';
			}
		}, 30);
	}

	root.addEventListener('click', event => {
		const seg = event.target.closest('[data-ph-set] [data-value]');
		if (seg) { orient = seg.dataset.value; paintOrient(); return; }
		const action = event.target.closest('[data-ph]')?.dataset.ph;
		if (action === 'close') close();
		else if (action === 'redetect') detect();
		else if (action === 'again') reset();
		else if (action === 'read') read();
	});

	function paintOrient() {
		for (const b of root.querySelectorAll('[data-ph-set="orient"] [data-value]')) b.classList.toggle('on', b.dataset.value === orient);
	}

	function reset() {
		image = null;
		corners = null;
		pick.hidden = false;
		adjust.hidden = true;
		quadSvg.innerHTML = '';
	}

	function close() {
		open = false;
		root.hidden = true;
	}

	addEventListener('keydown', event => {
		if (open && event.key === 'Escape') close();
	});

	return {
		get isOpen() { return open; },
		open() {
			if (!recognizer) { toast('拍照识别正在准备中'); return; }
			open = true;
			root.hidden = false;
			orient = 'auto';
			paintOrient();
			reset();
		}
	};
}
