# Flop Factory

Une usine qui crée des webapps à la chaîne, sans intervention humaine, dans un budget fixe de tokens par jour. Elle produit beaucoup, mesure, et tue vite ce qui ne prend pas.

Phase actuelle : **Chaîne de build** (phase 2). Porte de sortie : trois apps en ligne, construites à partir d'une idée sans humain. Le Socle (une app livrée sans humain) est validé depuis le 17 octobre 2026.

## Comment ça tourne

Chaque matin, le workflow [Usine](.github/workflows/usine.yml) fait avancer une app d'une idée à la mise en ligne, en quatre jobs isolés :

1. **agent** : il s'arrête si un fichier `STOP` est présent. Sinon il vérifie les garde-fous, puis il choisit la prochaine idée de [`factory/ideas.json`](factory/ideas.json) qui n'est ni en ligne ni abandonnée. Il enchaîne alors trois runs bornés, chacun dans son dossier :
   - **spec** : l'idée devient `spec.json`, avec ses critères d'acceptation `AC-n`. Le code de l'usine valide la spec ; si elle est refusée, rien n'est construit.
   - **build** : il produit `index.html`, `style.css`, `app.js` et `test.mjs`. Chaque critère doit afficher `ok AC-n`.
   - **revue** : un autre agent note l'app de 0 à 10 et liste les défauts bloquants. Il travaille sur une copie des seuls fichiers acceptés, et sa note ne peut que bloquer.

   Ce job ne reçoit que la clé API, jamais de jeton git.
2. **gate** : il repart d'un checkout neuf en lecture seule. Il revalide la spec et contrôle les fichiers (à plat, extensions et taille bornées, aucune ressource externe, aucun secret, aucun cookie). Il rejoue `test.mjs` dans bubblewrap, sans réseau, environnement vidé, sur une copie jetable : chaque critère doit être vérifié. Enfin il charge l'app dans Chromium à 375 et 1280 px. Il refuse si la page fait une erreur JS, une requête vers un autre site, déborde, ou si la page est vide.
3. **records** : c'est le seul job qui écrit, sur la branche `data`. Il valide le ledger, puis l'**arbitre** décide. L'arbitre est du code, pas un modèle. Il dit *go* si la porte est passée, si la revue n'a aucun défaut bloquant et si sa note est au moins égale à `reviewMinScore`. Sinon il dit *retry*, et le modèle monte d'un cran après deux échecs. Après `maxAttempts` échecs, il dit *abandon*. Un arrêt ou un budget épuisé ne consomme pas de tentative.
4. **deploy** : sur *go*, il assemble le site depuis `data`. Il produit le catalogue, les mentions légales, et chaque app sous `apps/<slug>/` avec le pied de page légal ajouté par l'usine. Il publie le tout sur GitHub Pages et vérifie que l'app répond en ligne.

## Ce qui protège l'usine

| Couche | Mécanisme | Où |
| --- | --- | --- |
| Budget | 5 €/jour répartis par atelier. Plafond par run passé à `--max-budget-usd`. Un coût inconnu ou un run tué compte pour le plafond entier. | `scripts/lib/budget.mjs` |
| Sandbox | Bash tourne dans bubblewrap : écriture limitée au dossier de travail, aucun réseau, variables d'identification retirées, mode strict (pas de repli hors sandbox). | `harness/overlay/run-settings.json` |
| Garde-fous | Les confirmations du harness amont deviennent des refus. Le hook est fail-closed. Il ajoute ses propres règles : clés live, suppressions, achats, lecture de l'environnement, agents imbriqués, écritures hors du dossier de travail. | `harness/overlay/hooks/ci-guard.mjs` |
| Isolation | Le code de l'agent ne s'exécute jamais dans un job qui détient un droit d'écriture. Le ledger n'est accepté que s'il prolonge celui du dépôt. | `usine.yml`, `scripts/merge-records.mjs` |
| Qualité | Spec revalidée, fichiers bornés, ressources externes interdites, scan de secrets, recherche de la clé sous plusieurs encodages, tests rejoués en sandbox, contrôle dans un vrai navigateur. | `scripts/quality-gate.mjs`, `scripts/lib/`, `scripts/leak-check.mjs` |
| Décision | Arbitre déterministe : une revue de modèle peut bloquer une app, jamais l'imposer. | `scripts/arbiter.mjs` |
| Sujets | Une liste noire est injectée dans chaque run, car l'éditeur est une personne physique. | `factory/blocklist.json` |
| Arrêt | Un fichier `STOP` à la racine arrête l'usine. | — |

Chaque page publiée porte une politique de sécurité (CSP) posée par l'usine : aucun script ou style venu d'ailleurs, et `connect-src 'none'`, donc aucune donnée ne peut partir vers un serveur. La porte charge l'app sous cette même politique. Limites connues : les apps partagent une même origine (`everssteeve.github.io`), donc une app peut lire le `localStorage` d'une autre ; les lignes `ok AC-n` sont affichées par le test de l'agent lui-même, la revue et le navigateur servent de contre-poids, pas de preuve.

Risque résiduel assumé : le processus Claude Code détient la clé API pour appeler le modèle. La sandbox et les hooks rendent son vol difficile, sans le rendre impossible. D'où une clé dédiée, dans un workspace dédié, avec une limite de dépense mensuelle posée dans la Console. C'est le seul plafond que rien dans ce dépôt ne peut contourner.

## Mise en route

1. Dans la Console Anthropic, créer une clé API dans un workspace dédié et lui poser une **limite de dépense mensuelle** (environ 175 $, soit 5 €/jour sur 30 jours).
2. Dans ce repo : Settings > Secrets and variables > Actions > `ANTHROPIC_API_KEY`.
3. Settings > Pages > Source : **GitHub Actions**.
4. Settings > Rules : le ruleset « Protection de main » exige une PR, une approbation et la CI verte. Aucun workflow ne peut le contourner, pas même le futur cerveau. Le propriétaire peut fusionner ses propres PR sans approbation, mais jamais pousser directement. Le ledger et les journaux vivent sur la branche `data`, seule branche que le bot écrit.
5. Actions > Usine > Run workflow pour un premier passage.

## Développer

```bash
node --test test/*.test.mjs            # suites de l'usine (bubblewrap et playwright requis pour la porte)
node harness/upstream/hooks/test-hooks.mjs   # 779 vérifications amont
node scripts/build-plugin.mjs          # plugin dans dist/plugin
```

## Structure

```
factory/      config, idées, liste noire, prompts (spec, build, revue)
harness/      upstream/ (copie exacte, jamais modifiée) + overlay/ (surcouche usine)
scripts/      chaîne (pipeline), run-atelier, porte qualité, arbitre, assemblage du site, garde-fous
test/         suites node:test
```

Le harness amont est [hypervibe-harness](https://github.com/flavien-ia/hypervibe-harness) de Flavien Chervet (Apache 2.0). Voir [NOTICE](NOTICE).
