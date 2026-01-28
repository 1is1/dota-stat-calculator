// ---------- math model (simple, tweakable) ----------
// These constants are commonly used in Dota calculators.
// If you want patch-perfect numbers, adjust them to match your source.
const HP_PER_STR = 22;
const ARMOR_PER_AGI = 1 / 6; // 0.166666...
const ARMOR_K = 0.06;        // damage reduction factor

function armorDamageReduction(armor) {
  // DR = (k * armor) / (1 + k * armor)
  return (ARMOR_K * armor) / (1 + ARMOR_K * armor);
}

function attacksPerSecond(totalAttackSpeed, bat) {
  // Common simplified model: APS = (AS/100) / BAT
  return (totalAttackSpeed / 100) / bat;
}

function avgDamage(dmgMin, dmgMax) {
  return (dmgMin + dmgMax) / 2;
}

function attrAtLevel(base, gain, level) {
  return base + gain * (level - 1);
}

function primaryDamageBonus(primary, dStr, dAgi, dInt) {
  // Simplified: 1 damage per primary attribute point.
  // Universal: 0.7 damage per total attribute point.
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

  const tas = (b.attackSpeed ?? 100) + dAgi; // treat "AS" as starting total attack speed
  const aps = attacksPerSecond(tas, b.bat ?? 1.7);

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

// ---------- tiny canvas chart ----------
function drawLineChart(canvas, points, yLabel) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const pad = 40;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);

  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0;
  const yMax = Math.max(...ys) * 1.05;

  const xToPx = x => pad + ((x - xMin) / (xMax - xMin)) * (w - pad * 2);
  const yToPx = y => h - pad - ((y - yMin) / (yMax - yMin || 1)) * (h - pad * 2);

  // axes
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  // labels
  ctx.globalAlpha = 0.8;
  ctx.fillText(yLabel, pad, pad - 10);
  ctx.fillText("Level", w - pad - 30, h - pad + 25);

  // line
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = xToPx(p.x);
    const py = yToPx(p.y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // ticks (1, 10, 20, 30)
  ctx.globalAlpha = 0.75;
  [1, 10, 20, 30].forEach(t => {
    if (t < xMin || t > xMax) return;
    const px = xToPx(t);
    ctx.beginPath();
    ctx.moveTo(px, h - pad);
    ctx.lineTo(px, h - pad + 6);
    ctx.stroke();
    ctx.fillText(String(t), px - 4, h - pad + 20);
  });
}

// ---------- app ----------
let HEROES = [];

const heroSelect = document.getElementById("heroSelect");
const levelSlider = document.getElementById("level");
const levelLabel = document.getElementById("levelLabel");
const levelLabel2 = document.getElementById("levelLabel2");
const summary = document.getElementById("summary");

const dpsCanvas = document.getElementById("dpsChart");
const ehpCanvas = document.getElementById("ehpChart");

function getSelectedHero() {
  const id = heroSelect.value;
  return HEROES.find(h => h.id === id) || HEROES[0];
}

function updateUI() {
  const hero = getSelectedHero();
  const level = Number(levelSlider.value);

  levelLabel.textContent = String(level);
  levelLabel2.textContent = String(level);

  const s = statsAtLevel(hero, level);

  summary.textContent =
`Hero: ${hero.name}
Primary: ${hero.primaryAttribute}

STR/AGI/INT: ${s.str.toFixed(1)} / ${s.agi.toFixed(1)} / ${s.int.toFixed(1)}
HP: ${s.hp.toFixed(1)}
Armor: ${s.armor.toFixed(2)}  (DR: ${(s.damageReduction * 100).toFixed(1)}%)

Avg damage: ${s.damageAvg.toFixed(2)}
Total attack speed: ${s.totalAttackSpeed.toFixed(1)}
Attacks/sec: ${s.attacksPerSecond.toFixed(3)}

DPS: ${s.dps.toFixed(2)}
Physical EHP: ${s.ehpPhysical.toFixed(1)}
`;

  // Curves
  const dpsPoints = [];
  const ehpPoints = [];
  for (let L = 1; L <= 30; L++) {
    const st = statsAtLevel(hero, L);
    dpsPoints.push({ x: L, y: st.dps });
    ehpPoints.push({ x: L, y: st.ehpPhysical });
  }

  drawLineChart(dpsCanvas, dpsPoints, "DPS");
  drawLineChart(ehpCanvas, ehpPoints, "Physical EHP");
}

async function init() {
  const res = await fetch("data/heroes.json", { cache: "no-cache" });
  const data = await res.json();
  HEROES = data.heroes || [];

  // Populate dropdown
  HEROES.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h.id;
    opt.textContent = h.name;
    heroSelect.appendChild(opt);
  });

  // Default selection
  heroSelect.value = HEROES[0]?.id || "";

  heroSelect.addEventListener("change", updateUI);
  levelSlider.addEventListener("input", updateUI);

  updateUI();
}

init().catch(err => {
  summary.textContent = "Failed to load data/heroes.json.\n\n" + String(err);
});
