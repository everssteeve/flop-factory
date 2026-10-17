# Flop Factory

Une usine qui crée des webapps à la chaîne, sans intervention humaine, dans un budget fixe de tokens par jour. Elle produit beaucoup, mesure, et tue vite ce qui ne prend pas.

Phase actuelle : **Socle** (semaines 1 et 2). Porte de sortie : une app livrée sans humain.

## Comment ça tourne

Chaque matin, le workflow [Usine](.github/workflows/usine.yml) enchaîne quatre jobs isolés :

1. **agent** — s'arrête si un fichier `STOP` est présent. Sinon il construit le plugin des runs autonomes, vérifie avec un vrai run que les garde-fous sont chargés (`printenv` et `git push` doivent être refusés), puis lance l'atelier Build avec Haiku, borné par l'enveloppe du jour. Il ne reçoit que la clé API et aucun jeton git. Il produit deux artefacts : le site, non fiable, et les enregistrements de coût.
2. **gate** — repart d'un checkout neuf en lecture seule et valide le site sans croire le rapport de l'agent.
3. **deploy** — publie sur GitHub Pages ce que la porte a validé, puis contrôle la page en ligne.
4. **records** — seul job qui écrit dans le dépôt. Il valide puis commite le ledger et les journaux sur la branche `data`.

## Ce qui protège l'usine

| Couche | Mécanisme | Où |
| --- | --- | --- |
| Budget | 5 €/jour répartis par atelier. Plafond par run passé à `--max-budget-usd`. Un coût inconnu ou un run tué compte pour le plafond entier. | `scripts/lib/budget.mjs` |
| Sandbox | Bash tourne dans bubblewrap : écriture limitée au dossier de travail, aucun réseau, variables d'identification retirées, mode strict (pas de repli hors sandbox). | `harness/overlay/run-settings.json` |
| Garde-fous | Les confirmations du harness amont deviennent des refus. Le hook est fail-closed. Il ajoute ses propres règles : clés live, suppressions, achats, lecture de l'environnement, agents imbriqués, écritures hors du dossier de travail. | `harness/overlay/hooks/ci-guard.mjs` |
| Isolation | Le code de l'agent ne s'exécute jamais dans un job qui détient un droit d'écriture. Le ledger n'est accepté que s'il prolonge celui du dépôt. | `usine.yml`, `scripts/merge-records.mjs` |
| Qualité | Contrôles du site, scan de secrets, recherche de la clé sous plusieurs encodages, tests rejoués sans secrets. | `scripts/quality-gate.mjs`, `scripts/leak-check.mjs` |
| Sujets | Une liste noire est injectée dans chaque run, car l'éditeur est une personne physique. | `factory/blocklist.json` |
| Arrêt | Un fichier `STOP` à la racine arrête l'usine. | — |

Risque résiduel assumé : le processus Claude Code détient la clé API pour appeler le modèle. La sandbox et les hooks rendent son vol difficile, sans le rendre impossible. D'où une clé dédiée, dans un workspace dédié, avec une limite de dépense mensuelle posée dans la Console. C'est le seul plafond que rien dans ce dépôt ne peut contourner.

## Mise en route

1. Dans la Console Anthropic, créer une clé API dans un workspace dédié et lui poser une **limite de dépense mensuelle** (environ 175 $, soit 5 €/jour sur 30 jours).
2. Dans ce repo : Settings > Secrets and variables > Actions > `ANTHROPIC_API_KEY`.
3. Settings > Pages > Source : **GitHub Actions**.
4. Settings > Rules : le ruleset « Protection de main » exige une PR, une approbation et la CI verte. Aucun workflow ne peut le contourner, pas même le futur cerveau. Le propriétaire peut fusionner ses propres PR sans approbation, mais jamais pousser directement. Le ledger et les journaux vivent sur la branche `data`, seule branche que le bot écrit.
5. Actions > Usine > Run workflow pour un premier passage.

## Développer

```bash
node --test test/*.test.mjs            # suites de l'usine
node harness/upstream/hooks/test-hooks.mjs   # 779 vérifications amont
node scripts/build-plugin.mjs          # plugin dans dist/plugin
```

## Structure

```
factory/      config, liste noire, prompts, ledger, journaux
harness/      upstream/ (copie exacte, jamais modifiée) + overlay/ (surcouche usine)
scripts/      run-atelier, budget, porte qualité, test des garde-fous, build du plugin
test/         suites node:test
```

Le harness amont est [hypervibe-harness](https://github.com/flavien-ia/hypervibe-harness) de Flavien Chervet (Apache 2.0). Voir [NOTICE](NOTICE).
