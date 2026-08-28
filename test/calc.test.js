import assert from "node:assert/strict";
import test from "node:test";
import {
  computePermeation,
  convert,
  LENGTH_UNITS,
  PRESSURE_UNITS,
  PERMEABILITY_UNITS,
  V_MOLAR_STP,
  V_MOLAR_NTP,
  temperatureToKelvin,
  secondsTo,
} from "../assets/calc.js";

function oring(overrides = {}) {
  return {
    d1: 50, d1Unit: "mm",
    d2: 3, d2Unit: "mm",
    permeability: 15, permeabilityUnit: "barrer",
    ...overrides,
  };
}

test("unit conversions: length", () => {
  assert.equal(convert(10, "mm", LENGTH_UNITS), 0.01);
  assert.equal(convert(1, "in", LENGTH_UNITS), 0.0254);
});

test("unit conversions: pressure", () => {
  assert.ok(Math.abs(convert(1, "atm", PRESSURE_UNITS) - 101325) < 1e-6);
  assert.ok(Math.abs(convert(1, "bar", PRESSURE_UNITS) - 100000) < 1e-6);
});

test("unit conversions: temperature", () => {
  assert.equal(temperatureToKelvin(0, "C"), 273.15);
  assert.equal(temperatureToKelvin(273.15, "K"), 273.15);
  assert.ok(Math.abs(temperatureToKelvin(32, "F") - 273.15) < 1e-9);
});

test("1 Barrer is ~3.3465e-16 SI mol/(m*s*Pa)", () => {
  assert.ok(Math.abs(PERMEABILITY_UNITS.barrer - 3.3465e-16) < 1e-20);
});

test("practical_bar relates to practical (atm) by the atm/bar ratio", () => {
  const ratio = PRESSURE_UNITS.atm / PRESSURE_UNITS.bar; // bar is smaller -> bar-based factor is larger
  const actual = PERMEABILITY_UNITS.practical_bar / PERMEABILITY_UNITS.practical;
  // `practical` is a hand-rounded literal (~5 sig figs), so allow for that
  // rounding rather than requiring exact agreement with the freshly
  // computed practical_bar.
  assert.ok(Math.abs(actual - ratio) / ratio < 1e-3);
});

test("practical_mm2_bar is 1e6x practical_bar (mm^2 is 1e-6 of m^2)", () => {
  const ratio = PERMEABILITY_UNITS.practical_mm2_bar / PERMEABILITY_UNITS.practical_bar;
  assert.ok(Math.abs(ratio - 1e6) / 1e6 < 1e-9);
});

test("ntp_hour_bar matches a manual derivation from exported constants", () => {
  const expected = 0.001 / (1 * PRESSURE_UNITS.bar * (V_MOLAR_NTP * 1e6) * 3600);
  assert.ok(Math.abs(PERMEABILITY_UNITS.ntp_hour_bar - expected) / expected < 1e-9);
});

test("si_vol equals 1/V_MOLAR_STP (volumetric SI vs. molar SI)", () => {
  assert.ok(Math.abs(PERMEABILITY_UNITS.si_vol - 1 / V_MOLAR_STP) / PERMEABILITY_UNITS.si_vol < 1e-12);
});

test("si_vol permeability values give the same result as the equivalent si (mol-based) value", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const pMol = 1e-14; // arbitrary mol/(m*s*Pa)
  const pVol = pMol * V_MOLAR_STP; // equivalent m^3(STP)/(m*s*Pa)

  const viaMol = computePermeation({
    ...base,
    orings: [oring({ permeability: pMol, permeabilityUnit: "si" })],
  });
  const viaVol = computePermeation({
    ...base,
    orings: [oring({ permeability: pVol, permeabilityUnit: "si_vol" })],
  });
  assert.ok(
    Math.abs(viaMol.tLockoutSeconds - viaVol.tLockoutSeconds) / viaMol.tLockoutSeconds < 1e-9
  );
});

