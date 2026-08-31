import {
  computePermeation,
  GASES,
  LENGTH_UNITS,
  PRESSURE_UNITS,
  VOLUME_UNITS,
  PERMEABILITY_UNITS,
  R_GAS,
  V_MOLAR_STP,
  secondsTo,
  bestDurationUnit,
} from "./calc.js";
import { PERMEABILITY_DATA } from "./permeability-data.js";

const $ = (id) => document.getElementById(id);

// ---- populate gas dropdown -------------------------------------------------
const gasSelect = $("gas");
for (const [key, gas] of Object.entries(GASES)) {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = gas.label;
  gasSelect.appendChild(opt);
}
gasSelect.value = "He";

const customRow = $("custom-molar-mass-row");
gasSelect.addEventListener("change", () => {
  customRow.style.display = gasSelect.value === "custom" ? "grid" : "none";
  oringList.querySelectorAll(".oring-card").forEach(refreshMaterialOptions);
});

function currentMolarMassKgPerMol() {
  const key = gasSelect.value;
  const gas = GASES[key];
  if (gas.molarMass != null) return gas.molarMass;
  const grams = parseFloat($("molarMass").value);
  return Number.isFinite(grams) && grams > 0 ? grams / 1000 : null;
}

// ---- O-ring cards -----------------------------------------------------------
const oringList = $("oring-list");
const oringTemplate = $("oring-template");

function renumberOrings() {
  const cards = oringList.querySelectorAll(".oring-card");
  cards.forEach((card, i) => {
    card.querySelector(".oring-card-title").textContent = `O-ring ${i + 1}`;
    card.querySelector(".remove-oring").disabled = cards.length === 1;
  });
}

function materialsForCurrentGas() {
  return PERMEABILITY_DATA.filter((m) => m.gas === gasSelect.value);
}

function populateMaterialTempSelect(node) {
  const tempSelect = node.querySelector(".oring-material-temp");
  const materialSelect = node.querySelector(".oring-material");
  const material = materialsForCurrentGas().find((m) => m.name === materialSelect.value);
  tempSelect.innerHTML = "";
  if (!material) {
    tempSelect.appendChild(new Option("temperature", ""));
    tempSelect.disabled = true;
    return;
  }
  tempSelect.disabled = false;
  tempSelect.appendChild(new Option("select temperature…", ""));
  for (const tempC of Object.keys(material.temperaturesC).map(Number).sort((a, b) => a - b)) {
    tempSelect.appendChild(new Option(`${tempC} °C`, String(tempC)));
  }
}

// Refills the material dropdown with only the entries matching the
// currently selected gas. If none match, there's nothing useful to pick
// from, so the whole "Reference material" row is hidden and the plain
// permeability input below is the only way to enter a value.
function refreshMaterialOptions(node) {
  const materials = materialsForCurrentGas();
  const row = node.querySelector(".oring-material-row");
  const materialSelect = node.querySelector(".oring-material");

  row.style.display = materials.length === 0 ? "none" : "grid";

  materialSelect.innerHTML = "";
  materialSelect.appendChild(new Option("— none, enter manually —", ""));
  for (const material of materials) {
    materialSelect.appendChild(new Option(material.name, material.name));
  }
  populateMaterialTempSelect(node);
}

const round4 = (x) => Number(x.toFixed(4));

