// Mesure d'usage anonyme des apps, sans cookie ni donnée personnelle.
// Le compteur est un script de l'usine, servi à la racine du site : il envoie
// une image de comptage à l'ouverture de l'app, puis une seule fois quand le
// visiteur s'en sert vraiment (premier clic, saisie ou touche). Il ne lit rien
// de ce qui est saisi. Il se tait si le navigateur demande de ne pas être suivi
// (Do Not Track, Global Privacy Control) ou s'il est piloté par un robot.
//
// Le kill à J+30 lit le nombre de visiteurs de l'événement `used-<slug>`.

export const USED_EVENT = (slug) => `used-${slug}`;

/** Code GoatCounter (sous-domaine) depuis l'environnement, ou null si non configuré. */
export function measureCode(env = process.env) {
  const code = (env.GOATCOUNTER_CODE ?? "").trim();
  return /^[a-z0-9-]{2,40}$/.test(code) ? code : null;
}

export function countOrigin(code) {
  return code ? `https://${code}.goatcounter.com` : null;
}

export const COUNTER_JS = `// Compteur d'usage anonyme de Flop Factory : aucune donnée saisie n'est lue ni envoyée.
(() => {
  const me = document.currentScript;
  const origin = me && me.dataset.origin;
  const slug = me && me.dataset.slug;
  if (!origin || !slug) return;
  if (navigator.webdriver || navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;
  const send = (path, event) => {
    const img = new Image();
    img.src = origin + "/count?p=" + encodeURIComponent(path) + (event ? "&e=true" : "") + "&rnd=" + Math.random().toString(36).slice(2);
  };
  send("/apps/" + slug + "/", false);
  let used = false;
  const onUse = () => {
    if (used) return;
    used = true;
    send("used-" + slug, true);
    for (const t of ["pointerdown", "keydown", "input"]) removeEventListener(t, onUse, true);
  };
  for (const t of ["pointerdown", "keydown", "input"]) addEventListener(t, onUse, { capture: true, passive: true });
})();
`;

/** Balise du compteur, à insérer avant </body>. */
export function counterTag(prefix, origin, slug) {
  return `<script src="${prefix}ff-count.js" data-origin="${origin}" data-slug="${slug}"></script>`;
}