test("computePermeation rejects non-physical inputs", () => {
  const base = {
    orings: [oring()],
    volume: 1, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 100, p0Unit: "bar",
    pLock: 50, pLockUnit: "bar",
    pExt: 0, pExtUnit: "bar",
  };

  assert.throws(() => computePermeation({ ...base, pLock: 150 }), /greater than the lockout/);
  assert.throws(() => computePermeation({ ...base, pExt: 60 }), /greater than the external/);
  assert.throws(() => computePermeation({ ...base, orings: [oring({ d1: 0 })] }), /positive/);
  assert.throws(() => computePermeation({ ...base, orings: [] }), /at least one o-ring/i);
});

test("computePermeation: exponential decay reaches lockout pressure at t_lockout", () => {
  const result = computePermeation({
    orings: [oring()],
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
    molarMass: 0.0040026, // helium
  });

  assert.ok(result.tLockoutSeconds > 0);

  const pAtLockout = result.pressureAt(result.tLockoutSeconds);
  const pLockPa = convert(100, "bar", PRESSURE_UNITS);
  assert.ok(
    Math.abs(pAtLockout - pLockPa) / pLockPa < 1e-9,
    `expected pressure at t_lockout to equal Plock (got ${pAtLockout}, want ${pLockPa})`
  );

  // Pressure should be monotonically decreasing toward Pext.
  const p0Pa = convert(200, "bar", PRESSURE_UNITS);
  const pExtPa = convert(1, "bar", PRESSURE_UNITS);
  assert.ok(result.pressureAt(0) === p0Pa);
  const pFarFuture = result.pressureAt(result.tLockoutSeconds * 1000);
  assert.ok(pFarFuture >= pExtPa && pFarFuture < pLockPa);

  // Flow rates and derived quantities should be finite and positive.
  assert.ok(result.molarFlow0 > 0);
  assert.ok(result.volumetricFlow0_STP > 0);
  assert.ok(result.massFlow0 > 0);
  assert.ok(result.n0 > 0);
  assert.ok(result.mass0 > 0);
});

test("larger cross-section diameter d2 alone does not change time to lockout", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const thin = computePermeation({ ...base, orings: [oring({ d2: 2, d2Unit: "mm" })] });
  const thick = computePermeation({ ...base, orings: [oring({ d2: 6, d2Unit: "mm" })] });
  assert.ok(Math.abs(thin.tLockoutSeconds - thick.tLockoutSeconds) < 1e-6);
});

test("larger seal diameter d1 shortens time to lockout", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const small = computePermeation({ ...base, orings: [oring({ d1: 30, d1Unit: "mm" })] });
  const large = computePermeation({ ...base, orings: [oring({ d1: 90, d1Unit: "mm" })] });
  assert.ok(large.tLockoutSeconds < small.tLockoutSeconds);
});

test("multiple O-rings combine in parallel: two identical rings permeate twice as fast as one", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const one = computePermeation({ ...base, orings: [oring()] });
  const two = computePermeation({ ...base, orings: [oring(), oring()] });
  assert.ok(Math.abs(two.si.K_total - 2 * one.si.K_total) < 1e-30);
  assert.ok(Math.abs(two.molarFlow0 - 2 * one.molarFlow0) / one.molarFlow0 < 1e-9);
  // Faster loss -> shorter time to lockout.
  assert.ok(two.tLockoutSeconds < one.tLockoutSeconds);
});

test("a second, very low-permeability O-ring barely changes the result", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const one = computePermeation({ ...base, orings: [oring()] });
  const withTiny = computePermeation({
    ...base,
    orings: [oring(), oring({ permeability: 1e-6, permeabilityUnit: "barrer" })],
  });
  assert.ok(Math.abs(withTiny.tLockoutSeconds - one.tLockoutSeconds) / one.tLockoutSeconds < 1e-4);
});

test("secondsTo converts across duration units", () => {
  assert.equal(secondsTo(3600, "hour"), 1);
  assert.ok(Math.abs(secondsTo(86400 * 365.2425, "year") - 1) < 1e-9);
});
