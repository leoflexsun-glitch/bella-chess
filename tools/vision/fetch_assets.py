#!/usr/bin/env python3
# 下载 lichess 的自由许可棋子 SVG 到 .cache/svg/<set>/<wK..bP>.svg。
# 只拉许可证明确允许再分发/训练的套装（见 README 的许可表）。
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '.cache', 'svg')
BASE = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece'

# 与 README 许可表保持一致；不要加入 CC BY-NC* / freeware / 抽象套装
SETS = ['cburnett', 'merida', 'chessnut', 'celtic', 'fantasy', 'spatial',
        'papercut', 'rhosgfx', 'totoy', 'mpchess', 'pirouetti', 'pixel']
PIECES = [c + p for c in 'wb' for p in 'KQRBNP']


def main():
    sets = sys.argv[1:] or SETS
    for s in sets:
        d = os.path.join(OUT, s)
        os.makedirs(d, exist_ok=True)
        for p in PIECES:
            dst = os.path.join(d, p + '.svg')
            if os.path.exists(dst) and os.path.getsize(dst) > 0:
                continue
            url = f'{BASE}/{s}/{p}.svg'
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(url, timeout=30) as r:
                        data = r.read()
                    break
                except Exception as e:  # 代理偶尔断流，重试即可
                    if attempt == 3:
                        raise
                    print('retry', url, e)
                    time.sleep(1 + attempt)
            with open(dst, 'wb') as f:
                f.write(data)
        print('ok', s)


if __name__ == '__main__':
    main()
