#!/usr/bin/env python3
# 合成"网页/App 截图"和"屏幕翻拍照片"，用于评测定位与端到端识别。
# 输出 <out>/NNNN.png 和 <out>/meta.json（四角真值、局面、是否翻转）。
import argparse
import json
import math
import multiprocessing as mp
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib  # noqa: E402

SCREENS = [(1280, 800), (1366, 768), (1440, 900), (1920, 1080), (2560, 1440), (750, 1334), (1080, 1920),
           (828, 1792), (1024, 768), (1600, 900), (2048, 1536)]
THEMES = [  # (页面底色, 面板色, 文字色)
    ((22, 21, 18), (38, 36, 33), (186, 186, 186)), ((49, 46, 43), (39, 37, 34), (220, 220, 220)),
    ((255, 255, 255), (246, 246, 246), (40, 40, 40)), ((236, 236, 236), (255, 255, 255), (70, 70, 70)),
    ((30, 34, 48), (42, 47, 64), (200, 205, 220)), ((250, 248, 240), (232, 228, 214), (60, 50, 40)),
]
MOVES = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 c4 c6 cxb5 axb5 Nc3 Bb7 Bg5 b4 Nb1 h6 Bh4 c5 dxe5 Nxe4 Bxe7 Qxe7 exd6 Qf6'.split()


def font(size, bold=False):
    f = vlib.LABEL_FONTS[0] if bold else vlib.LABEL_FONTS[1]
    return ImageFont.truetype(f, max(6, int(size)))


def draw_ui(rng, W, H, theme, board_box):
    bg, panel, fg = theme
    im = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(im)
    bx0, by0, bx1, by1 = board_box
    B = bx1 - bx0
    # 顶栏
    if rng.random() < 0.8:
        th = int(rng.uniform(36, 64))
        d.rectangle([0, 0, W, th], fill=panel)
        x = 16
        for w in ['lichess.org', 'Play', 'Puzzles', 'Learn', 'Watch', 'Community', 'Tools']:
            d.text((x, th * 0.3), w, font=font(th * 0.35, x == 16), fill=fg)
            x += int(len(w) * th * 0.25 + 28)
    # 侧边面板：着法列表（规则排列的文字是 X 角点检测的典型干扰）
    side_x = bx1 + int(B * 0.04) if bx1 + 260 < W else 10
    side_w = max(120, min(420, W - side_x - 10))
    if side_x + 100 < W:
        py0, py1 = by0, min(H - 4, by0 + int(B * rng.uniform(0.6, 1.0)))
        d.rounded_rectangle([side_x, py0, side_x + side_w, py1], radius=6, fill=panel)
        fs = rng.uniform(13, 22)
        y, k = py0 + 50, 0
        while y < py1 - fs * 1.5 and k + 1 < len(MOVES):
            d.text((side_x + 10, y), f'{k // 2 + 1}.', font=font(fs), fill=fg)
            d.text((side_x + 10 + fs * 2.5, y), MOVES[k], font=font(fs, True), fill=fg)
            d.text((side_x + 10 + fs * 7, y), MOVES[k + 1], font=font(fs, True), fill=fg)
            y += fs * 1.6
            k += 2
        # 玩家条与计时
        for yy, name in ((py0 + 6, 'DrNykterstein (3150)'), (py1 - 40, 'Hikaru (3200)')):
            d.text((side_x + 12, yy + 8), name, font=font(16, True), fill=fg)
            d.rounded_rectangle([side_x + side_w - 110, yy, side_x + side_w - 10, yy + 34], radius=4,
                                fill=(255, 255, 255) if rng.random() < 0.5 else (60, 60, 60))
            d.text((side_x + side_w - 95, yy + 6), '3:%02d' % rng.integers(60), font=font(20, True), fill=(128, 128, 128))
    # 评估条
    if rng.random() < 0.35 and bx0 > 30:
        ew = max(8, int(B * 0.03))
        frac = rng.uniform(0.2, 0.8)
        d.rectangle([bx0 - ew - 6, by0, bx0 - 6, by1], fill=(64, 61, 57))
        d.rectangle([bx0 - ew - 6, by0 + int(B * frac), bx0 - 6, by1], fill=(255, 255, 255))
    # 杂项按钮/图标
    for _ in range(int(rng.integers(3, 12))):
        x, y = int(rng.uniform(0, W - 80)), int(rng.uniform(0, H - 30))
        if bx0 - 90 < x < bx1 and by0 - 40 < y < by1:
            continue
        w, h = int(rng.uniform(30, 160)), int(rng.uniform(18, 40))
        col = tuple(int(c) for c in rng.uniform(0, 255, 3))
        d.rounded_rectangle([x, y, x + w, y + h], radius=int(rng.uniform(0, 10)), fill=col)
        d.text((x + 6, y + 3), 'Button', font=font(h * 0.5), fill=fg)
    return im


