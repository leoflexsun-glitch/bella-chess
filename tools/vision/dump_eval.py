#!/usr/bin/env python3
# 把 .npz 评测集转成 node 易读的原始二进制：<name>.u8（格子灰度）、.lab（标签）、.f32（整盘均值/方差）。
import os
import sys

import numpy as np

for p in sys.argv[1:]:
    z = np.load(p)
    base = os.path.splitext(p)[0]
    z['tiles'].astype(np.uint8).tofile(base + '.u8')
    z['labels'].astype(np.uint8).tofile(base + '.lab')
    z['stats'].astype(np.float32).tofile(base + '.f32')
    with open(base + '.sets', 'w') as f:
        f.write('\n'.join(str(s) for s in z['sets']))
    print('dumped', base, len(z['labels']) // 64, 'boards')
