// PermCalc — gas loss through O-ring permeation
//
// Model summary (see README.md for full derivation):
//   - Squeezing the cord deforms its circular cross-section into an
//     equal-area ellipse. Squashing a free cord of diameter d2 down to an
//     installed height h (the groove depth) gives a minor axis of h and a
//     major axis of d2^2 / h. Gas crosses the seal along the major axis,
//     so that is the diffusion path L, and the flank height it enters
//     through is w = h in auto mode.
//     Which of h and the squeeze RATIO you hold fixed decides whether cord
//     diameter matters at all: at a fixed groove depth the path grows as
//     d2^2/h so a fatter cord permeates far less, while at a fixed squeeze
//     percentage the whole cross-section scales with d2 and 2D diffusion
//     is scale-invariant, so d2 very nearly cancels. See README.md.
//   - The seal is an annulus: gas leaves the inner flank at r1 = d1/2 and
//     reaches the outer flank at r2 = r1 + L, spreading as it goes, so the
//     geometry factor is the cylindrical-shell conductance
//       k = A / L = 2*pi*w / ln(r2/r1)
//     which reduces to the planar pi*D_mean*w/L for a thin cord. It has
//     units of length, which is what keeps a real, standard permeability
//     coefficient (Barrer, SI, ...) dimensionally valid in
//     Q = P_SI * k * deltaP.
//   - Steady-state Fickian permeation: molar flow Q_i = P_SI_i * k_i * deltaP
//     for each O-ring i. A compartment may be sealed by more than one
//     O-ring (e.g. redundant seals, different ports) — since they all vent
//     the same gas volume to the same external environment in parallel,
//     their molar flows simply add: Q_total = sum_i(Q_i).
//   - Mass balance on the compartment (ideal gas, constant V and T):
//       dP/dt = -(R*T/V) * K * (P(t) - P_ext),  K = sum_i(P_SI_i * k_i)
//     which integrates in closed form to an exponential decay.
//
// All internal computation uses SI base units (m, m^3, Pa, K, s, mol).

export const R_GAS = 8.314462618; // J/(mol*K)
export const V_MOLAR_STP = 22414e-6; // m^3/mol at 0 C, 1 atm (22,414 cm^3/mol)
// "NTP" (Normal Temperature and Pressure) has no single universal
// definition; this uses the common 20 C / 1 atm convention (NIST, SEMI),
// giving ~24,055 cm^3/mol. If your datasheet uses a different NTP
// convention (e.g. 25 C, or 1 bar), its coefficient won't match this
// option exactly — convert it to Barrer or SI first in that case.
export const V_MOLAR_NTP = (R_GAS * 293.15) / 101325; // m^3/mol at 20 C, 1 atm

// ---------------------------------------------------------------------
// Unit conversion tables (multiply value by factor to get SI base unit)
// ---------------------------------------------------------------------

export const LENGTH_UNITS = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
};

export const VOLUME_UNITS = {
  cm3: 1e-6,
  L: 1e-3,
  m3: 1,
  in3: 1.6387064e-5,
  ft3: 0.0283168466,
  gal_us: 0.00378541178,
};

export const PRESSURE_UNITS = {
  Pa: 1,
  kPa: 1e3,
  MPa: 1e6,
  bar: 1e5,
  psi: 6894.757293,
  atm: 101325,
  cmHg: 1333.223874,
  mmHg: 133.3223874,
};

// Converts a "cm3(gas) * mm / (area * time * pressure)" style permeability
// coefficient (the general form of practical/packaging-style units, e.g.
// cm3(STP)*mm/(m2*day*atm)) into the SI base unit mol/(m*s*Pa).
//   molarVolume: m^3/mol for the gas-volume convention used (STP, NTP, ...)
//   areaM2: m^2 per 1 unit of the area used (m^2 -> 1, mm^2 -> 1e-6)
//   timeSeconds: seconds per 1 unit of the time used (day -> 86400, h -> 3600)
//   pressurePa: Pa per 1 unit of the pressure used (bar -> 1e5, atm -> 101325)
function practicalUnitFactor({ molarVolume, areaM2, timeSeconds, pressurePa }) {
  const molarVolumeCm3PerMol = molarVolume * 1e6;
  return 0.001 / (areaM2 * pressurePa * molarVolumeCm3PerMol * timeSeconds);
}

