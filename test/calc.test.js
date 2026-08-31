import assert from "node:assert/strict";
import test from "node:test";
import {
  computePermeation,
  shapeFactorRho,
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
    compressionMode: "squeeze",
    squeezePct: 0,
    grooveDepth: 2.4, grooveDepthUnit: "mm",
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
  // Tripling d2 with width and d1 held fixed cuts K by ln(r2/r1) rather than
  // exactly 3x, because the flux spreads across the annulus as it crosses.
  const ratio = Math.log((25 + 6) / 25) / Math.log((25 + 2) / 25);
  assert.ok(
    Math.abs(thin.si.K_total / thick.si.K_total - ratio) < 1e-9,
    `got ${thin.si.K_total / thick.si.K_total}, expected ${ratio}`
  );
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
  // 50% squeeze doubles the major axis. In the annular form the conductance
  // goes as 1/ln(r2/r1), so K drops by ln(1.12)/ln(1.24), not exactly a half.
  const expectedRatio = Math.log(1.12) / Math.log(1.24);
  assert.ok(
    Math.abs(tight.si.K_total / loose.si.K_total - expectedRatio) < 1e-9,
    `got ${tight.si.K_total / loose.si.K_total}, expected ${expectedRatio}`
  );
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
    // K falls with d2 at fixed squeeze and width, but no longer as exactly
    // 1/d2: the annular form spreads the flux over a growing outer radius.
    assert.ok(thin.si.K_total > 2.5 * thick.si.K_total);
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


test("auto width reproduces the numerically-solved 2D shape factor", () => {
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

  // w = rho * installed height; 3 mm cord at 20% squeeze -> h = 2.4 mm.
  assert.ok(Math.abs(r.shapeRho - 1.3542) < 1e-9);
  assert.ok(Math.abs(r.width - 1.3542 * 0.0024) < 1e-12, `got ${r.width}`);

  // The whole point: w/L must equal the shape factor the 2D solve produced
  // for 20% squeeze (S = 0.86668, see docs/shape-factor.md).
  assert.ok(
    Math.abs(r.width / r.pathLength - 0.86668) < 1e-4,
    `w/L = ${r.width / r.pathLength}, expected the solved S = 0.86668`
  );
});

test("the shape factor is dimensionless: it depends on squeeze, never on d2", () => {
  for (const squeeze of [0.1, 0.2, 0.35]) {
    const ref = shapeFactorRho(squeeze);
    assert.ok(ref > 1.2 && ref < 1.6, `rho out of range at ${squeeze}`);
  }
  // Monotone decreasing, and clamped outside the solved range.
  let prev = Infinity;
  for (const sq of [0.03, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7]) {
    const v = shapeFactorRho(sq);
    assert.ok(v < prev, `rho must decrease with squeeze, failed at ${sq}`);
    prev = v;
  }
  assert.equal(shapeFactorRho(0), shapeFactorRho(0.025));
  assert.equal(shapeFactorRho(0.95), shapeFactorRho(0.7));
});

test("groove depth and squeeze % are two views of the same geometry", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const bySqueeze = computePermeation({
    ...base,
    orings: [oring({ d2: 3, squeezePct: 20, widthMode: "auto" })],
  });
  const byGroove = computePermeation({
    ...base,
    orings: [oring({
      d2: 3, compressionMode: "groove", grooveDepth: 2.4, grooveDepthUnit: "mm",
      widthMode: "auto",
    })],
  });
  assert.ok(
    Math.abs(byGroove.si.K_total - bySqueeze.si.K_total) / bySqueeze.si.K_total < 1e-12,
    "20% squeeze on a 3 mm cord must equal a 2.4 mm groove depth"
  );
  assert.ok(Math.abs(byGroove.orings[0].squeezePct - 20) < 1e-9);
});

test("in a FIXED GROOVE a fatter cord permeates markedly less (path grows as d2^2/h)", () => {
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const run = (d2) =>
    computePermeation({
      ...base,
      orings: [oring({
        d2, compressionMode: "groove", grooveDepth: 2.4, grooveDepthUnit: "mm",
        widthMode: "auto",
      })],
    });

  const cords = [2.5, 3, 4, 5, 6, 8];
  let prev = null;
  for (const d2 of cords) {
    const r = run(d2);
    // The path length is exactly d2^2 / h.
    assert.ok(
      Math.abs(r.orings[0].pathLength - (d2 * d2) / 2.4 / 1000) < 1e-12,
      `path length wrong at d2=${d2}`
    );
    if (prev) {
      assert.ok(
        r.tLockoutSeconds > prev.t,
        `a fatter cord in the same groove must last longer: d2=${d2} did not`
      );
      assert.ok(r.si.K_total < prev.K, `K must fall with d2 at fixed groove: d2=${d2}`);
    }
    prev = { t: r.tLockoutSeconds, K: r.si.K_total };
  }

  // Doubling the cord in the same groove is a large effect, not a rounding one.
  assert.ok(run(6).tLockoutSeconds > 3 * run(3).tLockoutSeconds);
});

test("at FIXED SQUEEZE %% the cross-section is self-similar, so d2 barely matters", () => {
  // This is the counterpart of the test above and is real physics, not a bug:
  // holding the squeeze RATIO fixed scales the whole cross-section with d2,
  // and 2D steady diffusion is scale-invariant. Only the annulus curvature
  // (the seal's finite radius) leaves any d2 dependence at all.
  const base = {
    volume: 2, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 1, pExtUnit: "bar",
  };
  const K = (d2) =>
    computePermeation({
      ...base, orings: [oring({ d1: 500, d2, squeezePct: 20, widthMode: "auto" })],
    }).si.K_total;

  // On a large-bore seal the cord is thin relative to the radius and the
  // cancellation is nearly exact over a 12x range of cord diameters.
  const ref = K(3);
  for (const d2 of [1, 2, 6, 12]) {
    assert.ok(
      Math.abs(K(d2) - ref) / ref < 0.05,
      `expected near-cancellation at fixed squeeze %, d2=${d2} moved it by ` +
        `${(100 * Math.abs(K(d2) - ref)) / ref}%`
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

test("scaling the whole seal is not neutral: bigger seal, more permeation", () => {
  const base = {
    volume: 1, volumeUnit: "L",
    temperature: 23, temperatureUnit: "C",
    p0: 200, p0Unit: "bar",
    pLock: 100, pLockUnit: "bar",
    pExt: 0, pExtUnit: "bar",
  };
  const K = (d1, d2, width) =>
    computePermeation({ ...base, orings: [oring({ d1, d2, width, squeezePct: 20 })] }).si.K_total;

  // Scaling every dimension by k scales the annulus radii by k too, so
  // ln(r2/r1) is unchanged and K is exactly linear in the scale factor.
  const ref = K(50, 3, 2.4);
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
