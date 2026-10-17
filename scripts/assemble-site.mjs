#!/usr/bin/env node
// Assemble le site GitHub Pages à partir de la branche data : un catalogue des
// apps en ligne, les mentions légales, et chaque app dans apps/<slug>/ avec le
// pied de page légal ajouté par l'usine. Aucun code d'agent n'est exécuté ici ;
// les textes venus des specs sont échappés.
//
// Avec GOATCOUNTER_CODE, chaque app reçoit le compteur d'usage anonyme de
// l'usine (voir lib/measure.mjs) et sa politique de sécurité s'ouvre à cette
// seule origine d'image. Sans, aucune mesure.
//
//   node scripts/assemble-site.mjs <data-dir> <out-dir>

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/budget.mjs";
import { readStates, escapeHtml as e } from "./lib/apps.mjs";
import { copyAccepted } from "./lib/site-files.mjs";
import { harden, CSP_META } from "./lib/harden.mjs";
import { measureCode, countOrigin, COUNTER_JS, counterTag } from "./lib/measure.mjs";

const CSS = `:root{color-scheme:light dark;--bg:#fafaf7;--fg:#1d1d1b;--muted:#5b5b57;--card:#fff;--line:#e2e2dc;--accent:#2f5d50}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ededea;--muted:#a3a39d;--card:#1f1f1d;--line:#33332f;--accent:#8cc5b2}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px}h1{font-size:2rem;margin:0 0 .25rem}p.lead{color:var(--muted);margin:0 0 2rem}
ul.apps{list-style:none;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
ul.apps a{display:block;height:100%;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:inherit;text-decoration:none}
ul.apps a:hover{border-color:var(--accent)}ul.apps strong{display:block;color:var(--accent)}ul.apps small{color:var(--muted)}
footer{max-width:860px;margin:0 auto;padding:16px;color:var(--muted);font-size:.875rem}a{color:var(--accent)}`;

// Fichier servi à la racine : la politique de sécurité interdit les styles en ligne.
const FOOTER_CSS = `.ff-legal{margin:32px auto 0;padding:16px;max-width:860px;font:13px/1.5 system-ui,sans-serif;color:#6b6b66;text-align:center}.ff-legal a{color:inherit}`;

function legalFooter(config, prefix) {
  return `<link rel="stylesheet" href="${prefix}ff-legal.css"><footer class="ff-legal">Publié par ${e(config.publisher.name)} · <a href="${prefix}mentions-legales.html">Mentions légales</a> · <a href="${prefix}index.html">Autres apps</a> · Construite et publiée sans intervention humaine</footer>`;
}

export function injectFooter(html, footer) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${footer}</body>`) : html + footer;
}

function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">${CSP_META}<meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)}</title><link rel="stylesheet" href="site.css"></head><body>${body}</body></html>\n`;
}

/** Méta description (pitch de la spec) ajoutée aux pages d'app, pour les moteurs de recherche et les partages. */
export function injectDescription(html, text) {
  const masked = html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  const headEnd = masked.search(/<\/head>/i);
  const head = headEnd < 0 ? masked : masked.slice(0, headEnd);
  if (/<meta[^>]+name=["']description["']/i.test(head)) return html;
  const t = head.search(/<\/title>/i);
  if (t < 0) return html;
  const at = t + "</title>".length;
  return html.slice(0, at) + `<meta name="description" content="${e(text)}">` + html.slice(at);
}

export function assemble(root, data, out, { env = process.env } = {}) {
  const config = loadConfig(root);
  const origin = countOrigin(measureCode(env));
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
    let html = injectDescription(harden(readFileSync(index, "utf8"), { countOrigin: origin }), s.spec.pitch);
    html = injectFooter(html, legalFooter(config, "../../") + (origin ? counterTag("../../", origin, s.slug) : ""));
    writeFileSync(index, html);
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
<h2>Éditeur</h2><p>${e(config.publisher.name)}, ${e(config.publisher.status)}${config.publisher.address ? `, ${e(config.publisher.address)}` : ""}.${config.publisher.contact ? ` Contact : ${e(config.publisher.contact)}.` : ""}</p>
<h2>Hébergeur</h2><p>GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis (service GitHub Pages).</p>
<h2>Fonctionnement</h2><p>Les apps de ce site sont conçues, codées, testées et publiées automatiquement par des modèles d'IA, sous des contrôles automatiques. Elles sont fournies telles quelles, sans garantie.</p>
<h2>Données personnelles</h2><p>Les apps ne déposent aucun cookie et n'envoient à aucun serveur ce que vous saisissez : vos données restent dans votre navigateur. L'hébergeur peut journaliser les accès techniques (adresse IP) pour la sécurité du service.</p>${
        origin
          ? `<h2>Mesure d'audience</h2><p>Pour savoir quelles apps sont utilisées (et retirer les autres), chaque app signale son ouverture puis sa première utilisation au service de mesure d'audience GoatCounter (goatcounter.com, exploité par Martin Tournoij en Irlande, serveurs dans l'Union européenne). Le signal indique le nom de l'app, jamais ce que vous saisissez, et ne dépose aucun cookie. Comme pour toute requête web, GoatCounter reçoit techniquement votre adresse IP et le type de navigateur ; selon sa <a href="https://www.goatcounter.com/help/privacy">politique de confidentialité</a>, il ne conserve ni l'adresse IP ni d'identifiant, et n'en tire que des statistiques agrégées (pays, navigateur, nombre de visites). Aucun signal n'est envoyé si votre navigateur demande à ne pas être suivi (Do Not Track ou Global Privacy Control). Finalité : décider du maintien ou du retrait de chaque app ; base légale : intérêt légitime de l'éditeur.</p>`
          : ""
      }
</main><footer><a href="index.html">Retour aux apps</a></footer>`,
    ),
  );
  writeFileSync(join(out, "site.css"), CSS + "\n");
  writeFileSync(join(out, "ff-legal.css"), FOOTER_CSS + "\n");
  if (origin) writeFileSync(join(out, "ff-count.js"), COUNTER_JS);
  const base = config.site.baseUrl;
  const urls = ["", "mentions-legales.html", ...live.map((s) => `apps/${s.slug}/`)];
  writeFileSync(
    join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${e(base + u)}</loc></url>`).join("\n")}\n</urlset>\n`,
  );
  writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`);
  return live.map((s) => s.slug);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [data, out] = process.argv.slice(2).map((p) => resolve(p));
  console.log(JSON.stringify({ live: assemble(root, data, out) }));
}