// Permeability coefficient unit -> SI mol/(m*s*Pa)
export const PERMEABILITY_UNITS = {
  // SI: mol/(m*s*Pa)
  si: 1,
  // Barrer = 1e-10 cm^3(STP)*cm / (cm^2*s*cmHg)
  barrer: 3.3465e-16,
  // "Traditional" gas permeability constant: cm^3(STP)*cm / (cm^2*s*cmHg)
  traditional: 3.3465e-6,
  // "Practical" / packaging-style units: cm^3(STP)*mm / (m^2*day*atm)
  practical: 5.0958e-18,
  // Same, but with bar instead of atm: cm^3(STP)*mm / (m^2*day*bar)
  practical_bar: practicalUnitFactor({
    molarVolume: V_MOLAR_STP,
    areaM2: 1,
    timeSeconds: 86400,
    pressurePa: 1e5,
  }),
  // Same, but per mm^2 of area instead of m^2: cm^3(STP)*mm / (mm^2*day*bar)
  practical_mm2_bar: practicalUnitFactor({
    molarVolume: V_MOLAR_STP,
    areaM2: 1e-6,
    timeSeconds: 86400,
    pressurePa: 1e5,
  }),
  // cm^3(NTP)*mm / (m^2*h*bar) — NTP per V_MOLAR_NTP's convention above
  ntp_hour_bar: practicalUnitFactor({
    molarVolume: V_MOLAR_NTP,
    areaM2: 1,
    timeSeconds: 3600,
    pressurePa: 1e5,
  }),
  // "Volumetric SI": m^3(STP) / (m*s*Pa), i.e. m^2/(s*Pa) with an STP tag —
  // same physical quantity as `si` but expressed as STP-normalized gas
  // volume instead of moles: P_si = P_si_vol / V_MOLAR_STP.
  si_vol: 1 / V_MOLAR_STP,
};

export const GASES = {
  He: { label: "Helium (He)", molarMass: 0.0040026 },
  H2: { label: "Hydrogen (H2)", molarMass: 0.0020159 },
  N2: { label: "Nitrogen (N2)", molarMass: 0.0280134 },
  O2: { label: "Oxygen (O2)", molarMass: 0.0319988 },
  Air: { label: "Air", molarMass: 0.0289647 },
  Ar: { label: "Argon (Ar)", molarMass: 0.039948 },
  CO2: { label: "Carbon dioxide (CO2)", molarMass: 0.0440095 },
  CH4: { label: "Methane (CH4)", molarMass: 0.0160425 },
  SF6: { label: "Sulfur hexafluoride (SF6)", molarMass: 0.1460554 },
  custom: { label: "Custom / other", molarMass: null },
};

export function celsiusToKelvin(c) {
  return c + 273.15;
}

export function fahrenheitToKelvin(f) {
  return ((f - 32) * 5) / 9 + 273.15;
}

export function temperatureToKelvin(value, unit) {
  if (unit === "K") return value;
  if (unit === "C") return celsiusToKelvin(value);
  if (unit === "F") return fahrenheitToKelvin(value);
  throw new Error(`Unknown temperature unit: ${unit}`);
}

export function convert(value, unit, table) {
  const factor = table[unit];
  if (factor === undefined) throw new Error(`Unknown unit: ${unit}`);
  return value * factor;
}

