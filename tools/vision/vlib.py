# 训练/评测共用的工具：棋子素材、棋盘渲染、增强、与 src/vision/warp.js 逐行对应的重采样。
import io
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
SPRITES = os.path.join(CACHE, 'sprites')

CLASSES = ['', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k']
CLS_INDEX = {c: i for i, c in enumerate(CLASSES)}
PIECE_FILE = {c: ('w' if c.isupper() else 'b') + c.upper() for c in CLASSES[1:]}

SVG_SETS = ['cburnett', 'merida', 'chessnut', 'celtic', 'fantasy', 'spatial',
            'papercut', 'rhosgfx', 'totoy', 'mpchess', 'pirouetti', 'pixel']
HOLDOUT = ['merida', 'pirouetti']
APP_SETS = ['celtic', 'chessnut', 'fantasy']
APP_THEMES = [((0xee, 0xee, 0xd2), (0x76, 0x96, 0x56)),
              ((0xf0, 0xd9, 0xb5), (0xb5, 0x88, 0x63)),
              ((0xde, 0xe3, 0xe6), (0x8c, 0xa2, 0xad))]

# 常见网站/书籍配色（light, dark）
KNOWN_THEMES = [
    ('#f0d9b5', '#b58863'), ('#dee3e6', '#8ca2ad'), ('#ffffdd', '#86a666'), ('#9f90b0', '#7d4a8d'),
    ('#ececec', '#c1c18e'), ('#f1f1c9', '#f07272'), ('#97b2c7', '#546f82'), ('#d9e0e6', '#315991'),
    ('#d7daeb', '#547388'), ('#b8b8b8', '#7d7d7d'), ('#c9c9c9', '#727272'), ('#b8b19f', '#6d6655'),
    ('#eeeed2', '#769656'), ('#edd6b0', '#b88762'), ('#c5d5dc', '#7a9db2'), ('#ebecd0', '#739552'),
    ('#dcdcdc', '#abaaab'), ('#e8e9b7', '#ed7272'), ('#e1d9c1', '#9a7b5a'), ('#f0f1f0', '#c4d8e4'),
    ('#ffffff', '#cccccc'), ('#ffffff', '#a0a0a0'), ('#e8e8e8', '#8f8f8f'), ('#fce4b2', '#d08b18'),
    ('#cdd26a', '#aaa23a'), ('#e9edcc', '#779954'), ('#a3a3a3', '#5e5e5e'), ('#f3e4cf', '#cea883'),
]

# 系统里带 U+2654–265F 的字体，用来模拟书籍/网页的 Unicode 棋图
GLYPH_FONTS = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSerif.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeMono.ttf',
    '/usr/share/fonts/opentype/unifont/unifont.otf',
]
GLYPH_STYLES = ['outline', 'filled', 'solid']
LABEL_FONTS = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSerif.ttf',
]

WHITE_GLYPH = {'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙'}
BLACK_GLYPH = {'K': '♚', 'Q': '♛', 'R': '♜', 'B': '♝', 'N': '♞', 'P': '♟'}


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def glyph_set_names():
    return [f'glyph:{os.path.basename(f)}:{st}' for f in GLYPH_FONTS if os.path.exists(f) for st in GLYPH_STYLES]


# ---------------------------------------------------------------- 素材

_sprite_cache = {}


def _premul(img):
    a = np.asarray(img, dtype=np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]
    return a  # 预乘 alpha，缩放时边缘不会出现黑/白边


def _fill_interior(ink):
    # 从边界泛洪找"外部"，剩下既非墨迹也非外部的就是空心棋子的内部（PIL 的 C 实现泛洪）
    h, w = ink.shape
    m = np.zeros((h + 2, w + 2), np.uint8)
    m[1:-1, 1:-1] = np.where(ink >= 0.5, 255, 0)
    im = Image.fromarray(m, 'L').copy()  # fromarray 的图与 numpy 共享只读内存，泛洪会静默失效
    ImageDraw.floodfill(im, (0, 0), 128, thresh=0)
    a = np.array(im)[1:-1, 1:-1]
    return a == 0


