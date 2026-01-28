// ---------- math model (simple, tweakable) ----------
const HP_PER_STR = 22;
const ARMOR_PER_AGI = 1 / 6; // 0.166666...
const ARMOR_K = 0.06;        // armor damage reduction constant

function armorDamageReduction(armor) {
  return (ARMOR_K * armor) / (1 + ARMOR_K * armor);
}

function attacksPerSecond(totalAttackSpeed, bat) {
  // Simplified: APS = (AS/100) / BAT
  return (totalAttackSpeed / 100) / bat;
}

function avgDamage(dmgMin, dmgMax) {
  return (dmgMin + dmgMax) / 2;
}

function attrAtLevel(base, gain, level) {
  return base + gain * (level - 1);
}

function primaryDamageBonus(primary, dStr, dAgi, dInt) {
  // Simplified:
  // - Primary attr heroes: +1 damage per primary attribute gained
  // - Universal: +0.7 damage per total attribute gained
  if (primary === "Universal") return 0.7 * (dStr + dAgi + dInt);
  if (primary === "Strength") return dStr;
  if (primary === "Agility") return dAgi;
  if (primary === "Intelligence") return dInt;
  return 0;
}

function statsAtLevel(hero, level) {
  const b = hero.base;

  const str = attrAtLevel(b.str, b.strGain, level);
  const agi = attrAtLevel(b.agi, b.agiGain, level);
  const intel = attrAtLevel(b.int, b.intGain, level);

  const dStr = str - b.str;
  const dAgi = agi - b.agi;
  const dInt = intel - b.int;

  const hp = (b.hp ?? 0) + dStr * HP_PER_STR;
  const armor = (b.armor ?? 0) + dAgi * ARMOR_PER_AGI;

  // Treat "AS" column as starting total attack speed
  const tas = (b.attackSpeed ?? 100) + dAgi;
  const aps = attacksPerSecond(tas, b.bat ?? 1.7);

  // Treat dmgMin/dmgMax as level-1 values; add only delta attribute bonus
  const baseAvg = avgDamage(b.dmgMin ?? 0, b.dmgMax ?? 0);
  const bonusDmg = primaryDamageBonus(hero.primaryAttribute, dStr, dAgi, dInt);
  const dmgAvg = baseAvg + bonusDmg;

  const dps = dmgAvg * aps;

  const dr = armorDamageReduction(armor);
  const ehpPhysical = hp / (1 - dr);

  return {
    level,
    str, agi, int: intel,
    hp, armor,
    totalAttackSpeed: tas,
    attacksPerSecond: aps,
    damageAvg: dmgAvg,
    dps,
    damageReduction: dr,
    ehpPhysical
  };
}

// ---------- charting (multi-series canvas) ----------
function niceCeilToStep(value, step) {
  if (!isFinite(value) || value <= 0) return step;
  return Math.ceil(value / step) * step;
}

