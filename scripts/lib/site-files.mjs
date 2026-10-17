// Fichiers d'une app que l'usine accepte de transporter : dossier à plat,
// extensions autorisées, aucun lien symbolique, taille totale bornée.
// Utilisé à chaque passage de frontière (agent → porte → données → Pages).

import { lstatSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

/** Fichiers de travail que l'agent laisse et qui ne sont jamais publiés. */
export const NEVER_PUBLISHED = new Set(["report.json", "review.json", "spec.json"]);

export function collectFiles(dir, { allowedExtensions, maxSiteBytes }) {
  const files = [];
  const problems = [];
  let total = 0;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) problems.push(`lien symbolique refusé : ${name}`);
    else if (st.isDirectory()) {
      if (name !== "node_modules") problems.push(`sous-dossier refusé : ${name}`);
    } else if (!st.isFile()) problems.push(`fichier spécial refusé : ${name}`);
    else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) problems.push(`nom de fichier refusé : ${name}`);
    else if (!allowedExtensions.includes(extname(name).toLowerCase())) problems.push(`extension refusée : ${name}`);
    else {
      total += st.size;
      files.push(name);
    }
  }
  if (total > maxSiteBytes) problems.push(`app trop lourde : ${total} octets (max ${maxSiteBytes})`);
  return { files, problems };
}

/** Copie les fichiers acceptés de `src` vers `dest`, sauf ceux de `skip`. */
export function copyAccepted(src, dest, limits, skip = new Set()) {
  const { files, problems } = collectFiles(src, limits);
  if (problems.length) return { copied: [], problems };
  mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const f of files) {
    if (skip.has(f)) continue;
    copyFileSync(join(src, f), join(dest, f));
    copied.push(f);
  }
  return { copied, problems };
}
