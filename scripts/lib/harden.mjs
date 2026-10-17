// Politique de sécurité imposée par l'usine à chaque app publiée. Elle est
// insérée par la porte avant le contrôle navigateur (une app qui casse sous
// cette politique est refusée) puis vérifiée de nouveau à l'assemblage.
// connect-src 'none' : aucune requête, WebSocket ou beacon vers un serveur,
// même lancé tard ou après une action de l'utilisateur.

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'none'; media-src 'self' data:; frame-src 'none'; worker-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="no-referrer">`;

export function hasFactoryCsp(html) {
  return html.includes(CSP_META);
}

/** Insère la politique juste après <head>, avant tout script ou style. */
export function harden(html) {
  if (hasFactoryCsp(html)) return html;
  const m = /<head(\s[^>]*)?>/i.exec(html);
  if (!m) throw new Error("pas de <head> où insérer la politique de sécurité");
  const at = m.index + m[0].length;
  return html.slice(0, at) + CSP_META + html.slice(at);
}
