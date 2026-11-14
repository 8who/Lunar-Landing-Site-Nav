"""Build high-resolution polar products from NASA LOLA ldem_16 + 8K LROC colour.

Polar stereographic (true at the pole), sphere R = 1737.4 km:
  south: rho = 2R tan((90 + lat)/2), x = rho sin(lon), y =  rho cos(lon)
  north: rho = 2R tan((90 - lat)/2), x = rho sin(lon), y = -rho cos(lon)
Pixel (i, j) centre: x = (j + 0.5) * px - half, y = half - (i + 0.5) * px.
"""
import sys, numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1], sys.argv[2]
R = 1737.4
dem = np.array(Image.open(f'{src}/ldem_16.tif'), dtype=np.float32)  # km, 2880 x 5760
H, W = dem.shape
# Isotropic low-pass in longitude (same idea as terrain.ts isotropicGrid).
cell = 2 * np.pi * R / (2 * H)
iso = dem.copy()
for r in range(H):
    lat = 90 - (r + 0.5) * 180 / H
    col = cell * np.cos(np.radians(lat))
    half = int(min(W // 2 - 1, max(0, np.floor(cell / col / 2))))
    if half > 0:
        k = 2 * half + 1
        row = np.concatenate([dem[r, -half:], dem[r], dem[r, :half]])
        c = np.cumsum(np.concatenate([[0.0], row.astype(np.float64)]))
        iso[r] = ((c[k:] - c[:-k]) / k).astype(np.float32)

def sample(lat, lon):
    y = (90 - lat) / 180 * H - 0.5
    x = (lon + 180) / 360 * W - 0.5
    y = np.clip(y, 0, H - 1); y0 = np.floor(y).astype(int); y1 = np.minimum(y0 + 1, H - 1); fy = y - y0
    x0 = np.floor(x).astype(int); fx = x - x0; x0 %= W; x1 = (x0 + 1) % W
    a = iso[y0, x0] * (1 - fx) + iso[y0, x1] * fx
    b = iso[y1, x0] * (1 - fx) + iso[y1, x1] * fx
    return a * (1 - fy) + b * fy

def ps_grid(pole, colat_deg, px):
    half = 2 * R * np.tan(np.radians(colat_deg) / 2)
    n = int(round(2 * half / px))
    j = np.arange(n); i = np.arange(n)
    x = (j + 0.5) * px - half
    y = half - (i + 0.5) * px
    X, Y = np.meshgrid(x, y)
    rho = np.hypot(X, Y)
    c = 2 * np.degrees(np.arctan(rho / (2 * R)))
    if pole == 'south':
        lat = -90 + c; lon = np.degrees(np.arctan2(X, Y))
    else:
        lat = 90 - c; lon = np.degrees(np.arctan2(X, -Y))
    return n, half, sample(lat, lon)

for pole in ('south', 'north'):
    # Shipped: 10 deg cap (to 80 deg) at 0.75 km, int16 metres.
    n, half, z = ps_grid(pole, 10, 0.75)
    np.round(z * 1000).astype('<i2').tofile(f'{out}/moon-polar-dem-{pole}.i16')
    print(pole, 'cap', n, 'px, half', round(half, 2), 'km, range', z.min(), z.max())
    # Offline only: 20 deg cap at 1.5 km, float32 km, for the horizon marches.
    n2, half2, z2 = ps_grid(pole, 20, 1.5)
    z2.astype('<f4').tofile(f'{out}/work-dem-{pole}.f32')
    print(pole, 'work', n2, half2)

# 8K colour photo for the globe.
Image.open(f'{src}/lroc_color_poles_8k.tif').convert('RGB').save(f'{out}/moon-8k.jpg', quality=84, optimize=True, progressive=True)