def make_screen(rng, sets, mini_board=True, crop=True):
    W, H = SCREENS[int(rng.integers(len(SCREENS)))]
    maxB = int(min(1600, 0.92 * min(W, H)))
    B = int(round(math.exp(rng.uniform(math.log(160), math.log(max(161, maxB))))))
    frame = int(rng.uniform(0.01, 0.05) * B) if rng.random() < 0.4 else 0
    bx0 = int(rng.uniform(frame + 2, W - B - frame - 2))
    by0 = int(rng.uniform(frame + 2, H - B - frame - 2))
    theme = THEMES[int(rng.integers(len(THEMES)))]
    im = draw_ui(rng, W, H, theme, (bx0, by0, bx0 + B, by0 + B))
    sq = vlib.realistic_position(rng)
    flipped = rng.random() < 0.5
    if flipped:
        sq = sq[::-1]
    set_name = sets[int(rng.integers(len(sets)))]
    s = int(math.ceil(B / 8))
    light, dark = vlib.pick_colors(rng, app_weight=0.3)
    opts = dict(flipped=flipped, labels=rng.random() < 0.5, highlight=rng.random() < 0.45,
                check=rng.random() < 0.12, arrows=rng.random() < 0.04, dots=rng.random() < 0.06)
    board = vlib.render_board(rng, sq, s, set_name, light, dark, opts)
    bim = Image.fromarray(board.astype(np.uint8))
    if bim.size[0] != B:
        bim = bim.resize((B, B), Image.LANCZOS if rng.random() < 0.6 else Image.BILINEAR)
    d = ImageDraw.Draw(im)
    if frame:
        fc = tuple(int(c) for c in (rng.uniform(0, 255, 3) if rng.random() < 0.5 else [rng.uniform(20, 120)] * 3))
        d.rectangle([bx0 - frame, by0 - frame, bx0 + B + frame - 1, by0 + B + frame - 1], fill=fc)
        if rng.random() < 0.5 and frame >= 8:
            col = tuple(255 - c for c in fc)
            for i in range(8):
                fl = 'abcdefgh'[::-1][i] if flipped else 'abcdefgh'[i]
                rk = '12345678'[i] if flipped else '87654321'[i]
                d.text((bx0 + (i + 0.45) * B / 8, by0 + B + 1), fl, font=font(frame * 0.8), fill=col)
                d.text((bx0 - frame + 1, by0 + (i + 0.35) * B / 8), rk, font=font(frame * 0.8), fill=col)
    elif rng.random() < 0.2 and bx0 > 20 and by0 + B + 20 < H:
        # 无框时坐标画在棋盘外侧
        for i in range(8):
            fl = 'abcdefgh'[::-1][i] if flipped else 'abcdefgh'[i]
            rk = '12345678'[i] if flipped else '87654321'[i]
            d.text((bx0 + (i + 0.45) * B / 8, by0 + B + 3), fl, font=font(14), fill=theme[2])
            d.text((bx0 - 14, by0 + (i + 0.35) * B / 8), rk, font=font(14), fill=theme[2])
    im.paste(bim, (bx0, by0))
    # 偶尔放一个小缩略棋盘（干扰项）
    if mini_board and rng.random() < 0.1:
        mb = int(rng.uniform(100, 150))
        mx, my = int(rng.uniform(0, W - mb)), int(rng.uniform(0, H - mb))
        if not (mx + mb > bx0 - frame and mx < bx0 + B + frame and my + mb > by0 - frame and my < by0 + B + frame):
            mim = vlib.render_board(rng, vlib.realistic_position(rng), int(math.ceil(mb / 8)), set_name, opts={'labels': False})
            im.paste(Image.fromarray(mim.astype(np.uint8)).resize((mb, mb)), (mx, my))
    corners = [[bx0, by0], [bx0 + B, by0], [bx0 + B, by0 + B], [bx0, by0 + B]]
    if crop and rng.random() < 0.15:
        # 用户常把截图裁到只剩棋盘（可能带一点边）
        m = int(rng.uniform(0, 0.05) * B)
        x0, y0 = max(0, bx0 - m), max(0, by0 - m)
        im = im.crop((x0, y0, min(W, bx0 + B + m), min(H, by0 + B + m)))
        corners = [[x - x0, y - y0] for x, y in corners]
    return im, corners, sq, flipped, set_name


def perspective_coeffs(src, dst):
    # PIL PERSPECTIVE 需要 dst→src 的系数
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b += [u, v]
    return np.linalg.solve(np.array(A, np.float64), np.array(b, np.float64))


