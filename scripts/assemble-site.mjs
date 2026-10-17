#!/usr/bin/env node
// Assemble le site GitHub Pages à partir de la branche data : un catalogue des
// apps en ligne, les mentions légales, et chaque app dans apps/<slug>/ avec le
// pied de page légal ajouté par l'usine. Aucun code d'agent n'est exécuté ici ;
// les textes venus des specs sont échappés.
//
//   node scripts/assemble-site.mjs <data-dir> <out-dir>

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/budget.mjs";
import { readStates, escapeHtml as e } from "./lib/apps.mjs";
import { copyAccepted } from "./lib/site-files.mjs";

const CSS = `:root{color-scheme:light dark;--bg:#fafaf7;--fg:#1d1d1b;--muted:#5b5b57;--card:#fff;--line:#e2e2dc;--accent:#2f5d50}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ededea;--muted:#a3a39d;--card:#1f1f1d;--line:#33332f;--accent:#8cc5b2}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px}h1{font-size:2rem;margin:0 0 .25rem}p.lead{color:var(--muted);margin:0 0 2rem}
ul.apps{list-style:none;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
ul.apps a{display:block;height:100%;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:inherit;text-decoration:none}
ul.apps a:hover{border-color:var(--accent)}ul.apps strong{display:block;color:var(--accent)}ul.apps small{color:var(--muted)}
footer{max-width:860px;margin:0 auto;padding:16px;color:var(--muted);font-size:.875rem}a{color:var(--accent)}`;

const FOOTER_CSS = `.ff-legal{margin:32px auto 0;padding:16px;max-width:860px;font:13px/1.5 system-ui,sans-serif;color:#6b6b66;text-align:center}.ff-legal a{color:inherit}`;

function legalFooter(config, prefix) {
  return `<footer class="ff-legal"><style>${FOOTER_CSS}</style>Publié par ${e(config.publisher.name)} · <a href="${prefix}mentions-legales.html">Mentions légales</a> · <a href="${prefix}index.html">Autres apps</a> · Construite et publiée sans intervention humaine</footer>`;
}

export function injectFooter(html, footer) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${footer}</body>`) : html + footer;
}

function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)}</title><link rel="stylesheet" href="site.css"></head><body>${body}</body></html>\n`;
}

export function assemble(root, data, out) {
  const config = loadConfig(root);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const live = Object.values(readStates(data))
    .filter((s) => s.status === "live" && s.spec && existsSync(join(data, "apps", s.slug, "index.html")))
    .sort((a, b) => (a.liveSince < b.liveSince ? 1 : -1));

  for (const s of live) {
    const dest = join(out, "apps", s.slug);
    const { problems } = copyAccepted(join(data, "apps", s.slug), dest, config.pipeline, new Set(["test.mjs"]));
    if (problems.length) throw new Error(`${s.slug} : ${problems.join(" ; ")}`);
    const index = join(dest, "index.html");
    writeFileSync(index, injectFooter(readFileSync(index, "utf8"), legalFooter(config, "../../")));
  }

  const items = live
    .map((s) => `<li><a href="apps/${e(s.slug)}/"><strong>${e(s.spec.name)}</strong>${e(s.spec.pitch)}<br><small>En ligne depuis le ${e(s.liveSince.slice(0, 10))}</small></a></li>`)
    .join("");
  writeFileSync(
    join(out, "index.html"),
    page(
      "Flop Factory",
      `<main><h1>Flop Factory</h1><p class="lead">Des petites apps construites, testées et publiées par une usine logicielle, sans intervention humaine. Celles que personne n'utilise sont retirées au bout de ${config.kill.afterDays} jours.</p>${
        live.length ? `<ul class="apps">${items}</ul>` : "<p>Aucune app en ligne pour l'instant.</p>"
      }</main><footer>Publié par ${e(config.publisher.name)} · <a href="mentions-legales.html">Mentions légales</a></footer>`,
    ),
  );
  writeFileSync(
    join(out, "mentions-legales.html"),
    page(
      "Mentions légales — Flop Factory",
      `<main><h1>Mentions légales</h1>
<h2>Éditeur</h2><p>${e(config.publisher.name)}, ${e(config.publisher.status)}.${config.publisher.contact ? ` Contact : ${e(config.publisher.contact)}.` : ""}</p>
<h2>Hébergeur</h2><p>GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis (service GitHub Pages).</p>
<h2>Fonctionnement</h2><p>Les apps de ce site sont conçues, codées, testées et publiées automatiquement par des modèles d'IA, sous des contrôles automatiques. Elles sont fournies telles quelles, sans garantie.</p>
<h2>Données personnelles</h2><p>Les apps ne déposent aucun cookie et n'envoient aucune donnée à un serveur : ce que vous saisissez reste dans votre navigateur. L'hébergeur peut journaliser les accès techniques (adresse IP) pour la sécurité du service.</p>
</main><footer><a href="index.html">Retour aux apps</a></footer>`,
    ),
  );
  writeFileSync(join(out, "site.css"), CSS + "\n");
  return live.map((s) => s.slug);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [data, out] = process.argv.slice(2).map((p) => resolve(p));
  console.log(JSON.stringify({ live: assemble(root, data, out) }));
}
