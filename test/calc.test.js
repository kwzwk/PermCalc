import assert from "node:assert/strict";
import test from "node:test";
import {
  computePermeation,
  ellipsePerimeter,
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
    width: 3, widthUnit: "mm",
    squeezePct: 0,
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

test("thicker cord (d2 alone, width held fixed) means less permeation and longer time to lockout", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const thin = computePermeation({
    ...base,
    orings: [oring({ d2: 2, d2Unit: "mm", width: 3, widthUnit: "mm" })],
  });
  const thick = computePermeation({
    ...base,
    orings: [oring({ d2: 6, d2Unit: "mm", width: 3, widthUnit: "mm" })],
  });
  assert.ok(thick.tLockoutSeconds > thin.tLockoutSeconds);
  // Doubling d2 with width and d1 held fixed should exactly halve K (K ∝ 1/d2).
  assert.ok(Math.abs(thick.si.K_total * 3 - thin.si.K_total) / thin.si.K_total < 1e-9);
});

test("wider contact band alone means more permeation and shorter time to lockout", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const narrow = computePermeation({
    ...base,
    orings: [oring({ d2: 3, d2Unit: "mm", width: 1, widthUnit: "mm" })],
  });
  const wide = computePermeation({
    ...base,
    orings: [oring({ d2: 3, d2Unit: "mm", width: 4, widthUnit: "mm" })],
  });
  assert.ok(wide.tLockoutSeconds < narrow.tLockoutSeconds);
  // Quadrupling width with d1 and d2 held fixed should exactly quadruple K (K ∝ width).
  assert.ok(Math.abs(wide.si.K_total - 4 * narrow.si.K_total) / narrow.si.K_total < 1e-9);
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

test("squeeze bulges the cord into an ellipse, lengthening the path: less permeation", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const loose = computePermeation({ ...base, orings: [oring({ squeezePct: 0 })] });
  const tight = computePermeation({ ...base, orings: [oring({ squeezePct: 50 })] });

  assert.ok(tight.tLockoutSeconds > loose.tLockoutSeconds);
  // 50% squeeze doubles the major axis, so K exactly halves.
  assert.ok(Math.abs(tight.si.K_total - 0.5 * loose.si.K_total) / loose.si.K_total < 1e-9);
  // Reported path is the ellipse major axis d2/(1-squeeze).
  assert.ok(Math.abs(tight.orings[0].pathLength - 0.003 / 0.5) < 1e-12);
});

test("squeezed cross-section conserves area (incompressible ellipse)", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const d2 = 0.003; // 3 mm in SI
  for (const squeezePct of [0, 15, 25, 40]) {
    const r = computePermeation({ ...base, orings: [oring({ squeezePct })] }).orings[0];
    const major = r.pathLength;
    const minor = d2 * (1 - squeezePct / 100);
    const ellipseArea = Math.PI / 4 * major * minor;
    const circleArea = Math.PI / 4 * d2 * d2;
    assert.ok(
      Math.abs(ellipseArea - circleArea) / circleArea < 1e-12,
      `cross-section area must be conserved at ${squeezePct}% squeeze`
    );
  }
});

test("shrinking d2 alone still shortens the path and speeds up permeation, at any squeeze", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  for (const squeezePct of [0, 20, 40]) {
    const thick = computePermeation({ ...base, orings: [oring({ d2: 6, squeezePct })] });
    const thin = computePermeation({ ...base, orings: [oring({ d2: 2, squeezePct })] });
    assert.ok(
      thin.tLockoutSeconds < thick.tLockoutSeconds,
      `thinner cord should permeate faster at ${squeezePct}% squeeze`
    );
    // K ∝ 1/d2 with squeeze and width held fixed.
    assert.ok(Math.abs(thin.si.K_total - 3 * thick.si.K_total) / thick.si.K_total < 1e-9);
  }
});

