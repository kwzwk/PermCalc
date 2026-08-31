"""Direct sparse solve of the 2D diffusion field across an installed O-ring cord.

Cross-section: the free cord (diameter d2) squashed to installed height h,
modelled as an area-conserving TRUNCATED CIRCLE (radius R, cut by the two flats)
-- that yields a genuine contact band, which a tangent ellipse does not.

BCs:  left arc c=1 (high pressure), right arc c=0 (low pressure),
      top/bottom contact flats: no flux (metal is impermeable).

For a unit drop, conductance per unit seal length S = integral |grad c|^2 dA,
dimensionless. The calculator models S as w/L, so S tells us what w must be.
"""
import math
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spl


def truncated_circle(d2, h):
    target = math.pi * d2 * d2 / 4.0
    def area(R):
        if 2 * R <= h:
            return math.pi * R * R
        half = h / 2.0
        return 2.0 * (half * math.sqrt(R*R - half*half) + R*R*math.asin(half / R))
    lo, hi = h / 2.0, d2 * 5
    for _ in range(300):
        mid = 0.5 * (lo + hi)
        if area(mid) < target: lo = mid
        else: hi = mid
    R = 0.5 * (lo + hi)
    return R, math.sqrt(max(R*R - (h/2.0)**2, 0.0))


def conductance(inside, across, xside, dx, dy):
    """Assemble and solve. inside/across are bool grids; xside=+1/-1 per node."""
    nx, ny = inside.shape
    idx = -np.ones((nx, ny), dtype=np.int64)
    idx[inside] = np.arange(inside.sum())
    N = int(inside.sum())
    wx, wy = 1.0/dx**2, 1.0/dy**2

    rows, cols, vals = [], [], []
    rhs = np.zeros(N)
    ii, jj = np.nonzero(inside)
    for i, j in zip(ii, jj):
        k = idx[i, j]
        diag = 0.0
        for di, dj, w in ((1,0,wx), (-1,0,wx), (0,1,wy), (0,-1,wy)):
            a, b = i+di, j+dj
            if a < 0 or a >= nx or b < 0 or b >= ny:
                continue                      # outside the box = metal, no flux
            if inside[a, b]:
                diag += w
                rows.append(k); cols.append(idx[a, b]); vals.append(-w)
            elif across[a, b]:                # across the exposed arc -> Dirichlet
                diag += w
                rhs[k] += w * (1.0 if xside[a, b] < 0 else 0.0)
            # else: metal contact -> mirror, contributes nothing
        rows.append(k); cols.append(k); vals.append(diag)
    A = sp.csr_matrix((vals, (rows, cols)), shape=(N, N))
    u = spl.spsolve(A, rhs)

    full = np.full((nx, ny), np.nan)
    full[inside] = u
    dir_val = np.where(xside < 0, 1.0, 0.0)
    full[across] = dir_val[across]

    gx = np.diff(full, axis=0) / dx
    gy = np.diff(full, axis=1) / dy
    cx = inside[1:, :] | inside[:-1, :]
    cy = inside[:, 1:] | inside[:, :-1]
    e = np.nansum(np.where(cx, gx**2, 0.0))*dx*dy + np.nansum(np.where(cy, gy**2, 0.0))*dx*dy
    return e


def rectangle(h, L, n=160):
    ny, nx = n, max(8, int(round(n*L/h)))
    x = np.linspace(-L/2, L/2, nx); y = np.linspace(-h/2, h/2, ny)
    dx, dy = x[1]-x[0], y[1]-y[0]
    X, _ = np.meshgrid(x, y, indexing="ij")
    inside = np.ones((nx, ny), bool)
    inside[0, :] = False; inside[-1, :] = False
    across = np.zeros((nx, ny), bool)
    across[0, :] = True; across[-1, :] = True
    return conductance(inside, across, np.sign(X), dx, dy)


def cord(d2, sqpct, n=200):
    h = d2 * (1 - sqpct/100.0)
    R, s = truncated_circle(d2, h)
    ny, nx = n, max(8, int(round(n * (2*R) / h)))
    x = np.linspace(-R*1.02, R*1.02, nx); y = np.linspace(-h/2, h/2, ny)
    dx, dy = x[1]-x[0], y[1]-y[0]
    X, Y = np.meshgrid(x, y, indexing="ij")
    inside = (X*X + Y*Y <= R*R) & (np.abs(Y) <= h/2)
    across = (X*X + Y*Y > R*R)
    return conductance(inside, across, np.sign(X), dx, dy), h, 2*R, 2*s


print("=== validation: rectangle, exact S = h/L ===")
for h, L in [(2.4, 3.75), (1.0, 5.0), (2.0, 2.0)]:
    got = rectangle(h, L)
    print(f"  h={h:4} L={L:5}: S={got:.5f}  exact={h/L:.5f}  err={abs(got-h/L)/(h/L)*100:6.2f}%")

print()
print("=== installed 3 mm cord, real 2D field ===")
hdr = f"{'sq%':>4} {'h(mm)':>6} {'L(mm)':>6} {'contact':>8} | {'S_true':>8} {'h/L':>8} {'halfperim/L':>11} | {'S_true/(h/L)':>12}"
print(hdr); print("-"*len(hdr))
for sqpct in [10, 20, 30, 40]:
    S, h, L, c = cord(3.0, sqpct, n=200)
    ea = (3.0/(1-sqpct/100))/2; eb = h/2
    hp = math.pi*(3*(ea+eb) - math.sqrt((3*ea+eb)*(ea+3*eb)))/2
    print(f"{sqpct:4d} {h:6.3f} {L:6.3f} {c:8.3f} | {S:8.4f} {h/L:8.4f} {hp/(2*ea):11.4f} | {S/(h/L):12.3f}")

print()
print("grid convergence at 20% squeeze:")
for n in [100, 150, 200, 300]:
    S, h, L, c = cord(3.0, 20, n=n)
    print(f"  n={n:4d}  S={S:.5f}")

print()
print("=== is S scale-invariant in d2 (it must be: 2D shape factor)? at 20% squeeze ===")
for d2 in [1.5, 3.0, 6.0]:
    S, h, L, c = cord(d2, 20, n=200)
    print(f"  d2={d2:4} mm -> S={S:.5f}")