function addOring() {
  const node = oringTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".remove-oring").addEventListener("click", () => {
    node.remove();
    renumberOrings();
  });

  node.querySelector(".oring-material").addEventListener("change", () => populateMaterialTempSelect(node));
  node.querySelector(".oring-material-temp").addEventListener("change", (e) => {
    const tempC = e.target.value;
    if (tempC === "") return;
    const materialSelect = node.querySelector(".oring-material");
    const material = materialsForCurrentGas().find((m) => m.name === materialSelect.value);
    node.querySelector(".oring-permeability").value = material.temperaturesC[tempC];
    node.querySelector(".oring-permeabilityUnit").value = material.unitKey;
  });
  // Swap which compression field is live. Whichever is hidden carries over
  // the value implied by the other, so flipping the mode never jumps the
  // answer -- it just changes which quantity is pinned when d2 moves.
  const modeSelect = node.querySelector(".oring-compressionMode");
  const syncCompressionMode = () => {
    const groove = modeSelect.value === "groove";
    node.querySelector(".oring-groove-wrap").hidden = !groove;
    node.querySelector(".oring-squeeze-wrap").hidden = groove;
  };
  modeSelect.addEventListener("change", () => {
    const d2Input = node.querySelector(".oring-d2");
    const d2 = parseFloat(d2Input.value);
    const d2Unit = node.querySelector(".oring-d2Unit").value;
    const grooveInput = node.querySelector(".oring-grooveDepth");
    const grooveUnit = node.querySelector(".oring-grooveDepthUnit").value;
    const squeezeInput = node.querySelector(".oring-squeeze");
    if (Number.isFinite(d2) && d2 > 0) {
      if (modeSelect.value === "squeeze") {
        const h = parseFloat(grooveInput.value) * LENGTH_UNITS[grooveUnit];
        const d2m = d2 * LENGTH_UNITS[d2Unit];
        if (Number.isFinite(h) && h > 0 && h <= d2m) {
          squeezeInput.value = round4(100 * (1 - h / d2m));
        }
      } else {
        const sq = parseFloat(squeezeInput.value) / 100;
        if (Number.isFinite(sq) && sq >= 0 && sq < 1) {
          grooveInput.value = round4((d2 * LENGTH_UNITS[d2Unit] * (1 - sq)) / LENGTH_UNITS[grooveUnit]);
        }
      }
    }
    syncCompressionMode();
  });
  syncCompressionMode();

  refreshMaterialOptions(node);

  oringList.appendChild(node);
  renumberOrings();
  return node;
}

$("add-oring").addEventListener("click", () => addOring());

// ---- number formatting ------------------------------------------------------
function fmt(value, sig = 3) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(sig - 1);
  const digits = Math.max(0, sig - Math.ceil(Math.log10(abs)));
  return value.toFixed(Math.min(digits, 6)).replace(/\.?0+$/, (m) =>
    m.includes(".") ? "" : m
  );
}

function fmtDuration(seconds) {
  const unit = bestDurationUnit(seconds);
  const val = secondsTo(seconds, unit);
  const label = unit + (val === 1 ? "" : "s");
  return `${fmt(val)} ${label}`;
}

// ---- form -> params ----------------------------------------------------------
function readOrings() {
  const cards = oringList.querySelectorAll(".oring-card");
  return Array.from(cards).map((card) => ({
    d1: parseFloat(card.querySelector(".oring-d1").value),
    d1Unit: card.querySelector(".oring-d1Unit").value,
    d2: parseFloat(card.querySelector(".oring-d2").value),
    d2Unit: card.querySelector(".oring-d2Unit").value,
    width: parseFloat(card.querySelector(".oring-width").value),
    widthUnit: card.querySelector(".oring-widthUnit").value,
    widthMode: card.querySelector(".oring-widthMode").value,
    compressionMode: card.querySelector(".oring-compressionMode").value,
    squeezePct: parseFloat(card.querySelector(".oring-squeeze").value),
    grooveDepth: parseFloat(card.querySelector(".oring-grooveDepth").value),
    grooveDepthUnit: card.querySelector(".oring-grooveDepthUnit").value,
    permeability: parseFloat(card.querySelector(".oring-permeability").value),
    permeabilityUnit: card.querySelector(".oring-permeabilityUnit").value,
  }));
}