/**
 * Convert one O-ring's raw form inputs into SI values plus its geometry
 * factor and permeation contribution
 * K_i = P_SI_i * pi * d1_i * w_i / (d2_i * (1 - squeeze_i)).
 *
 * The installed O-ring is squeezed in its groove. Rubber is essentially
 * incompressible, so the circular cross-section does not just get thinner
 * — it deforms into an ellipse of the same area, bulging out sideways.
 * With squeeze c, the minor axis (squeeze direction) is d2*(1-c), so
 * conserving area pi/4*d2^2 = pi/4 * minor * major gives:
 *
 *   L_eff = major axis = d2 / (1 - squeeze)
 *
 * Gas crosses the seal along that major axis (high-pressure face to
 * low-pressure face, perpendicular to the squeeze direction), so squeeze
 * LENGTHENS the diffusion path and reduces permeation. A thinner cord
 * still shortens the path (more permeation), since L stays proportional
 * to d2.
 *
 * @param {object} r
 * @param {number} r.d1 inner diameter (ID) of the O-ring
 * @param {string} r.d1Unit
 * @param {number} r.d2 cross-section (cord) diameter of the O-ring, free
 *   (uninstalled). Combined with squeeze this sets the diffusion path.
 * @param {string} r.d2Unit
 * @param {number} r.squeezePct squeeze / compression, in percent of d2
 *   (typical installed O-rings: 15-30%). 0 means uncompressed.
 * @param {number} r.width exposed face height — the height of the rubber
 *   face gas enters through, measured along the squeeze axis. Used only
 *   when widthMode is "manual".
 * @param {string} r.widthUnit
 * @param {"auto"|"manual"} [r.widthMode] "auto" derives the face height
 *   from the ellipse itself (half its perimeter, i.e. the arc exposed to
 *   the high-pressure side). Note that this makes the result independent
 *   of d2: the ellipse's aspect ratio b/a = (1-squeeze)^2 depends only on
 *   squeeze, so w and L scale with d2 together and cancel. "manual"
 *   (the default) keeps the face height as an independent input, which is
 *   what lets cord diameter affect the answer.
 * @param {number} r.permeability permeability coefficient value, at the
 *   compartment's operating temperature, for this O-ring's elastomer/gas pair
 * @param {string} r.permeabilityUnit
 */
/**
 * Perimeter of an ellipse with semi-axes a and b (Ramanujan's second
 * approximation — well under 1e-5 relative error for the aspect ratios
 * a squeezed O-ring ever reaches).
 */
// Effective-face-height correction rho(squeeze), from a numerical solution of
// the 2D diffusion field across an installed cord (see docs/shape-factor.md).
// The true dimensionless conductance of the cross-section is
//   S = rho(squeeze) * (1 - squeeze)^2
// and since the model writes S as w/L with L = d2/(1-squeeze), the effective
// face height is simply w = rho(squeeze) * installed height.
export const SHAPE_FACTOR_RHO = [
  [0.025, 1.8397], [0.050, 1.6660], [0.075, 1.5485], [0.100, 1.4813],
  [0.125, 1.4372], [0.150, 1.4004], [0.175, 1.3783], [0.200, 1.3542],
  [0.225, 1.3398], [0.250, 1.3271], [0.275, 1.3168], [0.300, 1.3102],
  [0.350, 1.2982], [0.400, 1.2905], [0.450, 1.2861], [0.500, 1.2834],
  [0.600, 1.2813], [0.700, 1.2811],
];

/**
 * Linear interpolation into SHAPE_FACTOR_RHO, clamped at both ends. Clamping
 * is deliberate: below ~2.5% squeeze the contact band shrinks to a point and
 * the true conductance diverges logarithmically (an unsqueezed cord does not
 * seal at all), so extrapolating there would be meaningless rather than merely
 * inaccurate. Above 70% it has already flattened out to ~1.281.
 */
