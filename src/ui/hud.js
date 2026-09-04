const $ = name => document.querySelector(`[data-slot="${name}"]`);

const clockText = ms => {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const m = Math.floor(total / 60), s = total % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
};

export function createHud({ onTool, onPromotion }) {
	const root = document.getElementById('hud');
	const turn = document.querySelector('.hud-turn');
	const ledger = $('ledger');
	const ledgerBox = document.querySelector('.hud-ledger');
	const hint = $('hint');
	const toastBox = $('toast');
	const promo = $('promo');
	const evalFill = $('eval-fill');

	let toastTimer = 0;
	let hintTimer = setTimeout(() => hint.classList.add('gone'), 9000);
	let awaiting = null;

	root.addEventListener('click', event => {
		const tool = event.target.closest('[data-tool]');
		if (tool) { onTool(tool.dataset.tool); tool.blur(); }
	});

	promo.addEventListener('click', event => {
		const button = event.target.closest('[data-piece]');
		if (!button || !awaiting) return;
		const choose = awaiting;
		awaiting = null;
		promo.hidden = true;
		choose(Number(button.dataset.piece));
	});

	return {
		show() { root.hidden = false; },
		hide() { root.hidden = true; },

		setTurn(color, { thinking = false, check = false } = {}) {
			const dot = $('turn-dot');
			dot.dataset.c = color === 'w' ? 'w' : 'b';
			const who = color === 'w' ? '象牙' : '黑曜';
			$('turn-text').textContent = thinking ? `${who}思考中` : check ? `${who}被将军` : `${who}行棋`;
			turn.classList.toggle('think', thinking);
			document.querySelectorAll('.hud-clocks .side').forEach(el => {
				el.classList.toggle('act', el.dataset.side === color);
			});
		},

		setClocks(white, black) {
			$('clock-w').textContent = clockText(white);
			$('clock-b').textContent = clockText(black);
			document.querySelector('.side[data-side="w"]').classList.toggle('low', white < 30000);
			document.querySelector('.side[data-side="b"]').classList.toggle('low', black < 30000);
		},

		setMaterial(white, black) {
			$('mat-w').textContent = white > 0 ? `+${white}` : '';
			$('mat-b').textContent = black > 0 ? `+${black}` : '';
		},

		setEval(pawns) {
			const clamped = Math.max(-8, Math.min(8, pawns));
			evalFill.style.width = `${50 + (clamped / 8) * 46}%`;
			const text = Math.abs(clamped) < 0.35 ? '均势'
				: `${clamped > 0 ? '象牙' : '黑曜'} +${Math.abs(pawns).toFixed(1)}`;
			$('eval-text').textContent = text;
		},

		setLedger(history) {
			ledgerBox.classList.toggle('has', history.length > 0);
			const rows = [];
			for (let i = 0; i < history.length; i += 2) {
				const last = i + 1 >= history.length - 1;
				rows.push(`<li><span class="n">${i / 2 + 1}</span>` +
					`<b class="${last && history.length % 2 === 1 ? 'last' : ''}">${history[i].san}</b>` +
					`<b class="${last && history.length % 2 === 0 ? 'last' : ''}">${history[i + 1]?.san ?? ''}</b></li>`);
			}
			ledger.innerHTML = rows.join('');
			ledger.scrollTop = ledger.scrollHeight;
		},

		toast(text, ms = 2600) {
			toastBox.textContent = text;
			toastBox.classList.add('on');
			clearTimeout(toastTimer);
			toastTimer = setTimeout(() => toastBox.classList.remove('on'), ms);
		},

		setHint(text) {
			hint.textContent = text;
			hint.classList.remove('gone');
			clearTimeout(hintTimer);
			hintTimer = setTimeout(() => hint.classList.add('gone'), 9000);
		},

		askPromotion(choose) {
			awaiting = choose;
			promo.hidden = false;
		},

		cancelPromotion() { awaiting = null; promo.hidden = true; },
		get promoting() { return Boolean(awaiting); },

		setTool(name, on) {
			document.querySelector(`[data-tool="${name}"]`)?.classList.toggle('on', on);
		}
	};
}