function readParams() {
  const v = (id) => parseFloat($(id).value);
  return {
    orings: readOrings(),
    volume: v("volume"), volumeUnit: $("volumeUnit").value,
    temperature: v("temperature"), temperatureUnit: $("temperatureUnit").value,
    p0: v("p0"), p0Unit: $("p0Unit").value,
    pLock: v("pLock"), pLockUnit: $("pLockUnit").value,
    pExt: v("pExt"), pExtUnit: $("pExtUnit").value,
    geometryModel: $("geometryModel").value,
    pathModel: $("pathModel").value,
    modelFactor: v("modelFactor"),
    molarMass: currentMolarMassKgPerMol(),
  };
}

function showError(message) {
  const box = $("error-box");
  box.textContent = message;
  box.style.display = message ? "block" : "none";
}

// ---- chart --------------------------------------------------------------------
function drawChart(result) {
  const canvas = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 860;
  const cssHeight = 280;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const pad = { left: 60, right: 20, top: 16, bottom: 34 };
  const w = cssWidth - pad.left - pad.right;
  const h = cssHeight - pad.top - pad.bottom;

  const tMax = result.tLockoutSeconds * 1.15;
  const { P0, Plock, Pext } = result.si;
  const pMax = P0 * 1.03;
  const pMin = Math.max(0, Pext - (P0 - Pext) * 0.03);

  const xOf = (t) => pad.left + (t / tMax) * w;
  const yOf = (pPa) => pad.top + h - ((pPa - pMin) / (pMax - pMin)) * h;

  // axes
  ctx.strokeStyle = "#2a3350";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + h);
  ctx.lineTo(pad.left + w, pad.top + h);
  ctx.stroke();

  // lockout threshold line
  ctx.strokeStyle = "#f5a524";
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, yOf(Plock));
  ctx.lineTo(pad.left + w, yOf(Plock));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#f5a524";
  ctx.font = "11px sans-serif";
  ctx.fillText("lockout pressure", pad.left + 6, yOf(Plock) - 6);

  // pressure curve
  ctx.strokeStyle = "#5ec8ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * tMax;
    const p = result.pressureAt(t);
    const x = xOf(t);
    const y = yOf(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // marker at t_lockout
  const mx = xOf(result.tLockoutSeconds);
  const my = yOf(Plock);
  ctx.fillStyle = "#8b7bff";
  ctx.beginPath();
  ctx.arc(mx, my, 4, 0, Math.PI * 2);
  ctx.fill();

  // axis labels
  ctx.fillStyle = "#9aa4c0";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`0`, pad.left - 4, pad.top + h + 16);
  ctx.textAlign = "right";
  const durUnit = bestDurationUnit(tMax);
  ctx.fillText(`${fmt(secondsTo(tMax, durUnit))} ${durUnit}s`, pad.left + w, pad.top + h + 16);
  ctx.textAlign = "center";
  ctx.fillText(`time (${durUnit}s)`, pad.left + w / 2, pad.top + h + 28);

  ctx.save();
  ctx.translate(14, pad.top + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(`compartment pressure (Pa)`, 0, 0);
  ctx.restore();

  ctx.textAlign = "right";
  ctx.fillText(fmt(pMax), pad.left - 6, pad.top + 10);
  ctx.fillText(fmt(pMin), pad.left - 6, pad.top + h);
}

