// 对局用时：停表、续表、恢复存档、时钟回拨。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/core/clock.js';

const fake = () => { let t = 1000; const now = () => t; now.tick = ms => { t += ms; }; return now; };

test('计时、停表期间不计、续表接着算', () => {
	const now = fake(), clock = createClock(now);
	clock.start();
	now.tick(5000);
	assert.equal(clock.read(), 5000);
	clock.stop();
	now.tick(60000);                 // 页面隐藏 / 终局画面
	assert.equal(clock.read(), 5000);
	clock.resume();
	now.tick(2000);
	assert.equal(clock.read(), 7000);
	clock.resume();                  // 重复续表不重置起点
	now.tick(1000);
	assert.equal(clock.read(), 8000);
});

test('恢复存档从已用时长接着算；坏值按 0 处理', () => {
	const now = fake(), clock = createClock(now);
	clock.start(125000);
	now.tick(1000);
	assert.equal(clock.read(), 126000);
	for (const bad of [undefined, null, 'x', -5000, NaN]) {
		clock.start(bad);
		assert.equal(clock.read(), 0, String(bad));
	}
});

test('时钟回拨不会得到负数', () => {
	const now = fake(), clock = createClock(now);
	clock.start(3000);
	now.tick(-8000);
	assert.equal(clock.read(), 3000);
});