def make_photo(rng, sets):
    # 屏幕翻拍：先合成截图，再做透视/旋转、摩尔纹、眩光、模糊、噪声、JPEG
    im, corners, sq, flipped, set_name = make_screen(rng, sets, mini_board=False, crop=False)
    W, H = im.size
    bx0, by0 = corners[0]
    B = corners[1][0] - bx0
    # 只拍棋盘附近区域
    pad = B * rng.uniform(0.15, 0.5)
    x0, y0 = max(0, bx0 - pad), max(0, by0 - pad)
    x1, y1 = min(W, bx0 + B + pad), min(H, by0 + B + pad)
    src = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    ow = int(rng.uniform(900, 2000))
    oh = int(ow * (y1 - y0) / (x1 - x0))
    ang = math.radians(rng.uniform(-8, 8))
    cx, cy = ow / 2, oh / 2
    dst = []
    for (u, v) in [(0, 0), (ow, 0), (ow, oh), (0, oh)]:
        u2, v2 = u + rng.uniform(-0.06, 0.06) * ow, v + rng.uniform(-0.06, 0.06) * oh
        dst.append((cx + (u2 - cx) * math.cos(ang) - (v2 - cy) * math.sin(ang),
                    cy + (u2 - cx) * math.sin(ang) + (v2 - cy) * math.cos(ang)))
    mnx, mny = min(p[0] for p in dst), min(p[1] for p in dst)
    dst = [(x - mnx + 20, y - mny + 20) for x, y in dst]
    OW, OH = int(max(p[0] for p in dst) + 20), int(max(p[1] for p in dst) + 20)
    coef = perspective_coeffs(src, dst)
    bgc = tuple(int(c) for c in rng.uniform(0, 60, 3))
    out = im.transform((OW, OH), Image.PERSPECTIVE, tuple(coef), Image.BICUBIC, fillcolor=bgc)
    # 正向映射真值角点
    Hm = np.linalg.inv(np.append(coef, 1).reshape(3, 3))
    gt = []
    for x, y in corners:
        p = Hm @ np.array([x, y, 1.0])
        gt.append([p[0] / p[2], p[1] / p[2]])
    arr = np.asarray(out, np.float32)
    # 强一些的屏摄退化
    yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float32)
    if rng.random() < 0.7:
        a1 = rng.uniform(0, math.pi)
        per = rng.uniform(4, 25)
        pat = np.sin(2 * math.pi * (xx * math.cos(a1) + yy * math.sin(a1)) / per)
        arr *= (1 + rng.uniform(0.03, 0.12) * pat)[..., None]
    if rng.random() < 0.6:
        gcx, gcy = rng.uniform(0, OW), rng.uniform(0, OH)
        sig = rng.uniform(0.15, 0.4) * max(OW, OH)
        g = np.exp(-((xx - gcx) ** 2 + (yy - gcy) ** 2) / (2 * sig * sig)) * rng.uniform(0.15, 0.45)
        arr = arr * (1 - g[..., None]) + 255 * g[..., None]
    vig = 1 - rng.uniform(0, 0.35) * (((xx - OW / 2) / OW) ** 2 + ((yy - OH / 2) / OH) ** 2) * 2
    arr *= vig[..., None]
    arr = arr * rng.uniform(0.85, 1.1, 3)[None, None]
    arr = vlib.gaussian_blur(arr, rng.uniform(0.5, 1.6))
    arr += rng.standard_normal(arr.shape).astype(np.float32) * rng.uniform(2, 8)
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    import io
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, 'JPEG', quality=int(rng.uniform(55, 90)))
    out = Image.open(buf).convert('RGB')
    return out, gt, sq, flipped, set_name


def worker(args):
    seed, idxs, out, kind, sets, jpeg_p = args
    rng = np.random.default_rng(seed)
    metas = []
    for i in idxs:
        if kind == 'photo':
            im, corners, sq, flipped, set_name = make_photo(rng, sets)
        else:
            im, corners, sq, flipped, set_name = make_screen(rng, sets)
            if rng.random() < jpeg_p:
                import io
                buf = io.BytesIO()
                im.save(buf, 'JPEG', quality=int(rng.uniform(70, 95)))
                im = Image.open(buf).convert('RGB')
        fn = f'{i:04d}.png'
        im.save(os.path.join(out, fn), optimize=False, compress_level=3)
        metas.append(dict(file=fn, corners=corners, squares=sq, flipped=flipped,
                          placement=vlib.placement_of(sq[::-1] if flipped else sq), set=set_name,
                          size=list(im.size)))
    return metas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--n', type=int, default=200)
    ap.add_argument('--kind', default='screen', choices=['screen', 'photo'])
    ap.add_argument('--sets', default='all', help='all | holdout | app | train | 逗号分隔的套装名')
    ap.add_argument('--jpeg', type=float, default=0.2)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    glyphs = vlib.glyph_set_names()
    if a.sets == 'all':
        sets = vlib.SVG_SETS + glyphs[::3]
    elif a.sets == 'holdout':
        sets = vlib.HOLDOUT
    elif a.sets == 'app':
        sets = vlib.APP_SETS
    elif a.sets == 'train':
        sets = [s for s in vlib.SVG_SETS if s not in vlib.HOLDOUT] + glyphs[::3]
    else:
        sets = a.sets.split(',')
    os.makedirs(a.out, exist_ok=True)
    chunks = [list(range(i, min(a.n, i + 10))) for i in range(0, a.n, 10)]
    jobs = [(a.seed * 7919 + k, c, a.out, a.kind, sets, a.jpeg) for k, c in enumerate(chunks)]
    with mp.Pool(a.workers) as pool:
        metas = sum(pool.map(worker, jobs), [])
    with open(os.path.join(a.out, 'meta.json'), 'w') as f:
        json.dump(metas, f)
    print('wrote', len(metas), 'images to', a.out)


if __name__ == '__main__':
    main()
