import {
  computePermeation,
  GASES,
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
    ["Decay time-constant α", `${fmt(s.alpha)} s⁻¹  (1/α = ${fmtDuration(1 / s.alpha)})`],
    ["Combined geometry×permeability  K_total = Σ(P·π·d1·width/d2)", `${fmt(s.K_total)} mol/(s·Pa)`],
    ["P₀ (SI)", `${fmt(s.P0)} Pa`],
    ["Lockout pressure (SI)", `${fmt(s.Plock)} Pa`],
    ["External pressure (SI)", `${fmt(s.Pext)} Pa`],
    ["Operating temperature", `${fmt(s.T)} K`],
    ["Compartment volume (SI)", `${fmt(s.V)} m³`],
  ];
  result.orings.forEach((r, i) => {
    const share = (100 * r.K / s.K_total).toFixed(1);
    rows.push([
      `O-ring ${i + 1}: d1 / d2 / width / P (SI)`,
      `${fmt(r.d1)} m / ${fmt(r.d2)} m / ${fmt(r.width)} m / ${fmt(r.P_SI)} mol/(m·s·Pa)  — ${share}% of total loss`,
    ]);
  });
  const table = $("breakdown-table");
  table.innerHTML =
    "<tr><th>Quantity</th><th>Value</th></tr>" +
    rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
}

// ---- main -----------------------------------------------------------------------
$("calc-form").addEventListener("submit", (e) => {
  e.preventDefault();
  showError("");
  const params = readParams();

  if (params.orings.length === 0) {
    showError("Add at least one O-ring.");
    return;
  }
  for (const [i, r] of params.orings.entries()) {
    for (const [key, value] of Object.entries(r)) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        showError(`O-ring ${i + 1}: "${key}" is missing or not a number.`);
        return;
      }
    }
  }
  for (const key of ["volume", "temperature", "p0", "pLock", "pExt"]) {
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

  drawChart(result);
  renderBreakdown(result);
});

// initial state
customRow.style.display = "none";
addOring();
