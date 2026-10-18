#!/usr/bin/env python3
# 评测 guessFlipped：随机对局局面（正/反两种显示）上判断方向的准确率。
# Python 只负责生成局面，判断用运行时的 JS 实现（eval_flip.mjs）。
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    rng = np.random.default_rng(77)
    pos = []
    for _ in range(n):
        sq = vlib.realistic_position(rng, max_plies=int(rng.choice([20, 60, 120])))
        pos.append(sq)
    path = os.path.join(HERE, '.cache', 'flip_positions.json')
    with open(path, 'w') as f:
        json.dump(pos, f)
    r = subprocess.run(['node', '--no-warnings', os.path.join(HERE, 'eval_flip.mjs'), path], capture_output=True, text=True)
    print(r.stdout, r.stderr)


if __name__ == '__main__':
    main()
