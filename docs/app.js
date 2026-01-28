// --------------------
// Model math (simple, tweakable)
// --------------------
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
    dps,
    ehpPhysical,
    str, agi, int: intel,
    hp, armor,
    totalAttackSpeed: tas,
    attacksPerSecond: aps,
    damageAvg: dmgAvg,
    damageReduction: dr
  };
}

// --------------------
// UI state + helpers
// --------------------
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

// --------------------
// Chart.js setup
// --------------------
let dpsChart = null;
let ehpChart = null;

function buildDatasets(selectedHeroes, metricKey) {
  // metricKey: "dps" or "ehpPhysical"
  // Return Chart.js datasets with labels = hero name (shows in tooltip)
  return selectedHeroes.map((h, idx) => {
    const points = [];
    for (let L = 1; L <= 30; L++) {
      const s = statsAtLevel(h, L);
      points.push({ x: L, y: s[metricKey] });
    }

    // Differentiation without hardcoding colors:
    // - give each dataset a dash style based on index
    const dash = idx % 3 === 0 ? [] : idx % 3 === 1 ? [6, 4] : [2, 4];

    return {
      label: h.name,
      data: points,
      parsing: false,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.15,
      borderDash: dash
      // no explicit color -> Chart.js uses defaults (may repeat; dash helps)
    };
  });
}

function ensureCharts() {
  if (dpsChart && ehpChart) return;

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "nearest",
      intersect: false
    },
    plugins: {
      legend: {
        display: true,
        position: "bottom"
      },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items) => {
            const item = items?.[0];
            if (!item) return "";
            const level = item.raw?.x ?? item.label;
            return `Level ${level}`;
          },
          label: (item) => {
            const hero = item.dataset?.label ?? "Hero";
            const value = item.raw?.y ?? item.parsed?.y ?? 0;
            return `${hero}: ${Number(value).toFixed(2)}`;
          }
        }
      }
    }
  };

  dpsChart = new Chart(dpsCanvas.getContext("2d"), {
    type: "line",
    data: { datasets: [] },
    options: {
      ...commonOptions,
      scales: {
        x: {
          type: "linear",
          min: 1,
          max: 30,
          ticks: { stepSize: 1 }
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 50 },  // <-- every 50 DPS
          grid: { drawTicks: true }
        }
      }
    }
  });

  ehpChart = new Chart(ehpCanvas.getContext("2d"), {
    type: "line",
    data: { datasets: [] },
    options: {
      ...commonOptions,
      scales: {
        x: {
          type: "linear",
          min: 1,
          max: 30,
          ticks: { stepSize: 1 }
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 250 }, // <-- every 250 EHP
          grid: { drawTicks: true }
        }
      }
    }
  });
}

function updateCharts(selectedHeroes) {
  ensureCharts();

  dpsChart.data.datasets = buildDatasets(selectedHeroes, "dps");
  ehpChart.data.datasets = buildDatasets(selectedHeroes, "ehpPhysical");

  dpsChart.update();
  ehpChart.update();
}

// --------------------
// Summary + main update
// --------------------
function updateSummary(selectedHeroes, level, rankBy) {
  const rows = selectedHeroes.map(h => {
    const s = statsAtLevel(h, level);
    return {
      name: h.name,
      dps: s.dps,
      ehp: s.ehpPhysical
    };
  });

  // Sort by selected metric, but show both columns
  rows.sort((a, b) => (rankBy === "dps" ? b.dps - a.dps : b.ehp - a.ehp));

  // Simple aligned-ish formatting
  const lines = rows.slice(0, 60).map(r => {
    const dps = r.dps.toFixed(2).padStart(9, " ");
    const ehp = r.ehp.toFixed(1).padStart(9, " ");
    return `${r.name}\n  DPS: ${dps}   EHP: ${ehp}`;
  });

  summary.textContent =
`Selected: ${selectedHeroes.length}
Level: ${level}
Ranked by: ${rankBy === "dps" ? "DPS" : "Physical EHP"}

` + lines.join("\n\n") + (rows.length > 60 ? `\n\n...and ${rows.length - 60} more` : "");
}

function updateUI() {
  const level = Number(levelSlider.value);
  levelLabel.textContent = String(level);
  levelLabel2.textContent = String(level);

  const selected = getSelectedHeroes();
  if (selected.length === 0) {
    summary.textContent = "Select at least one hero to compare.";
    updateCharts([{ id: "none", name: "None", primaryAttribute: "Strength", base: {
      str: 0, strGain: 0, agi: 0, agiGain: 0, int: 0, intGain: 0,
      hp: 0, armor: 0, dmgMin: 0, dmgMax: 0, attackSpeed: 100, bat: 1.7
    }}]);
    return;
  }

  const rankBy = metricEl.value; // "dps" or "ehp"
  updateSummary(selected, level, rankBy);
  updateCharts(selected);
}

// --------------------
// Boot
// --------------------
async function init() {
  const res = await fetch("data/heroes.json", { cache: "no-cache" });
  const data = await res.json();
  HEROES = data.heroes || [];

  if (HEROES.length === 0) {
    summary.textContent = "No heroes found in data/heroes.json";
    return;
  }

  // Default: first 5 heroes selected (change as you like)
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
