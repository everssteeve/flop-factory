#!/usr/bin/env node
// Apply base SEO to a fresh T3 scaffold, and bring what an earlier run wrote up to date.
//
// Usage:
//   node setup-seo.mjs --name "My Project" --description "Short description 150-160 chars" [--locale fr_FR]
//
// What it does (all idempotent - safe to re-run):
//   1. src/lib/site-url.ts: the site's public address, read by everything below (_site-url.mjs):
//      NEXT_PUBLIC_APP_URL, else the production domain Vercel publishes, localhost last.
//   2. Patches src/app/layout.tsx:
//      - Enriches the `metadata` export (metadataBase, title template, openGraph, twitter, robots)
//      - Updates <html lang="..."> to match the locale (fr/en/etc. derived from the locale arg)
//      - Inserts a minimal JSON-LD WebSite schema inside <body>, before {children}
//   3. Creates src/app/robots.ts: Next.js serves it at /robots.txt, with the sitemap's address
//      (a static robots.txt cannot read the environment, so it never had that line)
//   4. Creates src/app/sitemap.ts (if not present)
//   5. Creates src/app/opengraph-image.tsx: the share image, drawn by next/og from the site's name
//      and description, when the project has none (Next.js adds the og:image tags itself)
//
// What an earlier run wrote is brought up to date, and only that (3.4.12): the localhost fallback
// of metadataBase, of the JSON-LD and of the sitemap; a public/robots.txt still exactly as it wrote
// it (replaced by robots.ts: with both, Next.js serves the static file in production and ignores
// robots.ts, and answers an error in development); the reference to a
// public/og-image.png that was never made. A file the project changed is left as it is, and said.
// It does NOT touch the fonts (T3 wires Geist Sans automatically - leave it alone unless the
// user asks for a different font).
//
// The sitemap starts with just `/` - the caller (bootstrap Step 4) or later steps are
// responsible for adding more pages as they're created (legal pages, auth, etc.).

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureSiteUrl, withSiteUrlImport } from "./_site-url.mjs";

// ─── Parse args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let projectName = "";
let description = "";
let locale = "fr_FR";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--name" && args[i + 1]) projectName = args[++i];
  else if (args[i] === "--description" && args[i + 1]) description = args[++i];
  else if (args[i] === "--locale" && args[i + 1]) locale = args[++i];
  else {
    console.error(`Unknown arg: ${args[i]}`);
    process.exit(1);
  }
}

if (!projectName || !description) {
  console.error(
    "Usage: node setup-seo.mjs --name NAME --description DESC [--locale LOCALE]",
  );
  process.exit(1);
}

const htmlLang = locale.split("_")[0]; // "fr_FR" → "fr"
const actions = [];

