// 界面外壳：玩家栏、状态、局势、棋谱、结算、提示条、弹窗、设置控件。
// 只管把数据画到 DOM、把点击翻译成动作；不懂棋规则。

import { WHITE } from '../chess/engine.js';

const LETTER = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
const $ = (name, root = document) => root.querySelector(`[data-slot="${name}"]`);
const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createShell({ onAction, onSetting, onMoveClick }) {
	const toastBox = $('toast');
	const movesList = $('moves');
	let toastTimer = 0;

	// 所有 data-act 按钮（顶栏、侧栏、弹窗里）统一派发。
	document.addEventListener('click', event => {
		const button = event.target.closest('[data-act]');
		if (button && !button.disabled) { onAction(button.dataset.act, button); return; }
		const seg = event.target.closest('[data-setting] [data-value]');
		if (seg) onSetting(seg.parentElement.dataset.setting, seg.dataset.value);
	});

	movesList.addEventListener('click', event => {
		const button = event.target.closest('[data-ply]');
		if (button) onMoveClick(Number(button.dataset.ply));
	});

	function paintPlayer(slot, p) {
		const el = $(slot);
		el.querySelector('.avatar').className = `avatar pc ${p.color === WHITE ? 'wK' : 'bK'}`;
		el.querySelector('.pname').textContent = p.name;
		el.querySelector('.psub').textContent = p.sub;
		// 多出的子力用对方颜色画（即吃掉的对方棋子），与常见棋站一致。
		const prefix = p.color === WHITE ? 'b' : 'w';
		el.querySelector('.captures').innerHTML =
			p.extra.map(t => `<i class="pc ${prefix}${LETTER[t]}"></i>`).join('') + (p.score > 0 ? `<b>+${p.score}</b>` : '');
		el.classList.toggle('thinking', Boolean(p.thinking));
		el.classList.toggle('turn', Boolean(p.turn));
	}

	return {
		setPlayers(top, bottom) { paintPlayer('player-top', top); paintPlayer('player-bottom', bottom); },

		setStatus(text, { check = false } = {}) {
			const el = $('status');
			el.textContent = text;
			el.classList.toggle('check', check);
		},

		// pawns：白方视角的兵值分；超过 900 是搜索给出的将杀分。
		// final：终局比分（PGN 记法 '1-0' / '0-1' / '1/2-1/2'），给出时不再显示引擎分。
		setEval(pawns, final = null) {
			if (final) pawns = final === '1-0' ? 8 : final === '0-1' ? -8 : 0;
			const mate = Math.abs(pawns) > 900;
			const clamped = Math.max(-8, Math.min(8, pawns));
			$('eval-fill').style.width = `${50 + (clamped / 8) * 46}%`;
			$('eval-text').textContent = final ? `终局 ${final === '1/2-1/2' ? '½-½' : final}`
				: mate ? `${pawns > 0 ? '白' : '黑'}方将杀在望`
				: Math.abs(clamped) < 0.35 ? '均势'
					: `${clamped > 0 ? '白' : '黑'} +${Math.abs(pawns).toFixed(1)}`;
		},

		// history：对局记录；current：高亮的半步序号（-1 表示起始局面）。
		setMoves(history, current) {
			$('moves-empty').hidden = history.length > 0;
			const rows = [];
			let row = null;
			history.forEach((h, i) => {
				if (h.mover === WHITE || !row) {
					row = { no: h.no, cells: ['', ''] };
					rows.push(row);
				}
				row.cells[h.mover === WHITE ? 0 : 1] = `<button data-ply="${i}" class="${i === current ? 'cur' : ''}">${escapeHtml(h.san)}</button>`;
			});
			movesList.innerHTML = rows.map(r =>
				`<li><span class="n">${r.no}.</span>${r.cells[0] || '<span class="n">…</span>'}${r.cells[1]}</li>`).join('');
			const cur = movesList.querySelector('.cur');
			if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			else movesList.scrollTop = movesList.scrollHeight;
		},

		setReview(text) {
			$('review').hidden = !text;
			if (text) $('review-text').textContent = text;
		},

		setResult(result) {
			$('result').hidden = !result;
			if (!result) return;
			$('result-title').textContent = result.title;
			$('result-sub').textContent = result.sub;
			$('result-stats').textContent = result.stats || '';
		},

		toast(text, ms = 2400) {
			toastBox.textContent = text;
			toastBox.classList.add('on');
			clearTimeout(toastTimer);
			toastTimer = setTimeout(() => toastBox.classList.remove('on'), ms);
		},

		setControl(act, { on, disabled } = {}) {
			for (const el of document.querySelectorAll(`.controls [data-act="${act}"]`)) {
				if (on !== undefined) el.classList.toggle('on', on);
				if (disabled !== undefined) el.disabled = disabled;
			}
		},

		// 把设置值画到所有分段控件上（新对局、设置、摆棋里可能同时存在同一项）。
		paintSettings(settings) {
			for (const seg of document.querySelectorAll('[data-setting]')) {
				const value = settings[seg.dataset.setting];
				for (const b of seg.querySelectorAll('[data-value]')) b.classList.toggle('on', b.dataset.value === value);
			}
		},

		open(id) {
			const d = document.getElementById(id);
			if (!d.open) d.showModal();
		},
		close(id) {
			const d = document.getElementById(id);
			if (d.open) d.close();
		},
		anyDialogOpen: () => Boolean(document.querySelector('dialog[open]')),

		// 3D 视图的升变选择（2D 在棋盘上直接选）。
		askPromotion(color) {
			const dialog = document.getElementById('dlg-promo');
			const row = $('promo-row');
			const prefix = color === WHITE ? 'w' : 'b';
			row.innerHTML = [[5, 'Q', '后'], [2, 'N', '马'], [4, 'R', '车'], [3, 'B', '象']].map(([type, l, name]) =>
				`<button value="${type}" aria-label="${name}"><i class="pc ${prefix}${l}"></i></button>`).join('');
			dialog.returnValue = '';
			dialog.showModal();
			return new Promise(resolve => {
				dialog.addEventListener('close', () => resolve(Number(dialog.returnValue) || null), { once: true });
			});
		}
	};
}