def _glyph_sprites(font_path, style, size=256):
    # king 字形占 ~86% 方格，其它棋子沿用同一字号（与真实排版一致：兵比王小）
    probe = ImageFont.truetype(font_path, 200)
    kb = probe.getbbox(BLACK_GLYPH['K'])
    fs = max(8, int(200 * 0.86 * size / max(kb[2] - kb[0], kb[3] - kb[1])))
    font = ImageFont.truetype(font_path, fs)
    out = {}
    for c in CLASSES[1:]:
        white = c.isupper()
        if style == 'solid':
            ch = BLACK_GLYPH[c.upper()]
        else:
            ch = (WHITE_GLYPH if white else BLACK_GLYPH)[c.upper()]
        stroke = max(1, size // 40) if style == 'solid' else 0
        bb = font.getbbox(ch, stroke_width=stroke)
        ox = size / 2 - (bb[0] + bb[2]) / 2
        oy = size / 2 - (bb[1] + bb[3]) / 2
        if style == 'solid':
            im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            fill = (255, 255, 255, 255) if white else (0, 0, 0, 255)
            d.text((ox, oy), ch, font=font, fill=fill, stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
        else:
            m = Image.new('L', (size, size), 0)
            ImageDraw.Draw(m).text((ox, oy), ch, font=font, fill=255)
            ink = np.asarray(m, dtype=np.float32) / 255.0
            rgba = np.zeros((size, size, 4), np.float32)
            rgba[..., 3] = ink
            if style == 'filled':
                interior = _fill_interior(ink)
                rgba[interior] = (255, 255, 255, 1.0)
            rgba[..., 3] *= 255
            im = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA')
        out[c] = im
    return out


def load_set(name):
    if name in _sprite_cache:
        return _sprite_cache[name]
    if name.startswith('glyph:'):
        _, fname, style = name.split(':')
        path = next(f for f in GLYPH_FONTS if os.path.basename(f) == fname)
        imgs = _glyph_sprites(path, style)
    else:
        imgs = {c: Image.open(os.path.join(SPRITES, name, PIECE_FILE[c] + '.png')).convert('RGBA')
                for c in CLASSES[1:]}
    _sprite_cache[name] = imgs
    return imgs


def sprite_at(name, c, px, py=None):
    # 预乘后的 py×px float32 RGBA（0..1）
    py = px if py is None else py
    key = (name, c, px, py)
    if key in _sprite_cache:
        return _sprite_cache[key]
    pk = (name, c, 'pm')
    if pk not in _sprite_cache:
        _sprite_cache[pk] = _premul(load_set(name)[c])
    pm = _sprite_cache[pk]
    chans = [Image.fromarray(pm[..., i]).resize((px, py), Image.LANCZOS if max(px, py) < 128 else Image.BICUBIC)
             for i in range(4)]
    arr = np.clip(np.stack([np.asarray(ch) for ch in chans], -1), 0, 1).astype(np.float32)
    # LANCZOS 过冲会让预乘 RGB 超过 alpha，合成时溢出
    arr[..., :3] = np.minimum(arr[..., :3], arr[..., 3:4])
    if len(_sprite_cache) > 6000:  # 只清缩放结果，保留原始素材
        for kk in [kk for kk in _sprite_cache if isinstance(kk, tuple) and len(kk) == 4]:
            del _sprite_cache[kk]
    _sprite_cache[key] = arr
    return arr


# ---------------------------------------------------------------- 局面

def random_position(rng, empty_p=None):
    # 训练用的均衡随机局面：每格独立抽样，棋子类别近似均匀（王略少）
    if empty_p is None:
        empty_p = rng.uniform(0.15, 0.6)
    w = np.array([1, 1, 1, 1, 1, 0.6] * 2, np.float64)
    w /= w.sum()
    sq = []
    for i in range(64):
        if rng.random() < empty_p:
            sq.append('')
        else:
            sq.append(CLASSES[1 + rng.choice(12, p=w)])
    return sq


def realistic_position(rng, max_plies=140):
    # 随机对局（偏好吃子）得到的真实感局面；返回显示顺序的 64 格（白方在下）
    import chess
    b = chess.Board()
    n = int(rng.integers(0, max_plies))
    for _ in range(n):
        moves = list(b.legal_moves)
        if not moves:
            break
        caps = [m for m in moves if b.is_capture(m)]
        pool = caps if caps and rng.random() < 0.45 else moves
        b.push(pool[int(rng.integers(len(pool)))])
    sq = []
    for r in range(8):
        for f in range(8):
            p = b.piece_at(chess.square(f, 7 - r))
            sq.append(p.symbol() if p else '')
    return sq


def placement_of(sq):
    rows = []
    for r in range(8):
        s, e = '', 0
        for c in range(8):
            v = sq[r * 8 + c]
            if v:
                if e:
                    s += str(e)
                    e = 0
                s += v
            else:
                e += 1
        rows.append(s + (str(e) if e else ''))
    return '/'.join(rows)


# ---------------------------------------------------------------- 渲染

def pick_colors(rng, app_weight=0.25):
    u = rng.random()
    if u < app_weight:
        l, d = APP_THEMES[int(rng.integers(3))]
        return np.array(l, np.float32), np.array(d, np.float32)
    if u < app_weight + 0.4:
        l, d = KNOWN_THEMES[int(rng.integers(len(KNOWN_THEMES)))]
        return np.array(hex_rgb(l), np.float32), np.array(hex_rgb(d), np.float32)
    # 随机配色：亮格亮度 0.55–1，暗格比亮格暗 0.07–0.55（包括低对比度）
    import colorsys
    h = rng.random()
    s1 = rng.uniform(0, 0.45) ** 1.5
    v1 = rng.uniform(0.6, 1.0)
    dv = rng.uniform(0.07, 0.55)
    h2 = (h + rng.normal(0, 0.08)) % 1 if rng.random() < 0.7 else rng.random()
    s2 = min(1, s1 + rng.uniform(0, 0.5))
    v2 = max(0.05, v1 - dv)
    l = np.array(colorsys.hsv_to_rgb(h, s1, v1), np.float32) * 255
    d = np.array(colorsys.hsv_to_rgb(h2, s2, v2), np.float32) * 255
    return l, d


def smooth_noise(rng, h, w, scale):
    gh, gw = max(2, int(h / scale) + 2), max(2, int(w / scale) + 2)
    g = rng.standard_normal((gh, gw)).astype(np.float32)
    im = Image.fromarray(g).resize((w, h), Image.BICUBIC)
    return np.asarray(im, np.float32)


def board_texture(rng, kind, n, s):
    # 返回 (n, n) 的加性纹理（灰度单位），木纹/大理石/细噪声
    if kind == 'wood':
        out = np.zeros((n, n), np.float32)
        yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
        amp = rng.uniform(4, 22)
        for r in range(8):
            for c in range(8):
                ang = rng.choice([0, math.pi / 2]) + rng.normal(0, 0.08)
                t = xx * math.cos(ang) + yy * math.sin(ang)
                warp = smooth_noise(rng, s, s, max(4, s / 3)) * rng.uniform(2, 8)
                f = rng.uniform(0.15, 0.6) * 32 / max(s, 8)
                out[r * s:(r + 1) * s, c * s:(c + 1) * s] = amp * np.sin(2 * math.pi * f * (t + warp) + rng.random() * 6.3)
        return out
    if kind == 'marble':
        return smooth_noise(rng, n, n, rng.uniform(3, 20)) * rng.uniform(4, 16)
    if kind == 'noise':
        return rng.standard_normal((n, n)).astype(np.float32) * rng.uniform(1.5, 6)
    return None


def draw_label_layer(rng, n, s, light, dark, flipped):
    # 格内坐标：文件字母在底行、行号在左/右列；颜色取对面格色（lichess/chess.com 样式）
    lay = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    font = ImageFont.truetype(LABEL_FONTS[int(rng.integers(len(LABEL_FONTS)))], max(6, int(s * rng.uniform(0.17, 0.3))))
    files = 'abcdefgh'[::-1] if flipped else 'abcdefgh'
    ranks = '12345678' if flipped else '87654321'
    right = rng.random() < 0.5
    pad = max(1, int(s * 0.05))
    for c in range(8):
        sqlight = (7 + c) % 2 == 0
        col = tuple(int(v) for v in (dark if sqlight else light)) + (255,)
        txt = files[c]
        bb = d.textbbox((0, 0), txt, font=font)
        x = c * s + s - (bb[2] - bb[0]) - pad - bb[0] if right else c * s + pad - bb[0]
        d.text((x, 7 * s + s - (bb[3]) - pad), txt, font=font, fill=col)
    rank_right = rng.random() < 0.3
    for r in range(8):
        sqlight = (r + (7 if rank_right else 0)) % 2 == 0
        col = tuple(int(v) for v in (dark if sqlight else light)) + (255,)
        txt = ranks[r]
        bb = d.textbbox((0, 0), txt, font=font)
        x = 7 * s + s - (bb[2] - bb[0]) - pad - bb[0] if rank_right else pad - bb[0]
        d.text((x, r * s + pad - bb[1]), txt, font=font, fill=col)
    return np.asarray(lay, np.float32) / 255.0


def draw_arrows(rng, n, s):
    lay = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    cols = [(21, 120, 27), (136, 32, 32), (0, 48, 136), (230, 143, 0)]
    for _ in range(int(rng.integers(1, 4))):
        a, b = rng.integers(0, 64, 2)
        if a == b:
            continue
        x0, y0 = (a % 8 + 0.5) * s, (a // 8 + 0.5) * s
        x1, y1 = (b % 8 + 0.5) * s, (b // 8 + 0.5) * s
        col = cols[int(rng.integers(4))] + (int(rng.uniform(0.45, 0.85) * 255),)
        wdt = max(2, int(s * rng.uniform(0.12, 0.22)))
        ang = math.atan2(y1 - y0, x1 - x0)
        hl = s * 0.35
        ex, ey = x1 - math.cos(ang) * hl * 0.8, y1 - math.sin(ang) * hl * 0.8
        d.line([(x0, y0), (ex, ey)], fill=col, width=wdt)
        p1 = (x1, y1)
        p2 = (x1 - hl * math.cos(ang) + hl * 0.6 * math.sin(ang), y1 - hl * math.sin(ang) - hl * 0.6 * math.cos(ang))
        p3 = (x1 - hl * math.cos(ang) - hl * 0.6 * math.sin(ang), y1 - hl * math.sin(ang) + hl * 0.6 * math.cos(ang))
        d.polygon([p1, p2, p3], fill=col)
    return np.asarray(lay, np.float32) / 255.0


def render_board(rng, squares, s, set_name, light=None, dark=None, opts=None):
    """渲染 8s×8s 的棋盘 RGB float32（0..255）。opts 控制各种可选元素，缺省时随机。"""
    o = dict(opts or {})
    n = 8 * s
    if light is None:
        light, dark = pick_colors(rng)
    light = np.asarray(light, np.float32)
    dark = np.asarray(dark, np.float32)
    rr, cc = np.divmod(np.arange(64), 8)
    is_light = ((rr + cc) % 2 == 0)
    cols = np.where(is_light[:, None], light[None], dark[None]).astype(np.float32)

    # 高亮：上一步（两格）、选中格；用半透明叠色
    hl = o.get('highlight', rng.random() < 0.35)
    if hl:
        presets = [((155, 199, 0), 0.41), ((255, 255, 51), 0.5), ((20, 85, 30), 0.5), ((247, 247, 105), 0.8),
                   ((187, 203, 43), 0.8), ((100, 160, 255), 0.4)]
        if rng.random() < 0.7:
            hc, ha = presets[int(rng.integers(len(presets)))]
        else:
            hc, ha = tuple(rng.uniform(0, 255, 3)), rng.uniform(0.2, 0.6)
        for i in rng.choice(64, int(rng.integers(1, 4)), replace=False):
            cols[i] = cols[i] * (1 - ha) + np.array(hc, np.float32) * ha

    img = np.repeat(np.repeat(cols.reshape(8, 8, 3), s, 0), s, 1)

    tex = o.get('texture', rng.choice(['flat', 'flat', 'flat', 'wood', 'marble', 'noise', 'hatch'], p=[0.25, 0.2, 0.15, 0.13, 0.1, 0.1, 0.07]))
    if tex == 'hatch':
        # 书籍风格：暗格是斜线阴影，亮格纯白
        yy, xx = np.mgrid[0:n, 0:n]
        per = rng.integers(3, 7)
        th = max(1, int(per * rng.uniform(0.3, 0.6)))
        line = ((xx + (yy if rng.random() < 0.5 else -yy)) % per) < th
        dmask = ~np.repeat(np.repeat(is_light.reshape(8, 8), s, 0), s, 1)
        ink = np.array(rng.uniform(0, 90, 3) if rng.random() < 0.3 else [rng.uniform(0, 90)] * 3, np.float32)
        paper = np.array([rng.uniform(225, 255)] * 3, np.float32)
        img[:] = paper
        img[dmask & line] = ink
    elif tex != 'flat':
        t = board_texture(rng, tex, n, s)
        if t is not None:
            img += t[..., None]

    # 将军红光（径向渐变，画在棋子下面）
    if o.get('check', rng.random() < 0.08):
        kings = [i for i, v in enumerate(squares) if v in ('K', 'k')]
        if kings:
            i = kings[int(rng.integers(len(kings)))]
            r0, c0 = divmod(i, 8)
            yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
            dist = np.hypot((xx + 0.5) / s - 0.5, (yy + 0.5) / s - 0.5) / 0.7071
            a = np.clip(1 - dist / 0.89, 0, 1) ** 0.8
            reg = img[r0 * s:(r0 + 1) * s, c0 * s:(c0 + 1) * s]
            reg[:] = reg * (1 - a[..., None]) + np.array([231, 0, 0], np.float32) * a[..., None]

    # 着法提示点 / 吃子圈
    if o.get('dots', rng.random() < 0.1):
        dc = np.array([20, 85, 30], np.float32)
        da = rng.uniform(0.3, 0.6)
        yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
        dist = np.hypot((xx + 0.5) / s - 0.5, (yy + 0.5) / s - 0.5)
        dot = (dist < rng.uniform(0.1, 0.18)).astype(np.float32) * da
        ring = (dist > 0.42).astype(np.float32) * da * (dist < 0.75)
        for i in rng.choice(64, int(rng.integers(2, 9)), replace=False):
            r0, c0 = divmod(int(i), 8)
            m = ring if squares[i] else dot
            reg = img[r0 * s:(r0 + 1) * s, c0 * s:(c0 + 1) * s]
            reg[:] = reg * (1 - m[..., None]) + dc * m[..., None]

    if o.get('labels', rng.random() < 0.45):
        lay = draw_label_layer(rng, n, s, light, dark, o.get('flipped', False))
        img = img * (1 - lay[..., 3:4]) + lay[..., :3] * 255 * lay[..., 3:4]

    # 棋子
    scale = o.get('piece_scale', float(np.clip(rng.normal(0.97, 0.06), 0.78, 1.06)))
    # 造型增强（整盘统一，模拟没见过的棋子套装）：长宽比、整体偏上/偏下、笔画粗细、填充/描边色调
    shape_aug = o.get('shape_aug', 0.0) > 0 and rng.random() < o.get('shape_aug', 0.0)
    sx = sy = 1.0
    dy_off, morph, tone = 0.0, 0, None
    if shape_aug:
        if rng.random() < 0.6:
            scale = float(rng.uniform(0.62, 1.05))
            sx = float(rng.uniform(0.8, 1.12))
            sy = float(rng.uniform(0.88, 1.12))
            dy_off = float(rng.uniform(-0.12, 0.1))
        if rng.random() < 0.35:
            morph = int(rng.choice([-1, 1]))
        if rng.random() < 0.6:
            tone = (_rand_tone(rng, True), _rand_tone(rng, False))
    pw, ph = max(4, int(round(s * scale * sx))), max(4, int(round(s * scale * sy)))
    shadow = o.get('shadow', rng.random() < 0.08)
    for i, v in enumerate(squares):
        if not v:
            continue
        sp = sprite_at(set_name, v, pw, ph)
        if morph or tone:
            sp = _restyle(sp, morph, tone[0 if v.isupper() else 1] if tone else None)
        r0, c0 = divmod(i, 8)
        jx = int(round(rng.normal(0, 0.015) * s)) if o.get('piece_jitter', True) else 0
        jy = int(round(rng.normal(0, 0.015) * s)) if o.get('piece_jitter', True) else 0
        x = c0 * s + (s - pw) // 2 + jx
        y = r0 * s + (s - ph) // 2 + jy + int(round(dy_off * s))
        _blit(img, sp, x, y, shadow)

    if o.get('arrows', rng.random() < 0.06):
        lay = draw_arrows(rng, n, s)
        img = img * (1 - lay[..., 3:4]) + lay[..., :3] * 255 * lay[..., 3:4]
    return np.clip(img, 0, 255)


def _rand_tone(rng, white):
    # 亮度重映射 [0,1] → [lo,hi] 加轻微色偏；白子保持亮、黑子保持暗，只改"有多白/多黑"和描边深浅
    if white:
        lo, hi = rng.uniform(0, 0.45), rng.uniform(0.78, 1.0)
    else:
        lo, hi = rng.uniform(0, 0.2), rng.uniform(0.35, 1.0)
    tint = 1 + rng.uniform(-0.12, 0.12, 3)
    return lo, hi, tint.astype(np.float32)


def _restyle(sp, morph, tone):
    a = sp[..., 3:4]
    rgb = np.where(a > 1e-4, sp[..., :3] / np.maximum(a, 1e-4), 0)
    if tone is not None:
        lo, hi, tint = tone
        rgb = np.clip((lo + (hi - lo) * rgb) * tint, 0, 1)
    if morph:
        # 3×3 膨胀/腐蚀：笔画变粗/变细（同时作用于颜色，边缘颜色随之扩展）
        pad_a = np.pad(a[..., 0], 1, mode='constant')
        pad_c = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), mode='edge')
        stack_a = np.stack([pad_a[dy:dy + a.shape[0], dx:dx + a.shape[1]] for dy in range(3) for dx in range(3)])
        if morph > 0:
            k = stack_a.argmax(0)
            na = stack_a.max(0)
        else:
            k = stack_a.argmin(0)
            na = stack_a.min(0)
        stack_c = np.stack([pad_c[dy:dy + a.shape[0], dx:dx + a.shape[1]] for dy in range(3) for dx in range(3)])
        rgb = np.take_along_axis(stack_c, k[None, ..., None], 0)[0]
        a = na[..., None]
    out = np.concatenate([rgb * a, a], -1).astype(np.float32)
    return out


def _blit(img, sp, x, y, shadow=False):
    H, W = img.shape[:2]
    ph, pw = sp.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + pw), min(H, y + ph)
    if x1 <= x0 or y1 <= y0:
        return
    s = sp[y0 - y:y1 - y, x0 - x:x1 - x]
    reg = img[y0:y1, x0:x1]
    if shadow:
        off = max(1, pw // 25)
        a = s[..., 3:4] * 0.35
        reg2 = img[min(H - 1, y0 + off):min(H, y1 + off), min(W - 1, x0 + off):min(W, x1 + off)]
        hh, ww = reg2.shape[:2]
        reg2[:] = reg2 * (1 - a[:hh, :ww])
    reg[:] = reg * (1 - s[..., 3:4]) + s[..., :3] * 255


# ---------------------------------------------------------------- 增强

def gaussian_blur(img, sig):
    # 可分离高斯（PIL 的 F 模式不支持 GaussianBlur），边缘复制填充
    r = max(1, int(math.ceil(sig * 3)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2).astype(np.float32)
    k /= k.sum()
    for axis in (0, 1):
        pad = [(0, 0)] * img.ndim
        pad[axis] = (r, r)
        p = np.pad(img, pad, mode='edge')
        n = img.shape[axis]
        acc = np.zeros_like(img)
        for i, w in enumerate(k):
            acc += w * np.take(p, np.arange(i, i + n), axis=axis)
        img = acc
    return img


def photometric(rng, img, strength=1.0):
    """图像级增强（RGB float32 0..255）：模糊、噪声、摩尔纹、眩光、gamma、JPEG。"""
    h, w = img.shape[:2]
    if rng.random() < 0.3 * strength:
        img = gaussian_blur(img, rng.uniform(0.3, 1.3))
    if rng.random() < 0.12 * strength:
        # 屏摄摩尔纹：接近像素间距的两组正弦光栅
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        pat = np.zeros((h, w), np.float32)
        for _ in range(int(rng.integers(1, 3))):
            ang = rng.uniform(0, math.pi)
            per = rng.uniform(3, 30)
            pat += np.sin(2 * math.pi * (xx * math.cos(ang) + yy * math.sin(ang)) / per + rng.uniform(0, 6.3))
        img = img * (1 + pat[..., None] * rng.uniform(0.02, 0.08))
    if rng.random() < 0.1 * strength:
        # 眩光：局部提亮并压低对比度
        cy, cx = rng.uniform(0, h), rng.uniform(0, w)
        sig = rng.uniform(0.15, 0.5) * max(h, w)
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        g = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sig * sig)) * rng.uniform(0.15, 0.55)
        img = img * (1 - g[..., None]) + 255 * g[..., None]
    if rng.random() < 0.5 * strength:
        # 亮度/对比度/gamma/白平衡
        img = img * rng.uniform(0.75, 1.2) + rng.uniform(-25, 25)
        img = img * rng.uniform(0.9, 1.1, 3)[None, None]
        img = 255 * (np.clip(img, 0, 255) / 255) ** rng.uniform(0.7, 1.4)
    if rng.random() < 0.3 * strength:
        img = img + rng.standard_normal(img.shape).astype(np.float32) * rng.uniform(1, 9)
    img = np.clip(img, 0, 255)
    if rng.random() < 0.3 * strength:
        buf = io.BytesIO()
        Image.fromarray(img.astype(np.uint8)).save(buf, 'JPEG', quality=int(rng.uniform(25, 92)))
        img = np.asarray(Image.open(buf), np.float32)
    return img


def to_gray(img):
    return (0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]).astype(np.float32)


