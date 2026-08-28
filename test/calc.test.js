import assert from "node:assert/strict";
import test from "node:test";
import {
  computePermeation,
  convert,
  LENGTH_UNITS,
  PRESSURE_UNITS,
  PERMEABILITY_UNITS,
  temperatureToKelvin,
  secondsTo,
} from "../assets/calc.js";

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

test("computePermeation rejects non-physical inputs", () => {
  const base = {
    d1: 50, d1Unit: "mm",
    d2: 3, d2Unit: "mm",
    volume: 1, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    permeability: 10, permeabilityUnit: "barrer",
    p0: 100, p0Unit: "bar",
    pLock: 50, pLockUnit: "bar",
    pExt: 0, pExtUnit: "bar",
  };

  assert.throws(() => computePermeation({ ...base, pLock: 150 }), /greater than the lockout/);
  assert.throws(() => computePermeation({ ...base, pExt: 60 }), /greater than the external/);
  assert.throws(() => computePermeation({ ...base, d1: 0 }), /positive/);
});

test("computePermeation: exponential decay reaches lockout pressure at t_lockout", () => {
  const result = computePermeation({
    d1: 50, d1Unit: "mm",
    d2: 3, d2Unit: "mm",
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    permeability: 15, permeabilityUnit: "barrer",
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
    d1: 50, d1Unit: "mm",
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    permeability: 15, permeabilityUnit: "barrer",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const thin = computePermeation({ ...base, d2: 2, d2Unit: "mm" });
  const thick = computePermeation({ ...base, d2: 6, d2Unit: "mm" });
  assert.ok(Math.abs(thin.tLockoutSeconds - thick.tLockoutSeconds) < 1e-6);
});

test("larger seal diameter d1 shortens time to lockout", () => {
  const base = {
    d2: 3, d2Unit: "mm",
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    permeability: 15, permeabilityUnit: "barrer",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const small = computePermeation({ ...base, d1: 30, d1Unit: "mm" });
  const large = computePermeation({ ...base, d1: 90, d1Unit: "mm" });
  assert.ok(large.tLockoutSeconds < small.tLockoutSeconds);
});

test("secondsTo converts across duration units", () => {
  assert.equal(secondsTo(3600, "hour"), 1);
  assert.ok(Math.abs(secondsTo(86400 * 365.2425, "year") - 1) < 1e-9);
});
