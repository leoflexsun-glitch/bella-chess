#!/usr/bin/env python3
# 生成格子分类数据集：渲染整盘 → 图像级增强 → 用"不准的角点"按 warp.js 的方式采样 64 格。
# 输出 .npz：tiles (N,32,32) uint8 原始灰度、labels (N,)、stats (N,2) 整盘均值/标准差（归一化用）。
import argparse
import math
import multiprocessing as mp
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib  # noqa: E402

T = 32
SHAPE_AUG = float(os.environ.get('SHAPE_AUG', '0.5'))  # 棋子造型增强的概率（模拟未见过的套装）
UI_BG = [(255, 255, 255), (246, 246, 246), (38, 36, 33), (49, 46, 43), (22, 21, 18), (240, 240, 240),
         (200, 200, 200), (70, 70, 70), (230, 225, 215)]


def set_pool(kind):
    glyphs = vlib.glyph_set_names()
    if kind == 'train':        # 泛化实验：留出 merida + pirouetti
        svg = [s for s in vlib.SVG_SETS if s not in vlib.HOLDOUT]
    elif kind == 'all':
        svg = list(vlib.SVG_SETS)
    elif kind == 'holdout':
        return vlib.HOLDOUT, np.ones(len(vlib.HOLDOUT)) / len(vlib.HOLDOUT)
    elif kind == 'app':
        return vlib.APP_SETS, np.ones(3) / 3
    else:
        raise ValueError(kind)
    names = svg + glyphs
    # app 实际显示的三套权重加倍；Unicode 字形总权重约等于 3 套 SVG
    w = np.array([2.0 if s in vlib.APP_SETS else 1.0 for s in svg] + [3.0 / len(glyphs)] * len(glyphs))
    return names, w / w.sum()


