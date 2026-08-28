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
  - **Dimensions**: `d1` (seal/mean diameter of the sealing circle) and
    `d2` (cross-section / cord diameter).
  - **Permeation coefficient** of the gas through *that* O-ring's
    elastomer, *at the operating temperature above*. This must come from
    the material supplier's datasheet (e.g. Parker, Trelleborg) — it is
    not looked up automatically, since it depends strongly on the specific
    compound, cure, and temperature.
- **Initial pressure**, **lockout pressure**, and the gas's **external
  partial pressure** (all absolute, shared by the whole compartment).

## Model

### Geometry (per O-ring)

Each O-ring is approximated as a thin cylindrical band unrolled from its
torus shape:

- Permeation area: `A = π · d1 · d2`
- Diffusion path length: `L = d2` (gas travels radially through the cord
  cross-section, from the high-pressure side to the low-pressure side)

So the geometry factor is:

```
A / L = π · d1
```

**d2 cancels out of the first-order result.** This is a known, if
counter-intuitive, property of this standard simplified model: a larger
cross-section increases the permeation area and the diffusion path length
by the same factor, so they cancel, and total permeation is driven mainly
by the seal's mean diameter (circumference), not its cord thickness. `d2`
is still a required input because it is shown explicitly in the
"How this is calculated" breakdown, and because more detailed geometry
models (partial groove contact, non-uniform exposure) would reintroduce a
`d2` dependence.

### Permeation flux (multiple O-rings, in parallel)

Steady-state Fickian permeation through O-ring `i`:

```
Q_i = P_i · (A_i / L_i) · ΔP = P_i · π · d1_i · (P_compartment − P_external)
```

where `P_i` is that O-ring's permeability coefficient (SI: `mol/(m·s·Pa)`).
Every O-ring vents the same compartment to the same external environment,
so their molar flows simply add:

```
Q_total = Σ_i Q_i = K_total · (P_compartment − P_external),   K_total = Σ_i (P_i · π · d1_i)
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
- **SI**: `mol / (m·s·Pa)`

`STP` is taken as 0 °C / 1 atm (molar volume 22,414 cm³/mol), matching the
convention traditional permeability constants are usually quoted under.

## Assumptions and limitations

- Permeability is assumed constant with pressure and independent of time
  (no swelling, plasticization, or aging effects).
- The O-ring's exposed permeation geometry is approximated as described
  above; it does not account for groove contact area, squeeze, or
  multiple seals.
- The compartment gas is treated as ideal; for very high pressures a
  real-gas compressibility correction would improve accuracy.
- Any other leak paths (fittings, other seals, diffusion through solid
  housing walls) are not included — this tool only estimates O-ring
  permeation loss.
- This is an engineering screening estimate, not a substitute for
  measured permeation test data or a full seal design review.

## Project layout

```
index.html            UI markup
assets/style.css        styling
assets/calc.js            pure calculation functions (unit conversion, physics)
assets/app.js                DOM wiring, results rendering, chart drawing
test/calc.test.js            Node test suite for assets/calc.js
build-standalone.js       bundles the above into dist/PermCalc.html (see above)
```

## Running tests

```
npm test
```

Uses Node's built-in test runner (`node --test`), no dependencies
required.