// ---- breakdown table ----------------------------------------------------------
function renderBreakdown(result) {
  const s = result.si;
  const rows = [
    ["Calculation model", `${result.orings[0].geometryModel}; L = ${result.orings[0].pathModel}; calibration ${fmt(result.orings[0].modelFactor)}×`],
    ["Decay time-constant α", `${fmt(s.alpha)} s⁻¹  (1/α = ${fmtDuration(1 / s.alpha)})`],
    ["Combined geometry×permeability  K_total = Σ(P · 2π·w / ln(r₂/r₁))", `${fmt(s.K_total)} mol/(s·Pa)`],
    ["P₀ (SI)", `${fmt(s.P0)} Pa`],
    ["Lockout pressure (SI)", `${fmt(s.Plock)} Pa`],
    ["External pressure (SI)", `${fmt(s.Pext)} Pa`],
    ["Operating temperature", `${fmt(s.T)} K`],
    ["Compartment volume (SI)", `${fmt(s.V)} m³`],
  ];
  result.orings.forEach((r, i) => {
    const share = (100 * r.K / s.K_total).toFixed(1);
    rows.push([
      `O-ring ${i + 1}: d1 / d2 / w / P (SI)`,
      `${fmt(r.d1)} m / ${fmt(r.d2)} m / ${fmt(r.width)} m${r.widthMode === "auto" ? " (auto)" : ""} / ${fmt(r.P_SI)} mol/(m·s·Pa)  — ${share}% of total loss`,
    ]);
    rows.push([
      `O-ring ${i + 1}: diffusion path  d2² ÷ groove depth  [ellipse major axis]`,
      `${fmt(r.d2)}² m ÷ ${fmt(r.grooveDepth)} m = ${fmt(r.pathLength)} m`
        + `   (squeeze ${r.squeezePct.toFixed(1)}%)`,
    ]);
  });
  const table = $("breakdown-table");
  table.innerHTML =
    "<tr><th>Quantity</th><th>Value</th></tr>" +
    rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
}


// ---- worked calculation --------------------------------------------------
// Re-derives the headline number step by step from the values on screen, so
// the result can be checked by hand rather than taken on trust.
const PERM_UNIT_LABEL = {
  barrer: "Barrer",
  traditional: "cm3(STP)*cm/(cm2*s*cmHg)",
  practical: "cm3(STP)*mm/(m2*day*atm)",
  practical_bar: "cm3(STP)*mm/(m2*day*bar)",
  practical_mm2_bar: "cm3(STP)*mm/(mm2*day*bar)",
  ntp_hour_bar: "cm3(NTP)*mm/(m2*h*bar)",
  si: "mol/(m*s*Pa)",
  si_vol: "m3(STP)/(m*s*Pa)",
};

// 6 significant digits, switching to exponent form where that reads better.
function g(v) {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(5);
  return String(Number(v.toPrecision(6)));
}

function pad(label, width = 26) {
  return label + " ".repeat(Math.max(1, width - label.length));
}

function wcStep(n, title, lines, note) {
  return (
    `<div class="wc-step">` +
    `<div class="wc-step-head"><span class="wc-num">${n}</span>${title}</div>` +
    (note ? `<p class="wc-step-note">${note}</p>` : "") +
    `<div class="wc-block"><pre>${lines.join("\n")}</pre></div>` +
    `</div>`
  );
}