# ---------------------------------------------------------------- 重采样（与 warp.js 对应）

def square_to_quad(c):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = c
    dx3, dy3 = x0 - x1 + x2 - x3, y0 - y1 + y2 - y3
    if abs(dx3) < 1e-9 and abs(dy3) < 1e-9:
        return np.array([x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0], np.float64)
    dx1, dx2, dy1, dy2 = x1 - x2, x3 - x2, y1 - y2, y3 - y2
    den = dx1 * dy2 - dx2 * dy1
    g = (dx3 * dy2 - dx2 * dy3) / den
    h = (dx1 * dy3 - dx3 * dy1) / den
    return np.array([x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h], np.float64)


def super_samples(c, n):
    side = max(math.hypot(c[(i + 1) % 4][0] - c[i][0], c[(i + 1) % 4][1] - c[i][1]) for i in range(4))
    return max(1, min(8, math.ceil(side / n - 1e-6)))


def bilinear(gray, fx, fy):
    h, w = gray.shape
    ix = np.floor(fx)
    iy = np.floor(fy)
    wx = (fx - ix).astype(np.float32)
    wy = (fy - iy).astype(np.float32)
    ix = ix.astype(np.int64)
    iy = iy.astype(np.int64)
    ix0 = np.clip(ix, 0, w - 1)
    ix1 = np.clip(ix + 1, 0, w - 1)
    iy0 = np.clip(iy, 0, h - 1)
    iy1 = np.clip(iy + 1, 0, h - 1)
    a = gray[iy0, ix0]
    b = gray[iy0, ix1]
    c = gray[iy1, ix0]
    d = gray[iy1, ix1]
    top = a + (b - a) * wx
    bot = c + (d - c) * wx
    return top + (bot - top) * wy


