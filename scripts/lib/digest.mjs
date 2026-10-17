// Ce que l'usine a vécu, résumé pour le cerveau : décisions de l'arbitre et
// motifs d'échec regroupés. Du code, pas un modèle : le regroupement est une
// normalisation simple (nombres, slugs et citations effacés), assez stable pour
// qu'un même défaut revienne sous le même motif.

import { readStates } from "./apps.mjs";

/** Toutes les décisions de l'arbitre (go, retry, abandon), de la plus ancienne à la plus récente. */
export function decisions(dataDir) {
  const out = [];
  for (const s of Object.values(readStates(dataDir))) {
    for (const h of s.history ?? []) {
      if (!["go", "retry", "abandon"].includes(h.decision)) continue;
      out.push({ slug: s.slug, at: h.at, decision: h.decision, reasons: h.reasons ?? [] });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** Motif d'une raison d'échec : sa catégorie et son début, sans ce qui varie d'une app à l'autre. */
export function motifOf(reason) {
  const r = String(reason)
    .replace(/«[^»]*»|"[^"]*"|`[^`]*`/g, "…")
    .replace(/\bAC-\d+\b/g, "AC-n")
    .replace(/\d+([.,]\d+)?/g, "n")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(porte|revue|atelier \w+)\s*:\s*(.*)$/.exec(r);
  const [kind, rest] = m ? [m[1], m[2]] : ["autre", r];
  return `${kind} : ${rest.split(/[:;(.,]/)[0].trim().slice(0, 70)}`;
}

export function digest(dataDir, { since = null, examples = 3 } = {}) {
  const all = decisions(dataDir);
  const recent = since ? all.filter((d) => d.at > since) : all;
  const motifs = new Map();
  for (const d of recent) {
    if (d.decision === "go") continue;
    for (const r of d.reasons) {
      if (/score n < n$/.test(motifOf(r))) continue; // le score suit les défauts, il n'en est pas un
      const k = motifOf(r);
      const e = motifs.get(k) ?? { motif: k, count: 0, examples: [] };
      e.count += 1;
      if (e.examples.length < examples) e.examples.push({ slug: d.slug, reason: String(r).slice(0, 300) });
      motifs.set(k, e);
    }
  }
  const go = recent.filter((d) => d.decision === "go").length;
  return {
    decisions: recent.length,
    go,
    goRate: recent.length ? go / recent.length : null,
    failures: recent.length - go,
    motifs: [...motifs.values()].sort((a, b) => b.count - a.count).slice(0, 10),
  };
}

/** Taux de go sur une liste de décisions (null si vide). */
export function goRate(list) {
  return list.length ? list.filter((d) => d.decision === "go").length / list.length : null;
}