// Escape double quotes for embedding in a JSON object literal inside TS source
function tsQuote(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// What earlier runs wrote, exactly: the only text this script rewrites in a file that exists.
const OLD_BASE = 'process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"';
const OLD_ROBOTS = "User-agent: *\nAllow: /\nDisallow: /api/\n";
const OLD_OG_IMAGES = /\n[ \t]*images: \[\{ url: "\/og-image\.png", width: 1200, height: 630, alt: "[^"\n]*" \}\],/;
const OG_FILES = ["tsx", "jsx", "ts", "js", "png", "jpg", "jpeg", "gif"].map((ext) => `src/app/opengraph-image.${ext}`);
const sameText = (a, b) => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
// Whether the project has a share image of its own: a picture in public/, or a file Next.js serves.
const hasOwnOgImage = () => existsSync("public/og-image.png") || OG_FILES.some((f) => existsSync(f));

// ─── 1. src/lib/site-url.ts ────────────────────────────────────────────
function writeSiteUrl() {
  const r = ensureSiteUrl(".");
  actions.push(r === "created" ? "✓ src/lib/site-url.ts: created (the site's address: NEXT_PUBLIC_APP_URL, else Vercel's production domain)" : "✓ src/lib/site-url.ts: already exists");
}

// ─── 2. Patch src/app/layout.tsx ───────────────────────────────────────
function patchLayout() {
  const file = "src/app/layout.tsx";
  if (!existsSync(file)) {
    actions.push(`⚠️  ${file} not found - skipping layout patch`);
    return;
  }

  let content = readFileSync(file, "utf8");
  let changed = false;

  // Build the new metadata block. No openGraph.images: src/app/opengraph-image.tsx (step 5) is
  // the share image, and Next.js writes its og:image tags.
  const newMetadata = `export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "${tsQuote(projectName)}",
    template: "%s | ${tsQuote(projectName)}",
  },
  description: "${tsQuote(description)}",
  openGraph: {
    type: "website",
    locale: "${tsQuote(locale)}",
    siteName: "${tsQuote(projectName)}",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};`;

  // Replace the existing `export const metadata: Metadata = { ... };` block
  if (content.includes("metadataBase")) {
    // An earlier run's own lines, brought up to date (and only them).
    const oldBase = `metadataBase: new URL(${OLD_BASE}),`;
    if (content.includes(oldBase)) {
      content = content.replace(oldBase, "metadataBase: new URL(siteUrl()),");
      actions.push(`✓ ${file}: metadataBase reads the site's address (no more localhost in production)`);
      changed = true;
    } else {
      actions.push(`✓ ${file}: metadata already enriched (metadataBase present)`);
    }
    if (OLD_OG_IMAGES.test(content) && !existsSync("public/og-image.png")) {
      content = content.replace(OLD_OG_IMAGES, "");
      actions.push(`✓ ${file}: the reference to a missing public/og-image.png removed (the generated share image replaces it)`);
      changed = true;
    }
  } else {
    const metadataRe = /export\s+const\s+metadata\s*:\s*Metadata\s*=\s*\{[\s\S]*?\};/;
    if (metadataRe.test(content)) {
      content = content.replace(metadataRe, newMetadata);
      actions.push(`✓ ${file}: metadata enriched (title template, openGraph, twitter, robots)`);
      changed = true;
    } else {
      // No existing metadata export - inject it after the imports
      const lastImport = content.match(/^(?:import[^;]+;[\r\n]*)+/);
      const metadataImport = content.includes("type Metadata")
        ? ""
        : 'import { type Metadata } from "next";\n';
      const insertion = `\n${metadataImport}${newMetadata}\n\n`;
      if (lastImport) {
        content = content.replace(lastImport[0], lastImport[0] + insertion);
      } else {
        content = insertion + content;
      }
      actions.push(`✓ ${file}: metadata export added`);
      changed = true;
    }
  }

  // Update <html lang="..."> if it's the default "en"
  const htmlLangRe = /<html([^>]*?)lang="[^"]*"([^>]*?)>/;
  if (htmlLangRe.test(content)) {
    const current = content.match(htmlLangRe);
    if (current && !current[0].includes(`lang="${htmlLang}"`)) {
      content = content.replace(htmlLangRe, `<html$1lang="${htmlLang}"$2>`);
      actions.push(`✓ ${file}: <html lang> set to "${htmlLang}"`);
      changed = true;
    } else {
      actions.push(`✓ ${file}: <html lang> already "${htmlLang}"`);
    }
  }

  // Insert JSON-LD WebSite schema inside <body>, before {children} (idempotent).
  // T3 renders the body content on a single line like `<X>{children}</X>`, so a
  // naive insertion before `{children}` produces jammed-up markup. Detect that
  // pattern and explode it into properly-indented JSX; fall back to a simple
  // before-{children} insertion if the one-liner pattern isn't found.
  if (content.includes('"@context": "https://schema.org"')) {
    const oldUrl = `url: ${OLD_BASE},`;
    if (content.includes(oldUrl)) {
      content = content.replace(oldUrl, "url: siteUrl(),");
      actions.push(`✓ ${file}: JSON-LD reads the site's address`);
      changed = true;
    } else {
      actions.push(`✓ ${file}: JSON-LD already present`);
    }
  } else {
    const oneLineRe = /^([ \t]+)(<(\w[\w.-]*)[^>]*>)\{children\}(<\/\3>)\s*$/m;
    const buildScript = (indent) =>
      `${indent}<script\n` +
      `${indent}  type="application/ld+json"\n` +
      `${indent}  dangerouslySetInnerHTML={{\n` +
      `${indent}    __html: JSON.stringify({\n` +
      `${indent}      "@context": "https://schema.org",\n` +
      `${indent}      "@type": "WebSite",\n` +
      `${indent}      name: "${tsQuote(projectName)}",\n` +
      `${indent}      url: siteUrl(),\n` +
      `${indent}    }),\n` +
      `${indent}  }}\n` +
      `${indent}/>\n`;

    const oneLineMatch = content.match(oneLineRe);
    if (oneLineMatch) {
      const [, outerIndent, openTag, , closeTag] = oneLineMatch;
      const innerIndent = outerIndent + "  ";
      const replacement =
        `${outerIndent}${openTag}\n` +
        buildScript(innerIndent) +
        `${innerIndent}{children}\n` +
        `${outerIndent}${closeTag}`;
      content = content.replace(oneLineRe, replacement);
      actions.push(`✓ ${file}: JSON-LD WebSite schema inserted (exploded one-liner wrapper)`);
      changed = true;
    } else {
      // Fallback: {children} on its own line or in an unknown structure.
      const childrenLineRe = /^([ \t]*)\{children\}/m;
      const m = content.match(childrenLineRe);
      if (m) {
        const indent = m[1];
        content = content.replace(childrenLineRe, buildScript(indent) + `${indent}{children}`);
        actions.push(`✓ ${file}: JSON-LD WebSite schema inserted (before standalone {children})`);
        changed = true;
      } else {
        actions.push(`⚠️  ${file}: could not find {children} - JSON-LD not inserted`);
      }
    }
  }

  if (content.includes("siteUrl()")) content = withSiteUrlImport(content);
  if (changed) writeFileSync(file, content);
}

// ─── 3. src/app/robots.ts ──────────────────────────────────────────────
const ROBOTS_SOURCE = `import type { MetadataRoute } from "next";
import { siteUrl } from "~/lib/site-url";

// robots.txt, served by Next.js at /robots.txt (generated by Hypervibe). The sitemap's address
// follows the site's (src/lib/site-url.ts). /api/ stays closed to robots, except the share images
// a site may serve under /api/og: a social network's robot that follows robots.txt (X's does) shows
// a shared link without its picture when the image is blocked. /geo adds the rules for AI robots.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/api/og"], disallow: ["/api/"] }],
    sitemap: \`\${siteUrl()}/sitemap.xml\`,
  };
}
`;

function writeRobots() {
  const file = "src/app/robots.ts";
  const legacy = "public/robots.txt";
  if (existsSync(file)) {
    actions.push(`✓ ${file}: already exists (not overwritten)`);
    if (existsSync(legacy)) actions.push(`⚠️  ${legacy} exists too: with both, Next.js serves the static file in production and ignores robots.ts (an error in development) - keep robots.ts, it reads the site's address`);
    return;
  }
  if (existsSync(legacy)) {
    if (!sameText(readFileSync(legacy, "utf8"), OLD_ROBOTS)) {
      actions.push(`⚠️  ${legacy}: changed by the project, kept as it is (robots.ts not created: next to it, it would be ignored). Check that it names the sitemap: "Sitemap: <site address>/sitemap.xml"`);
      return;
    }
    unlinkSync(legacy);
    actions.push(`✓ ${legacy}: the earlier static file removed (replaced by ${file})`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, ROBOTS_SOURCE);
  actions.push(`✓ ${file}: created (robots.txt with the sitemap's address)`);
}

// ─── 4. src/app/sitemap.ts ─────────────────────────────────────────────
const OLD_SITEMAP = `import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Add every public page here as it's created. Exclude noindex pages (e.g. admin, preferences).
  const pages = [
    { path: "", changeFrequency: "weekly" as const, priority: 1.0 },
  ];

  return pages.map((page) => ({
    url: \`\${baseUrl}\${page.path}\`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
`;

const SITEMAP_SOURCE = `import type { MetadataRoute } from "next";
import { siteUrl } from "~/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteUrl();

  // Add every public page here as it's created. Exclude noindex pages (e.g. admin, preferences).
  // No priority nor changeFrequency: Google ignores both. lastModified only with a page's real
  // date of change (a blog post's, say), never the build's: Google trusts it only when accurate.
  const pages: { path: string; lastModified?: Date }[] = [{ path: "" }];

  return pages.map((page) => ({
    url: \`\${baseUrl}\${page.path}\`,
    ...(page.lastModified ? { lastModified: page.lastModified } : {}),
  }));
}
`;

function writeSitemap() {
  const file = "src/app/sitemap.ts";
  if (existsSync(file)) {
    const current = readFileSync(file, "utf8");
    if (sameText(current, OLD_SITEMAP)) {
      writeFileSync(file, SITEMAP_SOURCE);
      actions.push(`✓ ${file}: brought up to date (the site's address, no ignored fields)`);
      return;
    }
    const oldLine = `const baseUrl = ${OLD_BASE};`;
    if (current.includes(oldLine)) {
      writeFileSync(file, withSiteUrlImport(current.replace(oldLine, "const baseUrl = siteUrl();")));
      actions.push(`✓ ${file}: reads the site's address (no more localhost in production)`);
      return;
    }
    actions.push(`✓ ${file}: already exists (not overwritten)`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SITEMAP_SOURCE);
  actions.push(`✓ ${file}: created`);
}

// ─── 5. src/app/opengraph-image.tsx ────────────────────────────────────
function writeOgImage() {
  const file = "src/app/opengraph-image.tsx";
  if (hasOwnOgImage()) {
    actions.push("✓ share image: the project has its own (not overwritten)");
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  // The texts go in as string expressions ({"..."}), never as raw JSX text: an apostrophe there
  // breaks next build (react/no-unescaped-entities).
  const content = `import { ImageResponse } from "next/og";

// The share image of every page that has none of its own (generated by Hypervibe): drawn by
// next/og from the site's name and description, served by Next.js at /opengraph-image with its
// og:image tags. Replace it with a designed picture (an opengraph-image.png in this folder)
// whenever you like.
export const alt = ${JSON.stringify(projectName)};
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#111827",
          color: "#f9fafb",
        }}
      >
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>{${JSON.stringify(projectName)}}</div>
        <div style={{ fontSize: 34, marginTop: 28, lineHeight: 1.35, color: "#d1d5db" }}>{${JSON.stringify(description)}}</div>
      </div>
    ),
    size,
  );
}
`;
  writeFileSync(file, content);
  actions.push(`✓ ${file}: created (the share image, drawn from the site's name and description)`);
}

// ─── Run ───────────────────────────────────────────────────────────────
writeSiteUrl();
patchLayout();
writeRobots();
writeSitemap();
writeOgImage();

console.log("");
console.log("Base SEO:");
for (const a of actions) console.log(`  ${a}`);
console.log("");
console.log("✅ Base SEO applied.");
