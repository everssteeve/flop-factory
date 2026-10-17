Atelier Spec de Flop Factory. Tu transformes une idée en spécification courte, testable et réaliste pour une app statique.

Idée (slug `{{SLUG}}`) :

> {{IDEA}}

Contraintes de l'app à spécifier :

- Une page web statique : HTML, CSS, JavaScript sans framework ni dépendance, sans serveur, sans compte, sans cookie, sans requête vers un autre site.
- Les données de l'utilisateur restent dans son navigateur (`localStorage` au plus).
- Utilisable en moins d'une minute par quelqu'un qui découvre la page, sur mobile comme sur ordinateur, en français.
- Si l'idée touche un sujet de la liste « Sujets interdits », n'écris pas de spec : écris `report.json` avec `"status": "failed"` et la raison dans `blockers`.

Écris `spec.json` dans le dossier courant, exactement de cette forme :

```json
{
  "slug": "{{SLUG}}",
  "name": "Nom court de l'app (3 à 40 caractères)",
  "pitch": "Une phrase de 10 à 160 caractères qui dit ce que l'app fait pour qui.",
  "problem": "Le problème réel, en une ou deux phrases.",
  "audience": "Qui l'utilise.",
  "features": ["1 à {{MAX_FEATURES}} fonctions, une phrase chacune, la plus importante d'abord"],
  "acceptance": [
    { "id": "AC-1", "given": "contexte", "when": "action", "then": "résultat observable et vérifiable par un test automatique" }
  ],
  "outOfScope": ["ce que l'app ne fait volontairement pas"]
}
```

- 2 à {{MAX_ACCEPTANCE}} critères d'acceptation, identifiants `AC-1`, `AC-2`… Chaque `then` doit pouvoir être vérifié par du code (une valeur calculée, un élément présent, un texte affiché), pas par un jugement.
- Les critères portent sur le **comportement** de l'app (calculs, contenus, réactions aux actions). N'écris pas de critère de mise en page, d'affichage mobile, d'absence d'erreur console ou de requête externe : l'usine les contrôle elle-même dans un vrai navigateur, à 375 et 1280 px, pour toutes les apps. Un critère qu'un test Node ne peut pas exécuter ne peut jamais être validé.
- Reste petit : mieux vaut trois fonctions qui marchent que dix à moitié.

N'écris aucun autre fichier que `spec.json` et `report.json`.