function renderWorkedCalc(result, params) {
  const s = result.si;
  const out = [];
  const nRings = result.orings.length;

  // 1 — inputs to SI
  const l1 = [
    `${pad("compartment volume")}${params.volume} ${params.volumeUnit}`
      + ` × ${g(VOLUME_UNITS[params.volumeUnit])} = ${g(s.V)} m³`,
    `${pad("operating temperature")}${params.temperature} °${params.temperatureUnit}`
      + ` = ${g(s.T)} K`,
    `${pad("initial pressure P0")}${params.p0} ${params.p0Unit}`
      + ` × ${g(PRESSURE_UNITS[params.p0Unit])} = ${g(s.P0)} Pa`,
    `${pad("lockout pressure")}${params.pLock} ${params.pLockUnit}`
      + ` × ${g(PRESSURE_UNITS[params.pLockUnit])} = ${g(s.Plock)} Pa`,
    `${pad("external partial pressure")}${params.pExt} ${params.pExtUnit}`
      + ` × ${g(PRESSURE_UNITS[params.pExtUnit])} = ${g(s.Pext)} Pa`,
  ];
  out.push(wcStep(1, "Convert inputs to SI", l1));

  // 2 — per O-ring geometry
  result.orings.forEach((r, i) => {
    const raw = params.orings[i];
    const sq = r.squeeze;
    const minor = r.grooveDepth;
    const lines = [
      `${pad("d1 (inner diameter)")}${raw.d1} ${raw.d1Unit} = ${g(r.d1)} m`,
      `${pad("d2 (free cord)")}${raw.d2} ${raw.d2Unit} = ${g(r.d2)} m`,
      r.compressionMode === "groove"
        ? `${pad("groove depth h")}${raw.grooveDepth} ${raw.grooveDepthUnit} = ${g(minor)} m`
            + `   ->  squeeze = 1 − h/d2 = ${g(sq)}`
        : `${pad("squeeze")}${(sq * 100).toFixed(4).replace(/\.?0+$/, "")} %`
            + `   ->  h = d2·(1−sq) = ${g(minor)} m`,
      ``,
      `squeezed cross-section (equal-area ellipse):`,
      `${pad("  minor = h")}${g(minor)} m   (the installed height)`,
      `${pad("  major = d2² ÷ h")}${g(r.d2)}² ÷ ${g(minor)} = ${g(r.ellipseMajor)} m`,
      `${pad("  area (π/4·maj·min)")}${g((Math.PI / 4) * r.ellipseMajor * minor)} m²`
        + `   = free circle π/4·d2² = ${g((Math.PI / 4) * r.d2 * r.d2)} m²`,
      ``,
      `${pad("L  = diffusion path")}${g(r.pathLength)} m   (${
        r.pathModel === "ellipse" ? "the ellipse major axis" : "the free cord diameter d2"})`,
      ...(r.widthMode === "auto"
        ? [
            `${pad("shape factor S (2D solve)")}ρ(${g(sq)}) × (1−sq)² = ${g(r.shapeRho)} × `
              + `${g((1 - sq) ** 2)} = ${g(r.shapeFactor)}   (dimensionless)`,
            `${pad("w  = S · L")}${g(r.shapeFactor)} × ${g(r.pathLength)} = ${g(r.width)} m   (auto)`,
          ]
        : [`${pad("w  = exposed face height")}${raw.width} ${raw.widthUnit} = ${g(r.width)} m   (manual)`]),
      ``,
      ...(r.geometryModel === "annular"
        ? [
            `annular model (gas fans outward as it crosses):`,
            `${pad("  mean diameter d1+d2")}${g(r.meanDiameter)} m`,
            `${pad("  r₁ = (d1+d2)/2 − L/2")}${g(r.r1)} m`,
            `${pad("  r₂ = (d1+d2)/2 + L/2")}${g(r.r2)} m`,
            `${pad("  G = 2π·w/ln(r₂/r₁)")}2π × ${g(r.width)} ÷ ln(${g(r.r2 / r.r1)})`
              + ` = ${g(r.annularGeometryFactor)} m`,
            `${pad("  (planar cross-check)")}π·(d1+d2)·w/L = ${g(r.planarGeometryFactor)} m`,
          ]
        : [
            `planar model (flat slab of area A, thickness L):`,
            `${pad("  circumference π(d1+d2)")}π × ${g(r.meanDiameter)} = ${g(r.circumference)} m`,
            `${pad("  A = circumference · w")}${g(r.circumference)} × ${g(r.width)} = ${g(r.exposedArea)} m²`,
            `${pad("  G = A / L")}${g(r.exposedArea)} ÷ ${g(r.pathLength)} = ${g(r.planarGeometryFactor)} m`,
            `${pad("  (annular cross-check)")}2π·w/ln(r₂/r₁) = ${g(r.annularGeometryFactor)} m`,
          ]),
      ...(r.modelFactor !== 1
        ? [``, `${pad("calibration factor")}× ${g(r.modelFactor)}  ->  G = ${g(r.geometryFactor)} m`]
        : []),
    ];
    out.push(wcStep(2 + i, `O-ring ${i + 1} — geometry`, lines));
  });

  // 3 — permeability + K per ring
  const stepK = 2 + nRings;
  const lK = [];
  result.orings.forEach((r, i) => {
    const raw = params.orings[i];
    const unitLabel = PERM_UNIT_LABEL[raw.permeabilityUnit] || raw.permeabilityUnit;
    lK.push(
      `O-ring ${i + 1}:`,
      `${pad("  P (as entered)")}${raw.permeability} ${unitLabel}`,
      `${pad("  P -> SI")}${raw.permeability} × ${g(PERMEABILITY_UNITS[raw.permeabilityUnit])}`
        + ` = ${g(r.P_SI)} mol/(m·s·Pa)`,
      `${pad("  K = P · A/L")}${g(r.P_SI)} × ${g(r.geometryFactor)} = ${g(r.K)} mol/(s·Pa)`,
      ``
    );
  });
  lK.push(
    nRings > 1
      ? `${pad("K_total = Σ K")}${result.orings.map((r) => g(r.K)).join("  +  ")}`
          + ` = ${g(s.K_total)} mol/(s·Pa)`
      : `${pad("K_total")}${g(s.K_total)} mol/(s·Pa)   (single O-ring)`
  );
  out.push(
    wcStep(stepK, "Permeability → conductance", lK,
      "Each O-ring vents the same compartment in parallel, so their conductances add.")
  );

  // 4 — decay constant
  const lA = [
    `α = R · T · K_total / V`,
    `  = ${g(R_GAS)} × ${g(s.T)} × ${g(s.K_total)} ÷ ${g(s.V)}`,
    `  = ${g(s.alpha)} s⁻¹`,
    ``,
    `time constant 1/α = ${g(1 / s.alpha)} s = ${fmtDuration(1 / s.alpha)}`,
  ];
  out.push(
    wcStep(stepK + 1, "Pressure-decay constant", lA,
      "From the ideal-gas mass balance dP/dt = −α·(P − P_ext).")
  );

  // 5 — time to lockout
  const num = s.P0 - s.Pext;
  const den = s.Plock - s.Pext;
  const lT = [
    `t = ln[ (P0 − P_ext) / (P_lock − P_ext) ] / α`,
    `  = ln[ (${g(s.P0)} − ${g(s.Pext)}) / (${g(s.Plock)} − ${g(s.Pext)}) ] ÷ ${g(s.alpha)}`,
    `  = ln[ ${g(num)} / ${g(den)} ] ÷ ${g(s.alpha)}`,
    `  = ${g(Math.log(num / den))} ÷ ${g(s.alpha)}`,
    `  = ${g(result.tLockoutSeconds)} s`,
    ``,
    `<span class="wc-result">= ${g(secondsTo(result.tLockoutSeconds, "day"))} days`
      + `   =  ${g(secondsTo(result.tLockoutSeconds, "year"))} years</span>`,
  ];
  out.push(wcStep(stepK + 2, "Time to lockout pressure", lT));

  // 6 — derived outputs
  const lD = [
    `${pad("n0 = P0·V/(R·T)")}${g(s.P0)} × ${g(s.V)} ÷ (${g(R_GAS)} × ${g(s.T)})`
      + ` = ${g(result.n0)} mol`,
    `${pad("Q0 = K_total·(P0−P_ext)")}${g(s.K_total)} × ${g(num)} = ${g(result.molarFlow0)} mol/s`,
    `${pad("   in cm³(STP)/min")}${g(result.molarFlow0)} × ${g(V_MOLAR_STP)} × 1e6 × 60`
      + ` = ${g(result.volumetricFlow0_STP * 1e6 * 60)}`,
  ];
  if (result.massFlow0 != null) {
    const M = currentMolarMassKgPerMol();
    lD.push(
      `${pad("   in g/day")}${g(result.molarFlow0)} × ${g(M)} × 86400 × 1000`
        + ` = ${g(result.massFlow0 * 86400 * 1000)}`,
      `${pad("initial charge mass")}${g(result.n0)} × ${g(M)} × 1000 = ${g(result.mass0 * 1000)} g`
    );
  }
  out.push(wcStep(stepK + 3, "Derived outputs", lD));

  $("worked-calc-body").innerHTML = out.join("");
}