function drawMultiLineChart(canvas, series, yLabel, yStep) {
  // series = [{ name, points: [{x,y},...]}...]
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const pad = 40;

  ctx.clearRect(0, 0, w, h);

  const allPoints = series.flatMap(s => s.points);
  const xs = allPoints.map(p => p.x);
  const ys = allPoints.map(p => p.y);

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);

  const yMin = 0;
  const rawYMax = Math.max(...ys);
  const yMax = niceCeilToStep(rawYMax * 1.05, yStep);

  const xToPx = x => pad + ((x - xMin) / (xMax - xMin || 1)) * (w - pad * 2);
  const yToPx = y => h - pad - ((y - yMin) / (yMax - yMin || 1)) * (h - pad * 2);

  // Axes
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  // Horizontal gridlines every yStep
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1;
  for (let y = 0; y <= yMax; y += yStep) {
    const py = yToPx(y);
    ctx.beginPath();
    ctx.moveTo(pad, py);
    ctx.lineTo(w - pad, py);
    ctx.stroke();
  }

  // Labels
  ctx.globalAlpha = 0.85;
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(yLabel, pad, pad - 10);
  ctx.fillText("Level", w - pad - 30, h - pad + 25);

  // Y labels on gridlines (optional but useful)
  ctx.globalAlpha = 0.55;
  for (let y = 0; y <= yMax; y += yStep) {
    const py = yToPx(y);
    ctx.fillText(String(y), 6, py + 4);
  }

  // X ticks (1, 10, 20, 30)
  ctx.globalAlpha = 0.7;
  [1, 10, 20, 30].forEach(t => {
    if (t < xMin || t > xMax) return;
    const px = xToPx(t);
    ctx.beginPath();
    ctx.moveTo(px, h - pad);
    ctx.lineTo(px, h - pad + 6);
    ctx.stroke();
    ctx.fillText(String(t), px - 4, h - pad + 20);
  });

  // Lines: differentiate using dash patterns (works without relying on colors)
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;

  series.forEach((s, idx) => {
    ctx.setLineDash(idx % 3 === 0 ? [] : idx % 3 === 1 ? [6, 4] : [2, 4]);

    ctx.beginPath();
    s.points.forEach((p, i) => {
      const px = xToPx(p.x);
      const py = yToPx(p.y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });

  ctx.setLineDash([]);

  // Legend (cap to avoid a massive block)
  ctx.globalAlpha = 0.9;
  const legendX = pad;
  let legendY = h - pad + 38;
  const legendMax = 10;
  series.slice(0, legendMax).forEach((s, idx) => {
    ctx.setLineDash(idx % 3 === 0 ? [] : idx % 3 === 1 ? [6, 4] : [2, 4]);
    ctx.beginPath();
    ctx.moveTo(legendX, legendY);
    ctx.lineTo(legendX + 26, legendY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillText(s.name, legendX + 32, legendY + 4);
    legendY += 16;
  });

  if (series.length > legendMax) {
    ctx.globalAlpha = 0.65;
    ctx.fillText(`+ ${series.length - legendMax} more`, legendX + 32, legendY + 4);
  }
}

// ---------- app ----------
let HEROES = [];
const DEFAULT_SELECTED = new Set();

const heroListEl = document.getElementById("heroList");
const heroSearchEl = document.getElementById("heroSearch");
const selectAllBtn = document.getElementById("selectAll");
const selectNoneBtn = document.getElementById("selectNone");
const metricEl = document.getElementById("metric");

const levelSlider = document.getElementById("level");
const levelLabel = document.getElementById("levelLabel");
const levelLabel2 = document.getElementById("levelLabel2");
const summary = document.getElementById("summary");

const dpsCanvas = document.getElementById("dpsChart");
const ehpCanvas = document.getElementById("ehpChart");

function getSelectedHeroIds() {
  return Array.from(heroListEl.querySelectorAll("input[type=checkbox]:checked"))
    .map(cb => cb.value);
}

function getSelectedHeroes() {
  const ids = new Set(getSelectedHeroIds());
  return HEROES.filter(h => ids.has(h.id));
}

function renderHeroList(filterText = "") {
  const q = filterText.trim().toLowerCase();
  heroListEl.innerHTML = "";

  HEROES
    .filter(h => !q || h.name.toLowerCase().includes(q))
    .forEach(h => {
      const row = document.createElement("label");
      row.className = "hero-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = h.id;
      cb.checked = DEFAULT_SELECTED.has(h.id);
      cb.addEventListener("change", updateUI);

      const name = document.createElement("span");
      name.textContent = h.name;

      row.appendChild(cb);
      row.appendChild(name);
      heroListEl.appendChild(row);
    });
}

function updateUI() {
  const level = Number(levelSlider.value);
  levelLabel.textContent = String(level);
  levelLabel2.textContent = String(level);

  const selected = getSelectedHeroes();
  if (selected.length === 0) {
    summary.textContent = "Select at least one hero to compare.";
    const blank = [{ name: "None", points: [{x:1,y:0},{x:30,y:0}] }];
    drawMultiLineChart(dpsCanvas, blank, "DPS", 50);
    drawMultiLineChart(ehpCanvas, blank, "Physical EHP", 250);
    return;
  }

  // Summary: rank selected heroes by chosen metric at chosen level
  const metric = metricEl.value; // "dps" or "ehp"
  const rows = selected.map(h => {
    const s = statsAtLevel(h, level);
    const value = metric === "dps" ? s.dps : s.ehpPhysical;
    return { name: h.name, value };
  }).sort((a, b) => b.value - a.value);

  summary.textContent =
`Selected: ${selected.length}
Ranking metric @ level ${level}: ${metric === "dps" ? "DPS" : "Physical EHP"}

` + rows.slice(0, 40).map(r => `${r.name}: ${r.value.toFixed(2)}`).join("\n")
    + (rows.length > 40 ? `\n...and ${rows.length - 40} more` : "");

  // Curves
  const dpsSeries = selected.map(h => ({
    name: h.name,
    points: Array.from({ length: 30 }, (_, i) => {
      const L = i + 1;
      const st = statsAtLevel(h, L);
      return { x: L, y: st.dps };
    })
  }));

  const ehpSeries = selected.map(h => ({
    name: h.name,
    points: Array.from({ length: 30 }, (_, i) => {
      const L = i + 1;
      const st = statsAtLevel(h, L);
      return { x: L, y: st.ehpPhysical };
    })
  }));

  drawMultiLineChart(dpsCanvas, dpsSeries, "DPS", 50);
  drawMultiLineChart(ehpCanvas, ehpSeries, "Physical EHP", 250);
}

async function init() {
  const res = await fetch("data/heroes.json", { cache: "no-cache" });
  const data = await res.json();
  HEROES = data.heroes || [];

  if (HEROES.length === 0) {
    summary.textContent = "No heroes found in data/heroes.json";
    return;
  }

  // Default selection: first 5 heroes (change as you like)
  HEROES.slice(0, 5).forEach(h => DEFAULT_SELECTED.add(h.id));

  renderHeroList("");

  heroSearchEl.addEventListener("input", () => {
    renderHeroList(heroSearchEl.value);
  });

  selectAllBtn.addEventListener("click", () => {
    Array.from(heroListEl.querySelectorAll("input[type=checkbox]")).forEach(cb => cb.checked = true);
    updateUI();
  });

  selectNoneBtn.addEventListener("click", () => {
    Array.from(heroListEl.querySelectorAll("input[type=checkbox]")).forEach(cb => cb.checked = false);
    updateUI();
  });

  metricEl.addEventListener("change", updateUI);
  levelSlider.addEventListener("input", updateUI);

  updateUI();
}

init().catch(err => {
  summary.textContent = "Failed to load data/heroes.json.\n\n" + String(err);
});
