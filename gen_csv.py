import random, time, os, sys

path = os.path.join(os.path.expanduser('~'), 'Desktop', 'gfgg.csv')
print(f'Writing to: {path}')
start = time.time()

BATCH = 2_000_000          # rows per write
TOTAL = 100_000_000

with open(path, 'w', buffering=8*1024*1024) as f:
    f.write('numbers\n')
    buf = []
    for i in range(1, TOTAL + 1):
        buf.append(str(random.randint(0, 9)))
        if i % BATCH == 0:
            f.write('\n'.join(buf) + '\n')
            buf.clear()
            elapsed = time.time() - start
            pct = i / TOTAL * 100
            rate = i / elapsed if elapsed > 0 else 0
            eta = (TOTAL - i) / rate if rate > 0 else 0
            print(f'  {i:>12,} rows  {pct:.0f}%  {elapsed:.0f}s elapsed  ETA {eta:.0f}s', flush=True)
    if buf:
        f.write('\n'.join(buf) + '\n')

elapsed = time.time() - start
size_mb = os.path.getsize(path) / (1024 * 1024)
print(f'Done. {elapsed:.0f}s total. File size: {size_mb:.0f} MB')