// ---- main -----------------------------------------------------------------------
// Recalculates and re-renders from the form's current values. Called on
// every input/change (not just on Calculate) so the displayed result
// never goes stale relative to what's actually in the fields — changing
// a dimension and not pressing the button used to leave the old result
// on screen, which reads as "changing this input does nothing."
function recalculate() {
  showError("");
  const params = readParams();

  if (params.orings.length === 0) {
    showError("Add at least one O-ring.");
    return;
  }
  for (const [i, r] of params.orings.entries()) {
    for (const [key, value] of Object.entries(r)) {
      if (key === "width" && r.widthMode === "auto") continue;
      if (key === "squeezePct" && r.compressionMode !== "squeeze") continue;
      if (key === "grooveDepth" && r.compressionMode !== "groove") continue;
      if (typeof value === "number" && !Number.isFinite(value)) {
        showError(`O-ring ${i + 1}: "${key}" is missing or not a number.`);
        return;
      }
    }
  }
  for (const key of ["volume", "temperature", "p0", "pLock", "pExt", "modelFactor"]) {
    if (!Number.isFinite(params[key])) {
      showError(`Please fill in all fields — "${key}" is missing or not a number.`);
      return;
    }
  }

  let result;
  try {
    result = computePermeation(params);
  } catch (err) {
    showError(err.message);
    return;
  }

  $("results-placeholder").style.display = "none";
  $("results-body").style.display = "block";

  $("stat-time").textContent = fmtDuration(result.tLockoutSeconds);
  $("stat-time-alt").textContent =
    `${fmt(secondsTo(result.tLockoutSeconds, "day"))} days · ` +
    `${fmt(secondsTo(result.tLockoutSeconds, "year"))} years`;

  const rateSTP_cm3_min = result.volumetricFlow0_STP * 1e6 * 60; // m^3/s(STP) -> cm3/min
  $("stat-rate").textContent = `${fmt(rateSTP_cm3_min)} cm³(STP)/min`;
  $("stat-rate-mass").textContent =
    result.massFlow0 != null
      ? `${fmt(result.massFlow0 * 86400 * 1000)} g/day  (${fmt(
          result.massFlow0 * 86400 * 365.2425 * 1000
        )} g/yr)`
      : "set gas molar mass for mass rate";

  $("stat-charge").textContent = `${fmt(result.n0)} mol`;
  $("stat-charge-mass").textContent =
    result.mass0 != null ? `${fmt(result.mass0 * 1000)} g` : "";

  syncAutoWidths(result);
  drawChart(result);
  renderBreakdown(result);
  renderWorkedCalc(result, params);
}

