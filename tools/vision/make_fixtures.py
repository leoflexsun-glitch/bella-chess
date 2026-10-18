#!/usr/bin/env python3
# 生成 tests/vision/fixtures/ 下的小型测试截图（固定局面，可复现）与真值 fixtures.json。
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib  # noqa: E402
import gen_screens  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'tests', 'vision', 'fixtures')

CASES = [
    # name, fen placement, flipped, set, theme(light,dark), screen (W,H), board px, opts
    ('start_celtic_green', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', False, 'celtic', 0, (640, 420), 336,
     dict(labels=True, highlight=False)),
    ('sicilian_chessnut_brown_flipped', 'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R', True, 'chessnut', 1, (600, 460), 360,
     dict(labels=True, highlight=True)),
    ('endgame_fantasy_blue_check', '8/5pk1/6p1/3Q4/8/6P1/5PK1/3q4', False, 'fantasy', 2, (520, 520), 296,
     dict(labels=False, highlight=True, check=True)),
    ('middlegame_glyph_book', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1', False,
     'glyph:FreeSerif.ttf:filled', None, (560, 440), 328, dict(labels=False, highlight=False, texture='flat')),
    ('kingside_merida_flipped', '2kr3r/ppp2ppp/2n5/3q4/3P4/2P2N2/P4PPP/R2QR1K1', True, 'merida', None, (700, 400), 304,
     dict(labels=True, highlight=True)),
]


def squares_of(fen, flipped):
    sq = []
    for row in fen.split('/'):
        for ch in row:
            sq += [''] * int(ch) if ch.isdigit() else [ch]
    return sq[::-1] if flipped else sq


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = []
    for k, (name, fen, flipped, set_name, theme, (W, H), B, opts) in enumerate(CASES):
        rng = np.random.default_rng(1000 + k)
        sq = squares_of(fen, flipped)
        if theme is None:
            light, dark = (np.array([255, 255, 255], np.float32), np.array([176, 176, 176], np.float32)) if 'glyph' in set_name \
                else (np.array(vlib.hex_rgb('#e8e9b7'), np.float32), np.array(vlib.hex_rgb('#9a7b5a'), np.float32))
        else:
            light, dark = vlib.APP_THEMES[theme]
        o = dict(flipped=flipped, dots=False, arrows=False, texture='flat', piece_jitter=False, shadow=False, piece_scale=1.0)
        o.update(opts)
        s = int(math.ceil(B / 8))
        board = vlib.render_board(rng, sq, s, set_name, light, dark, o)
        bim = Image.fromarray(board.astype(np.uint8))
        if bim.size[0] != B:
            bim = bim.resize((B, B), Image.LANCZOS)
        bx0, by0 = int((W - B) * 0.25), int((H - B) / 2)
        theme_ui = gen_screens.THEMES[k % len(gen_screens.THEMES)]
        im = gen_screens.draw_ui(rng, W, H, theme_ui, (bx0, by0, bx0 + B, by0 + B))
        im.paste(bim, (bx0, by0))
        fn = f'{name}.png'
        im.save(os.path.join(OUT, fn), optimize=True)
        meta.append(dict(file=fn, corners=[[bx0, by0], [bx0 + B, by0], [bx0 + B, by0 + B], [bx0, by0 + B]],
                         squares=sq, flipped=flipped, placement=fen, set=set_name))
    with open(os.path.join(OUT, 'fixtures.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, m['file'])) for m in meta)
    print(f'wrote {len(meta)} fixtures, {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()
