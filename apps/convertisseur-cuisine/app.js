const VOL = { tasse: 240, cs: 15, cc: 5, ml: 1 };
const MASS = { g: 1, oz: 28.35 };
const LABEL = { tasse: "tasse", cs: "c. à soupe", cc: "c. à café", ml: "ml", g: "g", oz: "oz" };

export function parseNumber(text, allowNegative = false) {
  const s = String(text ?? "").trim();
  const re = allowNegative ? /^-?\d+([.,]\d+)?$/ : /^\d+([.,]\d+)?$/;
  if (!re.test(s)) return null;
  return Number(s.replace(",", "."));
}

export function formatNumber(n, decimals = 2) {
  const f = Number(n.toFixed(decimals));
  return String(f).replace(".", ",");
}

export function convertUnit(value, from, to) {
  const v = parseNumber(value);
  if (v === null) return { error: "Saisie invalide : entrez un nombre positif (ex. 2 ou 1,5)." };
  const kind = (u) => (u in VOL ? "vol" : u in MASS ? "mass" : null);
  if (!kind(from) || !kind(to)) return { error: "Unité inconnue." };
  if (kind(from) !== kind(to)) {
    return { error: "Conversion impossible : le volume et la masse dépendent de l'ingrédient." };
  }
  const t = kind(from) === "vol" ? VOL : MASS;
  const r = (v * t[from]) / t[to];
  const text = formatNumber(r, to === "oz" ? 1 : 2) + " " + LABEL[to];
  return { value: r, text };
}

export function convertTemp(value, from) {
  const v = parseNumber(value, true);
  if (v === null) return { error: "Saisie invalide : entrez une température en nombre (ex. 180)." };
  if (from === "F") {
    const r = Math.round(((v - 32) * 5) / 9);
    return { value: r, text: r + " °C" };
  }
  const r = Math.round((v * 9) / 5 + 32);
  return { value: r, text: r + " °F" };
}

export function scaleQuantity(q, from, to) {
  return (q * to) / from;
}

export function scaleIngredients(text, from, to) {
  const f = parseNumber(from), t = parseNumber(to);
  if (!f || !t) return { error: "Saisie invalide : les nombres de personnes doivent être positifs." };
  const lines = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) { lines.push(line); continue; }
    const q = scaleQuantity(Number(m[1].replace(",", ".")), f, t);
    lines.push((formatNumber(q, 2) + " " + m[2]).trim());
  }
  return { lines };
}

export const STORAGE_KEY = "convertisseur-cuisine:personnes-cibles";

export function init(doc, storage) {
  const $ = (id) => doc.getElementById(id);
  const show = (resId, errId, r) => {
    $(resId).textContent = r.error ? "" : r.text;
    $(errId).textContent = r.error || "";
  };
  const unit = () => show("unit-result", "unit-error",
    convertUnit($("unit-value").value, $("unit-from").value, $("unit-to").value));
  const temp = () => show("temp-result", "temp-error",
    convertTemp($("temp-value").value, $("temp-from").value));
  const recipe = () => {
    const r = scaleIngredients($("ingredients").value, $("base-people").value, $("target-people").value);
    const ul = $("recipe-result");
    ul.textContent = "";
    $("recipe-error").textContent = r.error || "";
    if (r.error) return;
    for (const l of r.lines) {
      const li = doc.createElement("li");
      li.textContent = l;
      ul.appendChild(li);
    }
  };
  let saved = null;
  try { saved = storage && storage.getItem(STORAGE_KEY); } catch (e) { saved = null; }
  if (saved && parseNumber(saved)) $("target-people").value = saved;

  for (const id of ["unit-value", "unit-from", "unit-to"]) {
    $(id).addEventListener("input", unit); $(id).addEventListener("change", unit);
  }
  for (const id of ["temp-value", "temp-from"]) {
    $(id).addEventListener("input", temp); $(id).addEventListener("change", temp);
  }
  for (const id of ["base-people", "target-people", "ingredients"]) {
    $(id).addEventListener("input", recipe); $(id).addEventListener("change", recipe);
  }
  $("target-people").addEventListener("input", () => {
    try { storage && storage.setItem(STORAGE_KEY, $("target-people").value); } catch (e) { /* ignoré */ }
  });
  unit(); temp(); recipe();
}

if (typeof document !== "undefined") {
  let st = null;
  try { st = window.localStorage; } catch (e) { st = null; }
  init(document, st);
}
