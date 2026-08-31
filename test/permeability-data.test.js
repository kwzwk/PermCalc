import assert from "node:assert/strict";
import test from "node:test";
import { PERMEABILITY_UNITS, GASES } from "../assets/calc.js";
import { PERMEABILITY_DATA } from "../assets/permeability-data.js";

test("permeability-data.js is in sync with data/permeability-coefficients.csv", () => {
  assert.equal(PERMEABILITY_DATA.length, 2);

  const epdm910 = PERMEABILITY_DATA.find((m) => m.name === "Freundeberg EPDM910");
  const epdm810 = PERMEABILITY_DATA.find((m) => m.name === "Freundeberg EPDM810");
  assert.ok(epdm910 && epdm810);

  assert.equal(epdm910.gas, "SF6");
  assert.equal(epdm810.gas, "SF6");
  assert.equal(epdm910.temperaturesC["20"], 0.94);
  assert.equal(epdm810.temperaturesC["20"], 9.4);
});

test("every material's unitKey resolves to a real PERMEABILITY_UNITS entry", () => {
  for (const material of PERMEABILITY_DATA) {
    assert.ok(
      material.unitKey in PERMEABILITY_UNITS,
      `unitKey "${material.unitKey}" for "${material.name}" is not a known permeability unit`
    );
  }
});

test("every material's gas resolves to a real GASES entry", () => {
  for (const material of PERMEABILITY_DATA) {
    assert.ok(
      material.gas in GASES,
      `gas "${material.gas}" for "${material.name}" is not a known gas key`
    );
  }
});
