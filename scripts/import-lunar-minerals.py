"""Reproduce the south-pole subset of Moon Trek's LP source products.

Python standard library only. Use --cache /tmp to reuse downloaded source files.
Full input checksums and row counts are verified before writing any output.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

BASE = 'https://pds-geosciences.wustl.edu/missions/lunarp/reduced/'
PRODUCTS = {
    'feo': ('ironhd', 259200, '1e3b0c94e53896e7bdf93b6fe5fddcb2b4a84caff48af9c76164f70fbb81c390', 'LP_GRS_Fe_Clr_Global_2ppd', 'FeO weight percent'),
    'thorium': ('thoriumhd', 259200, 'cd04f675a161dc654f47ab9967d102cd4af92f6b6d15155f2424a4590867096d', 'LP_GRS_Th_Clr_Global_2ppd', 'ppm'),
    'titanium': ('titanium2d', 11306, 'b593f359e2c2778184fbf206521a5926a96b821b1f3087a7dc4c229439dbad47', 'LP_GRS_TitaniumAbundance_2ppd', 'Ti weight percent'),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path)
    args = parser.parse_args()
    products = {}
    for key, (name, count, checksum, layer, unit) in PRODUCTS.items():
        url = BASE + name + '.txt'
        cached = args.cache / ('lunar-' + name + '.txt') if args.cache else None
        raw = cached.read_bytes() if cached and cached.exists() else urlopen(url, timeout=120).read()
        if hashlib.sha256(raw).hexdigest() != checksum:
            raise ValueError(f'{name}: upstream checksum changed; review before updating')
        text = raw.decode('ascii')
        assert unit in text, f'{name}: unit header changed'
        rows = [list(map(float, line.split(','))) for line in text.splitlines() if line.strip() and not line.startswith('#')]
        assert len(rows) == count and all(len(row) == 5 for row in rows)
        assert all(-90 <= a < b <= 90 and -180 <= c < d <= 180 for a, b, c, d, _ in rows)
        subset = [row for row in rows if row[0] < -75]
        product = {'sourceUrl': url, 'sha256': checksum, 'trekLayer': layer, 'unit': unit}
        if key == 'titanium':
            product['cells'] = subset
        else:
            # Preserve the original south-to-north / west-to-east order, no resampling.
            assert len(subset) == 30 * 720
            for i, (a, b, c, d, _) in enumerate(subset):
                assert a == -90 + (i // 720) * .5 and b == a + .5
                assert c == -180 + (i % 720) * .5 and d == c + .5
            product['values'] = [row[4] for row in subset]
        products[key] = product
        print(f'{key}: {len(subset)} original cells retained')
    output = {'schemaVersion': 1, 'coverage': {'south': -90, 'north': -75}, 'products': products}
    target = Path(__file__).resolve().parents[1] / 'public/resources/lp-south-pole.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, separators=(',', ':'), allow_nan=False) + '\n')
    print(target)


if __name__ == '__main__':
    main()