def warp_gray(gray, corners, n):
    """整盘 n×n 重采样，等价于 warp.js 的 warpFromGray（gray 为整幅灰度图）。"""
    H = square_to_quad(corners)
    k = super_samples(corners, n)
    idx = (np.arange(n * k) + 0.5) / (n * k)
    bu, bv = np.meshgrid(idx, idx)
    z = H[6] * bu + H[7] * bv + 1
    fx = (H[0] * bu + H[1] * bv + H[2]) / z - 0.5
    fy = (H[3] * bu + H[4] * bv + H[5]) / z - 0.5
    v = bilinear(gray, fx, fy)
    return v.reshape(n, k, n, k).mean(axis=(1, 3)).astype(np.float32)


def sample_tiles(gray, corners, t=32, rng=None, jitter=0.0):
    """按格采样 64 块 t×t：无抖动时与 warp_gray 后切块完全相同；jitter>0 时每格再做 ±jitter 的平移/缩放。"""
    n = 8 * t
    H = square_to_quad(corners)
    k = super_samples(corners, n)
    sub = (np.arange(t * k) + 0.5) / (t * k)  # 格内 0..1
    rr, cc = np.divmod(np.arange(64), 8)
    if jitter > 0 and rng is not None:
        du = rng.uniform(-jitter, jitter, 64)
        dv = rng.uniform(-jitter, jitter, 64)
        sc = 1 + rng.uniform(-jitter, jitter, 64)
    else:
        du = dv = np.zeros(64)
        sc = np.ones(64)
    # 格中心 + (sub-0.5)·scale
    bu = ((cc + 0.5 + du)[:, None, None] + (sub[None, None, :] - 0.5) * sc[:, None, None]) / 8
    bv = ((rr + 0.5 + dv)[:, None, None] + (sub[None, :, None] - 0.5) * sc[:, None, None]) / 8
    bu = np.broadcast_to(bu, (64, t * k, t * k))
    bv = np.broadcast_to(bv, (64, t * k, t * k))
    z = H[6] * bu + H[7] * bv + 1
    fx = (H[0] * bu + H[1] * bv + H[2]) / z - 0.5
    fy = (H[3] * bu + H[4] * bv + H[5]) / z - 0.5
    v = bilinear(gray, fx, fy)
    return v.reshape(64, t, k, t, k).mean(axis=(2, 4)).astype(np.float32)


def normalize_stats(board):
    m = float(board.mean())
    sd = float(board.std())
    return m, sd


def jitter_corners(rng, corners, s, mag):
    # 每个角独立偏移，等效于"检测不准 + 轻微透视"
    c = np.array(corners, np.float64)
    return (c + rng.uniform(-mag, mag, (4, 2)) * s).tolist()
