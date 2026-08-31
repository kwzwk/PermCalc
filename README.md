# PermCalc

A small, dependency-free web tool that estimates how long a sealed,
gas-charged compartment takes to lose pressure to permeation through an
O-ring, and when it reaches a defined **lockout pressure**.

Typical use case: a gas-charged actuator, accumulator, or sealed housing
that must be replaced/recharged once its internal pressure permeates down
to a minimum functional threshold — this tool gives a first-pass estimate
of that service life.

`index.html` loads `assets/calc.js` and `assets/app.js` as ES modules, so
browsers require it to be served over `http(s)://` — opening it directly
via `file://` (double-clicking it) will fail with a CORS error on module
loading. Serve the folder statically instead, e.g.:

```
npx http-server .
```

No build step or network access is required beyond that — all
calculations run client-side.

### Desktop / offline use (no server)

```
npm run build
```

produces `dist/PermCalc.html` — a single self-contained file (CSS and JS
inlined, no ES modules) that you can save to your desktop and just
double-click to open directly, with no server and no install. It's
generated from the same `assets/calc.js` / `assets/app.js` source (see
`build-standalone.js`), so there's only one copy of the logic to keep in
sync.

## Inputs

- **Gas used** — selects a molar mass (used only for the mass-loss-rate
  output; each O-ring's permeability coefficient is entered manually).
- **Compartment gas volume** and **operating temperature**.
- **One or more O-rings**, added dynamically ("+ Add O-ring") — a
  compartment can be sealed by more than one O-ring (redundant seals,
  separate ports, different compounds), and their permeation losses add
  together. Each O-ring card has its own:
  - **Dimensions**: `d1` (inner diameter / ID, as shown in a standard
    O-ring schema), `d2` (free cross-section / cord diameter),
    **compression**, and **exposed face height (`w`)**.
  - **Compression** can be given either as a **groove depth** (the
    installed height of the cord — how deep the groove squashes it) or as
    a **squeeze percentage** of `d2`. They describe the same geometry, but
    they pin different things when you change the cord: see "Which one to
    hold fixed" below. Groove depth is the default because it is the
    physically fixed quantity — a machined groove does not change depth
    when you fit a different cord in it.
  - **Exposed face height (`w`)** — the height of the rubber flank gas
    enters through, measured *along the squeeze axis*, at right angles to
    the gas path. **Auto** sets it to the installed cord height (i.e. the
    groove depth), which is its projected height across the gas path.
    **Manual** takes it as an independent input — use it when part of the
    flank is shielded (backup ring, dovetail groove).
  - **Permeation coefficient** of the gas through *that* O-ring's
    elastomer, *at the operating temperature above*. Pick a **material and
    temperature** from the built-in reference dropdown to fill this in
    automatically (see "Material reference library" below), or enter it
    manually from a supplier's datasheet (e.g. Parker, Trelleborg) — it is
    not looked up automatically for values outside the reference library,
    since it depends strongly on the specific compound, cure, and
    temperature.
- **Initial pressure**, **lockout pressure**, and the gas's **external
  partial pressure** (all absolute, shared by the whole compartment).

## Model

### Geometry (per O-ring)

Gas diffuses radially through the O-ring's *installed* (compressed) cord,
from the high-pressure side to the low-pressure side.

Rubber is essentially incompressible, so squeezing does not thin the cord
— it deforms the circular cross-section into an **equal-area ellipse**
that bulges sideways. Squashing a cord of free diameter `d2` down to an
installed height `h` (the groove depth) conserves the area `π/4·d2²`, so:

```
minor axis (across the squeeze) = h
major axis (across the gas path) = d2² / h        <- the diffusion path L
squeeze fraction                 = 1 - h / d2
```

Gas crosses the seal along that major axis, so **more squeeze lengthens
the path and reduces permeation**.

What actually sets the rate is the cross-section's **conductance per unit
length of seal** — a *dimensionless* 2D shape factor, since steady diffusion
obeys Laplace's equation and is scale-invariant. The model writes it as `w / L`,
so choosing the face height `w` is really choosing that shape factor.

Neither obvious guess is right. The flank's *arc length* overstates it by ~50%
and degenerates (as the ellipse elongates the half-perimeter tends to the major
axis, so `w/L → 1` and squeeze stops mattering); the plain installed height
understates it by ~26%. So it is taken from a numerical solution of the real 2D
diffusion field across the cross-section — see
[docs/shape-factor.md](docs/shape-factor.md) for the geometry, boundary
conditions, validation and the table:

```
S = rho(squeeze) · (1 − squeeze)²          S = 0.867 at 20% squeeze
w = S · L                                  (auto mode)
```

Because `S` is dimensionless it depends only on the squeeze fraction, never on
the cord diameter.

### Calculation model

Three form-level settings control how that shape factor becomes a conductance:

- **Permeation geometry.** *Planar* (default) is the conventional screening
  form, `G = A/L` with `A = π·(d1 + d2)·w` — the circumference taken at the
  cord's centroid, not at the bore. *Annular* is a refinement that accounts for
  the gas fanning outward as it crosses, `G = 2π·w/ln(r₂/r₁)` with the flanks
  placed symmetrically about the centroid radius. It reduces to the planar form
  for a thin cord; the two agree to ~0.1% at the defaults.
- **Diffusion path `L`.** Either the free cord diameter `d2` (default) or the
  equal-area ellipse major axis `d2²/h`. This is **bookkeeping, not physics**:
  in auto mode `w` is set from `L` so the answer is identical either way, as it
  must be. It changes what a *manual* face height means — and note that with a
  manual `w` and `L = d2`, squeeze no longer influences the result at all, since
  neither `A` nor `L` depends on it. Pick the ellipse path if you are overriding
  `w` and want squeeze to keep acting.
- **Calibration factor.** Multiplies the geometry factor. Leave it at 1 unless
  you have fitted it to measured pressure-decay data for this seal and gas.

### Which one to hold fixed: groove depth or squeeze %

This is the single most important modelling choice in the tool, because
it decides whether cord diameter affects the answer at all.

- **Fixed groove depth `h`** (the default, and the realistic comparison).
  A machined groove has a fixed depth, so fitting a fatter cord squeezes
  it more and bulges it further sideways. The path length grows as
  `L = d2²/h` while `w = h` stays put, so permeation falls roughly as
  `1/d2²`. Going from a 3 mm to a 6 mm cord in the same 2.4 mm groove
  takes the example service life from **16.5 to 55.4 years**. This is the
  comparison an engineer almost always means by "what if I use a thicker
  cord?"
- **Fixed squeeze percentage.** Holding the *ratio* `h/d2` fixed scales
  the entire cross-section with `d2`. Steady 2D diffusion is
  scale-invariant — a uniformly scaled cross-section has the same
  conductance per unit of seal length, since the shape factor is
  dimensionless — so `d2` very nearly cancels out. What little dependence
  remains comes only from the annulus curvature (a fatter cord reaches a
  larger outer radius), and it goes the *other* way: 16.5 → 14.9 years
  from a 3 mm to an 8 mm cord. That near-cancellation is a real result,
  not a bug, but it answers a question about a rescaled groove rather than
  a fixed one.

Scaling the **whole seal** — `d1`, `d2` and `w` all by `k` — is likewise
not neutral: the radii ratio `r₂/r₁` is unchanged while `w` grows, so `K`
is exactly linear in `k`. A seal scaled ×2 in every dimension has exactly
**2× the permeation conductance**. Only the *cord* cancels, and only at a
fixed squeeze percentage.

### Permeation flux (multiple O-rings, in parallel)

Steady-state Fickian permeation through O-ring `i`:

```
Q_i = P_i · G_i · ΔP,     G_i = π · (d1_i + d2_i) · w_i / L_i    (planar)
                          G_i = 2π · w_i / ln(r₂_i / r₁_i)       (annular)
```

where `P_i` is that O-ring's permeability coefficient (SI: `mol/(m·s·Pa)`).
Every O-ring vents the same compartment to the same external environment,
so their molar flows simply add:

```
Q_total = Σ_i Q_i = K_total · (P_compartment − P_external),   K_total = Σ_i (P_i · G_i)
```

### Pressure decay over time

Treating the compartment gas as ideal (`n = P·V / (R·T)`, constant `V` and
`T`) gives a linear first-order ODE:

```
dP/dt = -(R·T / V) · K_total · (P(t) − P_external)
      = -α · (P(t) − P_external)
```

which integrates in closed form to an exponential decay:

```
P(t) = P_external + (P0 − P_external) · exp(−α·t)
```

Solving for the time at which `P(t) = P_lockout` gives the headline
result:

```
t_lockout = ln[(P0 − P_external) / (P_lockout − P_external)] / α
```

## Units

Internally everything is converted to SI base units (m, m³, Pa, K, s,
mol) before computing; see `assets/calc.js` for the conversion factors.
Supported permeability coefficient units:

- **Barrer** (`1 Barrer = 1×10⁻¹⁰ cm³(STP)·cm / (cm²·s·cmHg)`)
- **Traditional**: `cm³(STP)·cm / (cm²·s·cmHg)`
- **Practical / packaging-style**: `cm³(STP)·mm / (m²·day·atm)`
- **Practical, bar**: `cm³(STP)·mm / (m²·day·bar)`
- **Practical, per mm²**: `cm³(STP)·mm / (mm²·day·bar)`
- **NTP, hourly**: `cm³(NTP)·mm / (m²·h·bar)`
- **SI**: `mol / (m·s·Pa)`
- **SI, volumetric**: `m³(STP) / (m·s·Pa)` — the same SI unit expressed as
  STP-normalized gas volume instead of moles (`P_si = P_si_vol / V_MOLAR_STP`)

`STP` is taken as 0 °C / 1 atm (molar volume 22,414 cm³/mol), matching the
convention traditional permeability constants are usually quoted under.
`NTP` has no single universal definition across industries; this tool
uses the common 20 °C / 1 atm convention (NIST/SEMI), giving a molar
volume of ~24,055 cm³/mol. If your datasheet's "NTP" means something
else (e.g. 25 °C, or referenced to 1 bar instead of 1 atm), convert its
value to Barrer or SI first rather than using the NTP option directly.

## Assumptions and limitations

- Permeability is assumed constant with pressure and independent of time
  (no swelling, plasticization, or aging effects).
- The O-ring's exposed permeation geometry is approximated as described
  above (radial diffusion across the cord, uniform exposed flank); it does
  not solve the true 2D diffusion field within the cross-section. A real
  cord in a groove is also laterally constrained and forms a barrel rather
  than a clean ellipse, so the equal-area ellipse is itself an
  idealisation of the installed shape.
- The compartment gas is treated as ideal; for very high pressures a
  real-gas compressibility correction would improve accuracy.
- Any other leak paths (fittings, other seals, diffusion through solid
  housing walls) are not included — this tool only estimates O-ring
  permeation loss.
- This is an engineering screening estimate, not a substitute for
  measured permeation test data or a full seal design review.

## Material reference library

Each O-ring card has an optional **Reference material** dropdown, filtered
to the **gas selected above** — pick a material, then a temperature, and
the permeability coefficient field is filled in automatically. This is
backed by `data/permeability-coefficients.csv` — a small, growable table
of published gas/elastomer permeability values. If no library entry
matches the currently selected gas, the dropdown is hidden entirely and
the permeability coefficient field below is just a plain input, since
there's nothing useful to pick from.

To add a material, gas, or a new temperature point: edit the CSV
(semicolon delimited, comma decimals, one column per temperature — leave
a cell empty if you don't have data for that point), then run:

```
npm run generate-data   # regenerates assets/permeability-data.js from the CSV
npm run build            # refreshes dist/PermCalc.html
```

The `Gas` column must match a key in `assets/calc.js`'s `GASES` table
(`He`, `N2`, `SF6`, ...) — `npm run generate-data` fails loudly, listing
the valid keys, if it doesn't.

If the CSV uses a permeability unit not already listed in
`assets/calc.js`'s `PERMEABILITY_UNITS`, add it there first (see the
Units section above), then map the CSV's unit label to it in
`UNIT_LABEL_TO_KEY` inside `generate-permeability-data.js` —
`npm run generate-data` fails loudly with the exact label to add if it's
missing, rather than silently guessing.

## Project layout

```
index.html                          UI markup
assets/style.css                      styling
assets/calc.js                          pure calculation functions (unit conversion, physics)
assets/app.js                              DOM wiring, results rendering, chart drawing
assets/permeability-data.js                  generated material reference library (see below)
data/permeability-coefficients.csv              source CSV for the above
generate-permeability-data.js                     regenerates assets/permeability-data.js from the CSV
tools/shape-factor-solver.py               2D diffusion solve behind the shape factor
docs/shape-factor.md                        how that number was derived and validated
test/calc.test.js                          Node test suite for assets/calc.js
test/permeability-data.test.js               Node test suite for the material reference library
build-standalone.js                     bundles the above into dist/PermCalc.html (see above)
```

## Running tests

```
npm test
```

Uses Node's built-in test runner (`node --test`), no dependencies
required.
