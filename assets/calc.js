// PermCalc — gas loss through O-ring permeation
//
// Model summary (see README.md for full derivation):
//   - Each O-ring seals along a band around its torus. Squeezing the cord
//     deforms its circular cross-section into an equal-area ellipse, and
//     gas crosses the seal along that ellipse's major axis, so the
//     diffusion path is L = d2 / (1 - squeeze). A thicker cord is a longer
//     barrier (permeation drops as d2 rises); squeezing harder makes the
//     cord bulge wider, lengthening the path (permeation drops with
//     squeeze too).
//     The exposed area that band diffuses through is A = pi * d1 * w,
//     where "w" is the exposed face height: the height of the face gas
//     enters through, measured along the squeeze axis. It is either
//     derived from the ellipse (half its perimeter) or given directly. This keeps a real, standard
//     permeability coefficient (Barrer, SI, ...) dimensionally valid:
//     the geometry factor k = A / L has units of length, as required by
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
 * The installed O-ring is squeezed in its gland. Rubber is essentially
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
export function ellipsePerimeter(a, b) {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

export function computeOringSI(r) {
  const d1 = convert(r.d1, r.d1Unit, LENGTH_UNITS);
  const d2 = convert(r.d2, r.d2Unit, LENGTH_UNITS);
  const squeezePct = r.squeezePct ?? 0;
  const widthMode = r.widthMode === "auto" ? "auto" : "manual";
  const P_SI = convert(r.permeability, r.permeabilityUnit, PERMEABILITY_UNITS);

  if (d1 <= 0 || d2 <= 0) {
    throw new Error("O-ring dimensions must be positive.");
  }
  if (!(squeezePct >= 0) || squeezePct >= 100) {
    throw new Error("Squeeze must be at least 0% and less than 100%.");
  }
  if (P_SI <= 0) throw new Error("Permeability coefficient must be positive.");

  const squeeze = squeezePct / 100;
  // Incompressible ellipse: area conserved, so minor = d2*(1-squeeze)
  // and major = d2/(1-squeeze). Gas crosses along the major axis.
  const pathLength = d2 / (1 - squeeze);
  const semiMajor = pathLength / 2;
  const semiMinor = (d2 * (1 - squeeze)) / 2;

  // Half the ellipse's perimeter: the arc facing the high-pressure side,
  // which is the surface gas actually enters through.
  const autoWidth = ellipsePerimeter(semiMajor, semiMinor) / 2;

  const width =
    widthMode === "auto" ? autoWidth : convert(r.width, r.widthUnit, LENGTH_UNITS);
  if (!(width > 0)) throw new Error("O-ring dimensions must be positive.");

  const geometryFactor = (Math.PI * d1 * width) / pathLength; // = A/L
  const K = P_SI * geometryFactor; // mol/(s*Pa) per unit deltaP

  return {
    d1, d2, width, widthMode, autoWidth, squeezePct,
    pathLength, semiMajor, semiMinor, P_SI, geometryFactor, K,
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
