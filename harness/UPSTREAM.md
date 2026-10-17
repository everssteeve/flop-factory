# Harness amont

`harness/upstream/` est une copie exacte de [hypervibe-harness](https://github.com/flavien-ia/hypervibe-harness), sans son dossier `.git`.

| Champ | Valeur |
| --- | --- |
| Commit | `f74fecac6909d388273641fd5cf052a225b0b767` |
| Date du commit | 2026-10-16 |
| Version du plugin | 3.4.13 |
| Copié le | 2026-10-17 |

Règle : ce dossier n'est jamais modifié à la main. Tout ce qui change pour l'usine vit dans `harness/overlay/` et s'applique au moment de `node scripts/build-plugin.mjs`. Une mise à jour amont = remplacer ce dossier par la nouvelle version, mettre à jour ce tableau, et laisser la CI rejouer toutes les suites.
