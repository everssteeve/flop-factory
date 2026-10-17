#!/usr/bin/env node
// Verdict à J+30 : une app en ligne depuis kill.afterDays jours est retirée si
// moins de kill.minimum visiteurs l'ont réellement utilisée sur la fenêtre.
// Le verdict est rendu une seule fois ; une app qui passe reste en ligne.
//
// Prudence avant tout : sans mesure configurée, sans mesure couvrant toute la
// fenêtre, ou si l'API ne répond pas, aucune app n'est retirée.
// Exécuté dans le job records (seul à écrire), avec GOATCOUNTER_CODE et
// GOATCOUNTER_TOKEN (clé API en lecture seule).
//
//   node scripts/verdict-j30.mjs <data-dir>
// Sortie : killed=<nombre d'apps retirées>.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/budget.mjs";
import { readStates } from "./lib/apps.mjs";
import { measureCode, USED_EVENT } from "./lib/measure.mjs";

const DAY_MS = 24 * 3600 * 1000;

function hourFloor(d) {
  const x = new Date(d);
  x.setUTCMinutes(0, 0, 0);
  return x.toISOString().replace(".000Z", "Z");
}

/** Visiteurs ayant utilisé l'app sur [start, end], ou null si la mesure est indisponible. */
export async function usedVisitors({ code, token, slug, start, end, fetchImpl = fetch }) {
  const q = new URLSearchParams({ start: hourFloor(start), end: hourFloor(end), path_by_name: "true", limit: "5" });
  q.append("include_paths", USED_EVENT(slug));
  try {
    const r = await fetchImpl(`https://${code}.goatcounter.com/api/v0/stats/hits?${q}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const body = await r.json();
    if (!Array.isArray(body?.hits)) return null;
    const hit = body.hits.find((h) => h?.path === USED_EVENT(slug));
    const n = hit ? Number(hit.count) : 0;
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export async function verdicts({ root, data, env = process.env, now = new Date(), fetchImpl }) {
  const config = loadConfig(root);
  const code = measureCode(env);
  const token = (env.GOATCOUNTER_TOKEN ?? "").trim();
  if (!code || !token) return { killed: [], kept: [], note: "mesure non configurée : aucun verdict" };

  // Début de la mesure : posé au premier passage où elle est configurée.
  const mp = join(data, "factory", "measure.json");
  if (!existsSync(mp)) {
    mkdirSync(dirname(mp), { recursive: true });
    writeFileSync(mp, JSON.stringify({ since: now.toISOString() }, null, 2) + "\n");
    return { killed: [], kept: [], note: "mesure démarrée aujourd'hui" };
  }
  const since = new Date(JSON.parse(readFileSync(mp, "utf8")).since);
  if (Number.isNaN(since.getTime())) throw new Error("factory/measure.json illisible");

  const { afterDays, minimum } = config.kill;
  const killed = [];
  const kept = [];
  for (const s of Object.values(readStates(data))) {
    if (s.status !== "live" || s.verdictJ30) continue;
    const start = new Date(Math.max(new Date(s.liveSince).getTime(), since.getTime()));
    if (now.getTime() - start.getTime() < afterDays * DAY_MS) continue;
    const n = await usedVisitors({ code, token, slug: s.slug, start, end: now, fetchImpl });
    if (n === null) continue; // mesure indisponible : on réessaiera demain
    const next = structuredClone(s);
    const reason = `${n} visiteur(s) l'ont utilisée en ${afterDays} jours (minimum ${minimum})`;
    next.verdictJ30 = { at: now.toISOString(), used: n, decision: n < minimum ? "kill" : "keep" };
    if (n < minimum) {
      next.status = "killed";
      next.killedAt = now.toISOString();
      killed.push(s.slug);
    } else kept.push(s.slug);
    next.history = [...(next.history ?? []), { at: now.toISOString(), decision: next.verdictJ30.decision, reasons: [reason] }].slice(-20);
    writeFileSync(join(data, "factory", "apps", `${s.slug}.json`), JSON.stringify(next, null, 2) + "\n");
  }
  return { killed, kept };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const out = await verdicts({ root, data: resolve(process.argv[2]) });
  console.log(JSON.stringify(out));
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `killed=${out.killed.length}\n`, { flag: "a" });
}
