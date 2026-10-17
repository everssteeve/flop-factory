// Contrôle de l'app dans un vrai navigateur : elle se charge sans erreur, ne
// contacte aucun autre site, affiche du contenu et ne déborde pas à 375 px ni à
// 1280 px. Le serveur est local et ne sert que les fichiers du dossier.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

async function loadPlaywright() {
  const mod = process.env.FF_PLAYWRIGHT ? await import(process.env.FF_PLAYWRIGHT) : await import("playwright");
  return mod.chromium ?? mod.default?.chromium;
}

function serve(dir) {
  const server = createServer((req, res) => {
    const name = basename(decodeURIComponent(new URL(req.url, "http://x").pathname)) || "index.html";
    const p = join(dir, name);
    if (!TYPES[extname(name)] || !existsSync(p)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(name)] }).end(readFileSync(p));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export async function browserSmoke(dir) {
  let chromium;
  try {
    chromium = await loadPlaywright();
  } catch (e) {
    return [`navigateur indisponible : ${e.message}`];
  }
  const server = await serve(dir);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const problems = [];
  const browser = await chromium.launch();
  try {
    for (const width of [375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(`erreur JS : ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`console : ${m.text()}`));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(origin + "/")) return route.continue();
        errors.push(`requête externe : ${url.slice(0, 120)}`);
        return route.abort();
      });
      const resp = await page.goto(origin + "/index.html", { waitUntil: "load", timeout: 15_000 }).catch((e) => {
        errors.push(`chargement : ${e.message}`);
        return null;
      });
      if (resp && !resp.ok()) errors.push(`index.html : HTTP ${resp.status()}`);
      await page.waitForTimeout(500);
      const facts = await page
        .evaluate(() => ({
          title: document.title,
          text: document.body?.innerText?.trim().length ?? 0,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        }))
        .catch(() => null);
      if (!facts) errors.push("page illisible");
      else {
        if (!facts.title.trim()) errors.push("titre vide");
        if (facts.text < 20) errors.push("page quasi vide");
        if (facts.overflow > 1) errors.push(`débordement horizontal de ${facts.overflow} px`);
      }
      for (const e of new Set(errors)) problems.push(`${width} px — ${e}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return problems;
}