export function shapeFactorRho(squeeze) {
  const t = SHAPE_FACTOR_RHO;
  if (squeeze <= t[0][0]) return t[0][1];
  if (squeeze >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 1; i < t.length; i++) {
    if (squeeze <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      return y0 + ((y1 - y0) * (squeeze - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}

export function computeOringSI(r) {
  const d1 = convert(r.d1, r.d1Unit, LENGTH_UNITS);
  const d2 = convert(r.d2, r.d2Unit, LENGTH_UNITS);
  const compressionMode = r.compressionMode === "squeeze" ? "squeeze" : "groove";
  const widthMode = r.widthMode === "auto" ? "auto" : "manual";
  const P_SI = convert(r.permeability, r.permeabilityUnit, PERMEABILITY_UNITS);

  if (d1 <= 0 || d2 <= 0) {
    throw new Error("O-ring dimensions must be positive.");
  }
  if (P_SI <= 0) throw new Error("Permeability coefficient must be positive.");

  // How hard the cord is compressed can be given either way round. The
  // groove depth is the physically fixed one: a groove does not change
  // depth when you fit a different cord in it, so that is the input that
  // lets cord diameter actually matter (see below).
  let grooveDepth; // installed cord height = ellipse minor axis
  let squeeze;
  if (compressionMode === "groove") {
    grooveDepth = convert(r.grooveDepth, r.grooveDepthUnit, LENGTH_UNITS);
    if (!(grooveDepth > 0)) throw new Error("Groove depth must be positive.");
    if (grooveDepth > d2) {
      throw new Error("Groove depth cannot exceed the free cord diameter d2.");
    }
    squeeze = 1 - grooveDepth / d2;
  } else {
    const squeezePct = r.squeezePct ?? 0;
    if (!(squeezePct >= 0) || squeezePct >= 100) {
      throw new Error("Squeeze must be at least 0% and less than 100%.");
    }
    squeeze = squeezePct / 100;
    grooveDepth = d2 * (1 - squeeze);
  }

  // Incompressible ellipse: area is conserved, so squeezing the round cord
  // down to a height of `grooveDepth` bulges it sideways to a major axis of
  // d2^2 / grooveDepth. Gas crosses the seal along that major axis, so this
  // is the diffusion path length.
  const pathLength = d2 / (1 - squeeze); // === d2*d2 / grooveDepth
  const semiMajor = pathLength / 2;
  const semiMinor = grooveDepth / 2;

  // The face gas enters through is the cord's flank, but its *effective*
  // height is not simply the installed height: the diffusion field inside the
  // cross-section spreads, and the flow crowds around the edges of the two
  // contact bands. Both of the obvious guesses are wrong -- the flank's arc
  // length overstates it (and degenerates: as the ellipse elongates the
  // half-perimeter tends to the major axis, so w/L -> 1 and the model stops
  // responding to squeeze), while the plain installed height understates it by
  // ~35% at typical squeeze.
  //
  // SHAPE_FACTOR_RHO below is the correction, obtained by solving the real 2D
  // steady-diffusion field numerically (see docs/shape-factor.md): the cord is
  // modelled as an area-conserving truncated circle squashed between two
  // impermeable gland faces, with the left flank held at unit concentration
  // and the right at zero, and the conductance read off as the Dirichlet
  // energy. Being a 2D shape factor it is dimensionless and depends only on
  // the squeeze fraction, never on the cord diameter.
  const autoWidth = shapeFactorRho(squeeze) * grooveDepth;

  const width =
    widthMode === "auto" ? autoWidth : convert(r.width, r.widthUnit, LENGTH_UNITS);
  if (!(width > 0)) throw new Error("O-ring dimensions must be positive.");

  // The seal is an annulus, not a flat slab: gas leaves the inner flank at
  // radius r1 and reaches the outer flank at r2, spreading as it goes. The
  // exact steady conductance of a cylindrical shell is 2*pi*w / ln(r2/r1),
  // which reduces to the familiar A/L = pi*D_mean*w/L for a thin cord but
  // stays right when the installed cord is not thin. Same units (length),
  // so it drops straight into K = P_SI * geometryFactor.
  const r1 = d1 / 2;
  const r2 = r1 + pathLength;
  const geometryFactor = (2 * Math.PI * width) / Math.log(r2 / r1); // = A/L
  const K = P_SI * geometryFactor; // mol/(s*Pa) per unit deltaP

  return {
    d1, d2, width, widthMode, autoWidth,
    compressionMode, grooveDepth, squeeze, squeezePct: squeeze * 100,
    shapeRho: shapeFactorRho(squeeze),
    pathLength, semiMajor, semiMinor, r1, r2,
    P_SI, geometryFactor, K,
  };
}

/**
 * Core calculation. All inputs are plain numbers with an accompanying
 * unit key; internal math happens entirely in SI units.
 *
 * @param {object} p
 * @param {object[]} p.orings one or more O-rings sealing the compartment
 *   (see computeOringSI for each entry's shape) — their permeation flows
 *   add in parallel.
 * @param {number} p.volume compartment gas volume
 * @param {string} p.volumeUnit
 * @param {number} p.temperature operating temperature (must match the
 *   temperature each O-ring's permeability coefficient was measured/quoted at)
 * @param {string} p.temperatureUnit
 * @param {number} p.p0 initial compartment pressure (absolute)
 * @param {string} p.p0Unit
 * @param {number} p.pLock lockout pressure (absolute)
 * @param {string} p.pLockUnit
 * @param {number} p.pExt external/ambient partial pressure of the gas (absolute)
 * @param {string} p.pExtUnit
 * @param {number|null} [p.molarMass] kg/mol, required for mass-flow outputs
 */
export function computePermeation(p) {
  if (!Array.isArray(p.orings) || p.orings.length === 0) {
    throw new Error("At least one O-ring is required.");
  }

  const V = convert(p.volume, p.volumeUnit, VOLUME_UNITS);
  const T = temperatureToKelvin(p.temperature, p.temperatureUnit);
  const P0 = convert(p.p0, p.p0Unit, PRESSURE_UNITS);
  const Plock = convert(p.pLock, p.pLockUnit, PRESSURE_UNITS);
  const Pext = convert(p.pExt, p.pExtUnit, PRESSURE_UNITS);

  if (V <= 0) throw new Error("Compartment volume must be positive.");
  if (T <= 0) throw new Error("Temperature must be above absolute zero.");
  if (P0 <= 0 || Plock <= 0) throw new Error("Pressures must be positive.");
  if (Pext < 0) throw new Error("External pressure cannot be negative.");
  if (Plock <= Pext) {
    throw new Error(
      "Lockout pressure must be greater than the external/ambient partial pressure."
    );
  }
  if (P0 <= Plock) {
    throw new Error("Initial pressure must be greater than the lockout pressure.");
  }

  const orings = p.orings.map(computeOringSI);
  const K_total = orings.reduce((sum, r) => sum + r.K, 0); // mol/(s*Pa)

  // Time-constant of the exponential pressure decay: dP/dt = -alpha*(P-Pext)
  const alpha = (R_GAS * T * K_total) / V; // 1/s

  const tLockoutSeconds = Math.log((P0 - Pext) / (Plock - Pext)) / alpha;

  const molarFlow0 = K_total * (P0 - Pext); // mol/s, at t=0, all O-rings combined
  const volumetricFlow0_STP = molarFlow0 * V_MOLAR_STP; // m^3(STP)/s, at t=0

  const n0 = (P0 * V) / (R_GAS * T); // mol of gas in compartment initially
  const molarMass = p.molarMass ?? null; // kg/mol
  const massFlow0 = molarMass != null ? molarFlow0 * molarMass : null; // kg/s
  const mass0 = molarMass != null ? n0 * molarMass : null; // kg

  return {
    // SI intermediate values, exposed for the breakdown panel
    si: { V, T, P0, Plock, Pext, K_total, alpha },
    orings, // per-O-ring SI breakdown, in input order
    tLockoutSeconds,
    molarFlow0,
    volumetricFlow0_STP,
    n0,
    massFlow0,
    mass0,
    pressureAt(tSeconds) {
      return Pext + (P0 - Pext) * Math.exp(-alpha * tSeconds);
    },
  };
}

// ---------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------

export const SECONDS_PER = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  month: 86400 * 30.4368, // average Gregorian month
  year: 86400 * 365.2425, // average Gregorian year
};

export function secondsTo(seconds, unit) {
  return seconds / SECONDS_PER[unit];
}

export function bestDurationUnit(seconds) {
  const order = ["second", "minute", "hour", "day", "month", "year"];
  let chosen = order[0];
  for (const unit of order) {
    if (seconds / SECONDS_PER[unit] >= 1) chosen = unit;
  }
  return chosen;
}
