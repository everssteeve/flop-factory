#!/usr/bin/env node
// test-email-templates.mjs - Two promises of the email templates (3.4.11, review of the lot 8):
//   - Resend's client is built at the first send, never when the module loads: the SDK refuses to
//     be built without a key, and every router that sends mail imports this module, so a project
//     without its key yet lost its whole API;
//   - a password reset request never tells the caller that the email failed (that would say the
//     account exists), and an unknown address waits about as long as a send takes.
// Reads the templates as text: they are TypeScript, copied into a project, never run here.
//
//   node scripts/tests/test-email-templates.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(ROOT, "templates", ...p), "utf8");

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${detail})`}`);
}

/** The lines of a module that run when it loads: outside any function, class or object body. */
function topLevel(text) {
  let depth = 0;
  const out = [];
  for (const line of text.split("\n")) {
    if (depth === 0) out.push(line);
    for (const c of line) {
      if (c === "{") depth += 1;
      if (c === "}") depth = Math.max(0, depth - 1);
    }
  }
  return out.join("\n");
}

console.log("── Resend : le client se construit au premier envoi ──");
const mail = read("email", "resend", "mail.ts");
check("aucun « new Resend( » ne s'exécute au chargement du module", !/new Resend\(/.test(topLevel(mail)) && /new Resend\(process\.env\.RESEND_API_KEY\)/.test(mail));
check("sans clé, l'envoi dit pourquoi au lieu de faire tomber le module", /if \(!process\.env\.RESEND_API_KEY\)\s*\{\s*throw new Error\(/.test(mail));
check("l'envoi passe par le client construit à la demande", /await resend\(\)\.emails\.send\(/.test(mail) && !/await resend\.emails\.send\(/.test(mail));
check("témoin : l'ancien module serait vu", /new Resend\(/.test(topLevel('import { Resend } from "resend";\nconst resend = new Resend(process.env.RESEND_API_KEY);\n')));

console.log("\n── Mot de passe oublié : la même réponse, que le compte existe ou non ──");
for (const v of ["resend", "brevo"]) {
  const t = read("auth", "users", `auth-router-with-reset-${v}.ts`);
  const start = t.indexOf("requestPasswordReset:");
  const body = t.slice(start, t.indexOf("return { success: true };", start));
  const tryAt = body.indexOf("try {");
  const sendAt = body.indexOf("await sendMail(");
  const catchAt = body.indexOf("} catch (e) {");
  check(`${v} : l'envoi est dans un try, son échec reste côté serveur`, tryAt > 0 && tryAt < sendAt && sendAt < catchAt && /console\.error\("\[auth\] password reset email not sent:"/.test(body), `${tryAt} ${sendAt} ${catchAt}`);
  check(`${v} : le catch ne relance rien et ne répond rien d'autre`, !/throw\b/.test(body.slice(catchAt, body.indexOf("} else {", catchAt))) && !/return\b/.test(body.slice(catchAt)));
  check(`${v} : une adresse inconnue attend à peu près le temps d'un envoi`, /await new Promise\(\(resolve\) => setTimeout\(resolve, 250 \+ Math\.floor\(Math\.random\(\) \* 400\)\)\);/.test(body.slice(body.indexOf("} else {"))));
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
