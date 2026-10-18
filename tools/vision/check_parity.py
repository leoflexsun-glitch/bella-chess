#!/usr/bin/env python3
# 校验训练端（vlib.sample_tiles）与运行端（warp.js）的重采样逐像素一致。
# 写出 PNG + 角点 + Python 采样结果，再调用 node 比较。
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '.cache', 'parity')


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(5)
    cases = []
    for k, (s, persp) in enumerate([(25, 0.0), (60, 0.1), (110, 0.3), (37, 0.05)]):
        sq = vlib.random_position(rng)
        board = vlib.render_board(rng, sq, s, 'cburnett')
        canvas = np.zeros((8 * s + 2 * s, 8 * s + 2 * s, 3), np.float32) + 128
        canvas[s:9 * s, s:9 * s] = board
        img = canvas.astype(np.uint8)
        Image.fromarray(img).save(os.path.join(OUT, f'{k}.png'))
        c = [[s, s], [9 * s, s], [9 * s, 9 * s], [s, 9 * s]]
        c = vlib.jitter_corners(rng, c, s, persp)
        gray = vlib.to_gray(img.astype(np.float32))
        tiles = vlib.sample_tiles(gray, c, 32)
        tiles.astype(np.float32).tofile(os.path.join(OUT, f'{k}.f32'))
        cases.append({'png': f'{k}.png', 'tiles': f'{k}.f32', 'corners': c})
    with open(os.path.join(OUT, 'cases.json'), 'w') as f:
        json.dump(cases, f)
    r = subprocess.run(['node', '--no-warnings', os.path.join(HERE, 'check_parity.mjs'), OUT], capture_output=True, text=True)
    print(r.stdout, r.stderr)
    sys.exit(r.returncode)


if __name__ == '__main__':
    main()