// In "auto" mode the face height is derived from the shape factor, so show the
// computed value in the (disabled) input rather than leaving a stale number
// the user might think is being used. Setting .value in script does not
// re-fire input events, so this cannot loop.
function syncAutoWidths(result) {
  const cards = oringList.querySelectorAll(".oring-card");
  cards.forEach((card, i) => {
    const r = result.orings[i];
    if (!r) return;
    const input = card.querySelector(".oring-width");
    const isAuto = r.widthMode === "auto";
    input.disabled = isAuto;
    if (isAuto) {
      const unit = card.querySelector(".oring-widthUnit").value;
      input.value = (r.width / LENGTH_UNITS[unit]).toFixed(4).replace(/\.?0+$/, "");
    }
  });
}

$("calc-form").addEventListener("submit", (e) => {
  e.preventDefault();
  recalculate();
});

// Live recalculation: number inputs debounce slightly so results don't
// flicker mid-keystroke; selects (dropdowns, unit pickers) recompute
// immediately since "change" only fires once a choice is made.
let recalcTimer = null;
const calcForm = $("calc-form");
calcForm.addEventListener("input", () => {
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(recalculate, 200);
});
calcForm.addEventListener("change", () => {
  clearTimeout(recalcTimer);
  recalculate();
});

// initial state
customRow.style.display = "none";
addOring();
recalculate();
