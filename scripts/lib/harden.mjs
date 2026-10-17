// Politique de sécurité imposée par l'usine à chaque page publiée. Elle est
// insérée par la porte avant le contrôle navigateur (une app qui casse sous
// cette politique est refusée) puis reposée à l'assemblage.
// connect-src 'none' : aucune requête, WebSocket ou beacon vers un serveur,
// même lancé tard ou après une action de l'utilisateur. La seule ouverture est
// l'image de comptage anonyme de l'usine (img-src vers une origine unique),
// ajoutée à l'assemblage quand la mesure est configurée.

const COUNT_ORIGIN = /^https:\/\/[a-z0-9-]{2,40}\.goatcounter\.com$/;

export function cspFor({ countOrigin } = {}) {
  if (countOrigin && !COUNT_ORIGIN.test(countOrigin)) throw new Error(`origine de mesure refusée : ${countOrigin}`);
  const img = countOrigin ? `'self' data: ${countOrigin}` : "'self' data:";
  return (
    `default-src 'self'; script-src 'self'; style-src 'self'; img-src ${img}; font-src 'self'; ` +
    "connect-src 'none'; media-src 'self' data:; frame-src 'none'; worker-src 'none'; object-src 'none'; " +
    "base-uri 'none'; form-action 'none'"
  );
}

export const CSP = cspFor();

function metaFor(opts) {
  return `<meta http-equiv="Content-Security-Policy" content="${cspFor(opts)}"><meta name="referrer" content="no-referrer">`;
}

export const CSP_META = metaFor();

// Toute politique posée par l'usine, quelle que soit sa variante.
const FACTORY_META = /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';[^"]*"><meta name="referrer" content="no-referrer">/g;

export function hasFactoryCsp(html, opts) {
  return html.includes(metaFor(opts));
}

/** Pose la politique juste après <head>, avant tout script ou style, en remplaçant celle de l'usine. */
export function harden(html, opts) {
  const clean = html.replace(FACTORY_META, "");
  // Les commentaires sont masqués : un <head> dans un commentaire ne compte pas.
  const masked = clean.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
  const m = /<head(\s[^>]*)?>/i.exec(masked);
  if (!m) throw new Error("pas de <head> où insérer la politique de sécurité");
  const at = m.index + m[0].length;
  return clean.slice(0, at) + metaFor(opts) + clean.slice(at);
}