test("squeeze must be within [0, 100)", () => {
  const base = {
    volume: 1, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 100, p0Unit: "bar",
    pLock: 50, pLockUnit: "bar",
    pExt: 0, pExtUnit: "bar",
  };
  assert.throws(
    () => computePermeation({ ...base, orings: [oring({ squeezePct: 100 })] }),
    /squeeze/i
  );
  assert.throws(
    () => computePermeation({ ...base, orings: [oring({ squeezePct: -5 })] }),
    /squeeze/i
  );
});

test("ellipsePerimeter reduces to a circle's circumference when a == b", () => {
  assert.ok(Math.abs(ellipsePerimeter(1.5, 1.5) - 2 * Math.PI * 1.5) < 1e-9);
  assert.ok(Math.abs(ellipsePerimeter(0.004, 0.004) - 2 * Math.PI * 0.004) < 1e-12);
});

test("auto face height is half the ellipse perimeter", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const r = computePermeation({
    ...base,
    orings: [oring({ d2: 3, d2Unit: "mm", squeezePct: 20, widthMode: "auto" })],
  }).orings[0];

  const expected = ellipsePerimeter(r.semiMajor, r.semiMinor) / 2;
  assert.ok(Math.abs(r.width - expected) / expected < 1e-12);
  // 3 mm cord at 20% squeeze -> ellipse 2.4 x 3.75 mm -> half perimeter ~4.889 mm
  assert.ok(Math.abs(r.width - 0.004889) < 2e-6, `got ${r.width}`);
});

test("auto mode makes the result independent of d2 (the ellipse scales with it)", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const ref = computePermeation({
    ...base, orings: [oring({ d2: 3, squeezePct: 20, widthMode: "auto" })],
  });
  for (const d2 of [1, 2, 6, 10]) {
    const other = computePermeation({
      ...base, orings: [oring({ d2, squeezePct: 20, widthMode: "auto" })],
    });
    assert.ok(
      Math.abs(other.si.K_total - ref.si.K_total) / ref.si.K_total < 1e-12,
      `auto mode should not depend on d2, but d2=${d2} differed`
    );
  }
});

test("manual mode keeps d2 sensitivity that auto mode gives up", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const thick = computePermeation({
    ...base, orings: [oring({ d2: 6, squeezePct: 20, widthMode: "manual" })],
  });
  const thin = computePermeation({
    ...base, orings: [oring({ d2: 2, squeezePct: 20, widthMode: "manual" })],
  });
  assert.ok(thin.tLockoutSeconds < thick.tLockoutSeconds);
});

test("auto mode still responds to squeeze", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const loose = computePermeation({ ...base, orings: [oring({ squeezePct: 0, widthMode: "auto" })] });
  const tight = computePermeation({ ...base, orings: [oring({ squeezePct: 40, widthMode: "auto" })] });
  assert.ok(tight.tLockoutSeconds > loose.tLockoutSeconds);
});

test("cord diameter cancels, but seal diameter does not: K scales linearly with d1", () => {
  const base = {
    volume: 1, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 0, pExtUnit: "bar",
  };
  const K = (d1, d2, width) =>
    computePermeation({ ...base, orings: [oring({ d1, d2, width, squeezePct: 20 })] }).si.K_total;

  // Same bore, fatter cord (d2 and w together, d1 fixed) -> unchanged.
  const ref = K(50, 3, 2.4);
  for (const k of [0.5, 2, 4]) {
    assert.ok(
      Math.abs(K(50, 3 * k, 2.4 * k) - ref) / ref < 1e-12,
      `cord scaling should cancel at fixed d1, but x${k} moved the result`
    );
  }

  // Scaling the WHOLE seal (d1 too) is NOT neutral: K is linear in d1.
  for (const k of [0.5, 2, 4]) {
    const scaled = K(50 * k, 3 * k, 2.4 * k);
    assert.ok(
      Math.abs(scaled - k * ref) / (k * ref) < 1e-12,
      `full geometric scaling by ${k} should give ${k}x K, got ${scaled / ref}x`
    );
  }
});

test("secondsTo converts across duration units", () => {
  assert.equal(secondsTo(3600, "hour"), 1);
  assert.ok(Math.abs(secondsTo(86400 * 365.2425, "year") - 1) < 1e-9);
});