def embed(rng, board, s, clean):
    """把棋盘放进带边距的画布（模拟边框/网页背景），返回画布和棋盘四角。"""
    n = board.shape[0]
    m = int(math.ceil(s * 1.0))
    bg = np.array(UI_BG[int(rng.integers(len(UI_BG)))] if rng.random() < 0.7 else rng.uniform(0, 255, 3), np.float32)
    canvas = np.zeros((n + 2 * m, n + 2 * m, 3), np.float32) + bg
    if not clean and rng.random() < 0.5:
        # 边框：木色/深色细框，宽 2%–40% 格
        fw = max(1, int(s * rng.uniform(0.02, 0.4)))
        fc = np.array(rng.uniform(0, 255, 3) if rng.random() < 0.5 else [rng.uniform(20, 120)] * 3, np.float32)
        canvas[m - fw:m + n + fw, m - fw:m + n + fw] = fc
        if rng.random() < 0.4 and fw > s * 0.2:
            # 框外坐标
            im = Image.fromarray(canvas.astype(np.uint8))
            d = ImageDraw.Draw(im)
            font = ImageFont.truetype(vlib.LABEL_FONTS[0], max(6, int(fw * 0.8)))
            col = tuple(int(v) for v in (255 - fc))
            for i in range(8):
                d.text((m + i * s + s // 2 - fw // 4, m + n + 1), 'abcdefgh'[i], font=font, fill=col)
                d.text((m - fw + 1, m + i * s + s // 2 - fw // 2), '87654321'[i], font=font, fill=col)
            canvas = np.asarray(im, np.float32).copy()
    canvas[m:m + n, m:m + n] = board
    c = [[m, m], [m + n, m], [m + n, m + n], [m, m + n]]
    return canvas, c


def make_board(rng, sets, weights, positions, aug, app_theme=None):
    if positions == 'realistic' or (positions == 'mix' and rng.random() < 0.3):
        sq = vlib.realistic_position(rng)
        flipped = rng.random() < 0.5
        if flipped:
            sq = sq[::-1]
    else:
        sq = vlib.random_position(rng)
        flipped = rng.random() < 0.5
    set_name = sets[rng.choice(len(sets), p=weights)]
    s = int(round(math.exp(rng.uniform(math.log(20), math.log(120)))))
    clean = aug == 'clean'
    if app_theme is not None:
        light, dark = vlib.APP_THEMES[app_theme]
    else:
        light, dark = vlib.pick_colors(rng)
    opts = {'flipped': flipped, 'shape_aug': SHAPE_AUG if aug == 'full' else 0.0}
    if clean:
        opts.update(highlight=False, texture='flat', check=False, dots=False, labels=False, arrows=False,
                    piece_scale=1.0, shadow=False, piece_jitter=False)
    elif aug == 'decor':  # app 样式 + 坐标/高亮/将军等装饰，但不做图像退化
        opts.update(texture='flat', piece_scale=1.0, piece_jitter=False, shadow=False, arrows=False)
    board = vlib.render_board(rng, sq, s, set_name, light, dark, opts)
    canvas, corners = embed(rng, board, s, clean or aug == 'decor')
    if aug == 'full':
        # 浏览器缩放：整体缩小到非整数格宽
        if rng.random() < 0.5:
            f = rng.uniform(0.6, 1.0)
            h, w = canvas.shape[:2]
            nh, nw = max(8, int(round(h * f))), max(8, int(round(w * f)))
            canvas = np.asarray(Image.fromarray(canvas.astype(np.uint8)).resize((nw, nh), Image.BILINEAR if rng.random() < 0.5 else Image.LANCZOS), np.float32)
            corners = [[x * nw / w, y * nh / h] for x, y in corners]
            s = s * nw / w
        canvas = vlib.photometric(rng, canvas, 1.0)
    gray = vlib.to_gray(canvas)
    if aug == 'full':
        u = rng.random()
        mag = 0.02 if u < 0.45 else (0.07 if u < 0.85 else 0.14)
        corners = vlib.jitter_corners(rng, corners, s, mag)
        if rng.random() < 0.3:
            d = rng.uniform(-0.06, 0.06, 2) * s
            corners = [[x + d[0], y + d[1]] for x, y in corners]
        tiles = vlib.sample_tiles(gray, corners, T, rng, jitter=0.06 if rng.random() < 0.5 else 0.0)
    else:
        tiles = vlib.sample_tiles(gray, corners, T)
    mean, std = vlib.normalize_stats(tiles)
    labels = np.array([vlib.CLS_INDEX[v] for v in sq], np.uint8)
    return np.clip(np.round(tiles), 0, 255).astype(np.uint8), labels, (mean, std), set_name


def worker(args):
    seed, count, set_kind, positions, aug, app_theme = args
    rng = np.random.default_rng(seed)
    sets, weights = set_pool(set_kind)
    tiles, labels, stats, names = [], [], [], []
    for i in range(count):
        th = (i % 3) if app_theme == 'cycle' else None
        t, l, st, nm = make_board(rng, sets, weights, positions, aug, th)
        tiles.append(t)
        labels.append(l)
        stats.append(np.tile(np.array(st, np.float32), (64, 1)))
        names.append(nm)
    return np.concatenate(tiles), np.concatenate(labels), np.concatenate(stats), names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--boards', type=int, default=1000)
    ap.add_argument('--sets', default='train', choices=['train', 'all', 'holdout', 'app'])
    ap.add_argument('--positions', default='mix', choices=['mix', 'random', 'realistic'])
    ap.add_argument('--aug', default='full', choices=['full', 'clean', 'decor'])
    ap.add_argument('--app-themes', action='store_true', help='按 3 个 app 主题轮换配色')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    t0 = time.time()
    chunk = 50
    jobs = []
    left, k = a.boards, 0
    while left > 0:
        c = min(chunk, left)
        jobs.append((a.seed * 100003 + k, c, a.sets, a.positions, a.aug, 'cycle' if a.app_themes else None))
        left -= c
        k += 1
    with mp.Pool(a.workers) as pool:
        res = pool.map(worker, jobs)
    tiles = np.concatenate([r[0] for r in res])
    labels = np.concatenate([r[1] for r in res])
    stats = np.concatenate([r[2] for r in res])
    names = sum((r[3] for r in res), [])
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    np.savez(a.out, tiles=tiles, labels=labels, stats=stats, sets=np.array(names))
    print(f'{a.out}: {len(tiles)} tiles from {a.boards} boards in {time.time() - t0:.0f}s',
          'class counts', np.bincount(labels, minlength=13).tolist())


if __name__ == '__main__':
    main()
