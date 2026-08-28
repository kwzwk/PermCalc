// PermCalc — gas loss through O-ring permeation
//
// Model summary (see README.md for full derivation):
//   - The O-ring is treated as a thin cylindrical band unrolled from the
//     torus: permeation area A = pi * d1 * d2, diffusion path length
//     L = d2 (the cross-section/cord diameter). This is the standard
//     first-order approximation used for elastomer seal permeation
//     estimates, and it means the cross-section diameter d2 cancels out
//     of the area/length ratio — the geometry factor reduces to
//     k = A / L = pi * d1. d2 is still required/shown so the breakdown is
//     transparent (and because it can be reintroduced by more detailed
//     models later).
//   - Steady-state Fickian permeation: molar flow Q = P_SI * k * deltaP.
//   - Mass balance on the compartment (ideal gas, constant V and T):
//       dP/dt = -(R*T/V) * P_SI * k * (P(t) - P_ext)
//     which integrates in closed form to an exponential decay.
//
// All internal computation uses SI base units (m, m^3, Pa, K, s, mol).

export const R_GAS = 8.314462618; // J/(mol*K)
export const V_MOLAR_STP = 22414e-6; // m^3/mol at 0 C, 1 atm (22,414 cm^3/mol)

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
 * Core calculation. All inputs are plain numbers with an accompanying
 * unit key; internal math happens entirely in SI units.
 *
 * @param {object} p
 * @param {number} p.d1 seal (mean) diameter of the O-ring
 * @param {string} p.d1Unit
 * @param {number} p.d2 cross-section (cord) diameter of the O-ring
 * @param {string} p.d2Unit
 * @param {number} p.volume compartment gas volume
 * @param {string} p.volumeUnit
 * @param {number} p.temperature operating temperature (must match the
 *   temperature the permeability coefficient was measured/quoted at)
 * @param {string} p.temperatureUnit
 * @param {number} p.permeability permeability coefficient value
 * @param {string} p.permeabilityUnit
 * @param {number} p.p0 initial compartment pressure (absolute)
 * @param {string} p.p0Unit
 * @param {number} p.pLock lockout pressure (absolute)
 * @param {string} p.pLockUnit
 * @param {number} p.pExt external/ambient partial pressure of the gas (absolute)
 * @param {string} p.pExtUnit
 * @param {number|null} [p.molarMass] kg/mol, required for mass-flow outputs
 */
export function computePermeation(p) {
  const d1 = convert(p.d1, p.d1Unit, LENGTH_UNITS);
  const d2 = convert(p.d2, p.d2Unit, LENGTH_UNITS);
  const V = convert(p.volume, p.volumeUnit, VOLUME_UNITS);
  const T = temperatureToKelvin(p.temperature, p.temperatureUnit);
  const P_SI = convert(p.permeability, p.permeabilityUnit, PERMEABILITY_UNITS);
  const P0 = convert(p.p0, p.p0Unit, PRESSURE_UNITS);
  const Plock = convert(p.pLock, p.pLockUnit, PRESSURE_UNITS);
  const Pext = convert(p.pExt, p.pExtUnit, PRESSURE_UNITS);

  if (d1 <= 0 || d2 <= 0) throw new Error("O-ring dimensions must be positive.");
  if (V <= 0) throw new Error("Compartment volume must be positive.");
  if (T <= 0) throw new Error("Temperature must be above absolute zero.");
  if (P_SI <= 0) throw new Error("Permeability coefficient must be positive.");
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

  const geometryFactor = Math.PI * d1; // = A/L, with A = pi*d1*d2, L = d2

  // Time-constant of the exponential pressure decay: dP/dt = -alpha*(P-Pext)
  const alpha = (R_GAS * T * P_SI * geometryFactor) / V; // 1/s

  const tLockoutSeconds = Math.log((P0 - Pext) / (Plock - Pext)) / alpha;

  const molarFlow0 = P_SI * geometryFactor * (P0 - Pext); // mol/s, at t=0
  const volumetricFlow0_STP = molarFlow0 * V_MOLAR_STP; // m^3(STP)/s, at t=0

  const n0 = (P0 * V) / (R_GAS * T); // mol of gas in compartment initially
  const molarMass = p.molarMass ?? null; // kg/mol
  const massFlow0 = molarMass != null ? molarFlow0 * molarMass : null; // kg/s
  const mass0 = molarMass != null ? n0 * molarMass : null; // kg

  return {
    // SI intermediate values, exposed for the breakdown panel
    si: { d1, d2, V, T, P_SI, P0, Plock, Pext, geometryFactor, alpha },
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
