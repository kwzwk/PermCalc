# Where the effective face height comes from

The calculator needs one number from the O-ring's cross-section: its
**conductance per unit length of seal**. In two dimensions that quantity is a
*dimensionless shape factor* `S` — steady diffusion obeys Laplace's equation,
which is scale-invariant, so a uniformly scaled cross-section has exactly the
same `S`. It depends on the squeeze fraction and nothing else.

The model writes `S` as `w / L`, so choosing `w` **is** choosing `S`.

## Why the two obvious choices are both wrong

| Rule for `w` | `S` at 20% squeeze | vs. truth |
|---|---|---|
| Half the squeezed ellipse's perimeter (the flank's arc length) | 1.304 | **+50%** |
| The installed cord height `h` | 0.640 | **−26%** |
| **Solved 2D field** | **0.867** | — |

The arc length overstates it because it counts curved boundary as if it were
flat entry area, and it degenerates badly: as the ellipse elongates the
half-perimeter tends to the major axis itself, so `w/L → 1` and the model stops
responding to squeeze at all (`w/L` = 1.0012 at 80% squeeze).

The plain installed height understates it because it treats the cord as a
rectangular slab, ignoring that the diffusion field spreads through the bulging
middle of the section and crowds around the edges of the contact bands.

## What was actually solved

`tools/shape-factor-solver.py` computes `S` directly:

- **Geometry.** The free cord (diameter `d2`) is squashed to an installed
  height `h`, modelled as an **area-conserving truncated circle** — a circle of
  radius `R` cut by the two flats, with `R` set so the area equals `π·d2²/4`.
  Unlike a tangent ellipse this produces a real contact band of finite width,
  which matters: with a zero-width contact the conductance diverges
  logarithmically.
- **Boundary conditions.** Left flank `c = 1` (high-pressure gas), right flank
  `c = 0`, and no flux on the two contact bands, since metal is impermeable.
- **Solution.** Laplace's equation on a masked finite-difference grid, solved
  directly as a sparse linear system.
- **Read-out.** For a unit concentration drop the conductance equals the
  Dirichlet energy, `S = ∫|∇c|² dA`.

Validation and convergence:

- On a plain rectangle, where the exact answer is `S = h/L`, the solver returns
  it to **0.63%** across several aspect ratios.
- `S` is identical to 5 significant figures for `d2` = 1.5, 2 and 6 mm at the
  same squeeze, confirming the scale-invariance the theory demands.
- Grid convergence at 20% squeeze: 0.86934 → 0.86668 → 0.86814 → 0.86718 for
  n = 100 → 150 → 200 → 300, i.e. stable to ~0.2%.

## The result

Tabulated in `assets/calc.js` as `SHAPE_FACTOR_RHO`, where

```
rho(squeeze) = S / (1 - squeeze)^2      and so      w = rho(squeeze) * h
```

| squeeze | 5% | 10% | 15% | 20% | 25% | 30% | 40% | 50% | 70% |
|---|---|---|---|---|---|---|---|---|---|
| `S` | 1.504 | 1.200 | 1.012 | 0.867 | 0.747 | 0.642 | 0.465 | 0.321 | 0.115 |
| `rho` | 1.666 | 1.481 | 1.400 | 1.354 | 1.327 | 1.310 | 1.291 | 1.283 | 1.281 |

Values in between are linearly interpolated, and clamped outside the solved
range. The clamp below 2.5% is deliberate rather than lazy: as squeeze goes to
zero the contact band shrinks to a point and the true conductance diverges
logarithmically — but an unsqueezed cord does not seal at all, so there is no
useful answer to extrapolate toward.

## Remaining limitations

- A real cord is laterally constrained by the groove walls and forms a barrel;
  the truncated circle is still an idealisation of the installed shape.
- The solve is planar. Seal curvature is handled separately, by the annular
  conductance `2π·w/ln(r₂/r₁)` in the main model.
- Contact bands are treated as perfectly impermeable and perfectly flat, with
  no interfacial leakage — this model covers permeation *through* the rubber
  only.

To regenerate the table:

```
pip install numpy scipy
python3 tools/shape-factor-solver.py
```

## How the shape factor enters the calculator

`S` is the physics; everything else is presentation. Auto width sets
`w = S · L`, so the two "diffusion path" options (free cord `d2`, or the
equal-area ellipse major axis `d2²/h`) give **identical** answers — the
conductance cannot depend on which length was nominated as the path. The path
choice only changes what a *manual* face height means.

The two geometry options then turn `S` into a conductance:

```
planar    G = π·(d1 + d2)·w / L            (conventional screening form)
annular   G = 2π·w / ln(r₂/r₁)             r₁,₂ = (d1 + d2)/2 ∓ L/2
```

The annular form accounts for the gas fanning outward as it crosses the seal
and reduces to the planar one for a thin cord. Measured at the defaults
(d1 = 50 mm, d2 = 3 mm, 20% squeeze) all four combinations agree to 0.17%:

| | L = d2 | L = d2²/h |
|---|---|---|
| planar | 0.144307 m | 0.144307 m |
| annular | 0.144153 m | 0.144066 m |
