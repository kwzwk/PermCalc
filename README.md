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
    O-ring schema), `d2` (cross-section / cord diameter — the diffusion
    path length; thicker means less permeation), and **contact width**
    (the effective exposed sealing band width — set by groove/squeeze
    geometry, independent of `d2`; wider means more permeation, defaults
    to `d2`).
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

Gas diffuses radially through the O-ring's cord, from the high-pressure
side to the low-pressure side:

- Diffusion path length: `L = d2` (the cord cross-section diameter) — a
  thicker cord is a longer barrier, so permeation *decreases* as `d2`
  increases.
- Permeation area: `A = π · d1 · width`, where `width` is the effective
  contact width of the exposed sealing band (set by the groove/squeeze
  geometry) — *independent* of `d2`, so permeation *increases* as `width`
  increases.

So the geometry factor is:

```
A / L = π · d1 · width / d2
```

This keeps `width` decoupled from `d2` on purpose: for a real, standard
permeability coefficient (Barrer, SI, ...) — defined via flat-membrane
testing as `Flux = P · Area / Thickness` — `Area / Thickness` must have
units of length. If `width` were instead set equal to `d2` (as in a naive
"unrolled torus band" with matching width and thickness), `d2` would
cancel out of the ratio entirely and the result would become independent
of cord diameter, contradicting the well-established engineering result
that a thicker cross-section improves permeation resistance. Decoupling
`width` from `d2` is what lets both dimensions matter independently while
keeping the permeability units dimensionally valid. `width` defaults to
`d2` in the UI as a starting point — adjust it if you know the actual
compressed contact width for your groove design.

### Permeation flux (multiple O-rings, in parallel)

Steady-state Fickian permeation through O-ring `i`:

```
Q_i = P_i · (A_i / L_i) · ΔP = P_i · π · d1_i · width_i / d2_i · (P_compartment − P_external)
```

where `P_i` is that O-ring's permeability coefficient (SI: `mol/(m·s·Pa)`).
Every O-ring vents the same compartment to the same external environment,
so their molar flows simply add:

```
Q_total = Σ_i Q_i = K_total · (P_compartment − P_external),   K_total = Σ_i (P_i · π · d1_i · width_i / d2_i)
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
  above (linear diffusion across the cord, uniform contact width); it does
  not model the true 2D diffusion shape within the cross-section or
  squeeze-dependent contact patch geometry in detail.
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
