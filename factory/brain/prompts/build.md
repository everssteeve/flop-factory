Atelier Build de Flop Factory. Construis l'app décrite par `spec.json` (dans le dossier courant) :

```json
{{SPEC}}
```

Fichiers à produire dans le dossier courant, sans framework ni dépendance, sans rien télécharger :

- `index.html` : page en français, `<title>` égal au nom de l'app, `<meta name="viewport" content="width=device-width, initial-scale=1">`, lien vers `style.css`, script local `app.js` en `type="module"`. Aucune ressource externe (ni police, ni script, ni image distante), aucun lien `localhost`.
- `style.css` : lisible et sans débordement horizontal à 375 px de large comme à 1280 px, police système, contrastes suffisants, cibles tactiles d'au moins 44 px.
- `app.js` : la logique. Sépare les fonctions de calcul (exportées, sans accès au DOM) du branchement à la page, pour qu'elles soient testables sous Node. Aucune erreur dans la console au chargement.
- `test.mjs` : test Node sans dépendance (`node test.mjs`). Il importe les fonctions de `app.js` et lit `index.html` pour vérifier **chaque** critère d'acceptation. Pour chaque critère vérifié, il affiche une ligne `ok AC-n` (exactement, par exemple `ok AC-1`). Il sort avec le code 1 au premier échec.

L'usine publie la page sous une politique de sécurité stricte (`script-src 'self'; style-src 'self'; connect-src 'none'`). Donc : aucun `<script>` ni `<style>` en ligne, aucun attribut `style="…"` ni `onclick="…"` (y compris dans du HTML généré par `innerHTML`), aucun `fetch`, WebSocket ou beacon. Utilise des classes CSS et `addEventListener`. Une violation est une erreur de console, et la porte refuse l'app.

Pour un critère qui passe par la page (message d'erreur affiché, état restauré au rechargement, liste rendue), écris une fonction exportée qui fait tout le travail sauf toucher au DOM : par exemple `validate(saisie) → message`, `restore(storage) → état`, `renderItems(état) → [{ label, checked }]`. Le branchement à la page ne fait qu'appeler ces fonctions et afficher leur résultat, sans logique propre. `test.mjs` les appelle avec de vraies valeurs et un faux stockage (`{ getItem, setItem }` sur un objet). Chercher une chaîne dans le source n'est jamais un test. Chaque branche décrite par un critère (saisie invalide 0 ou 31, relecture du stockage au chargement) doit être appelée par `test.mjs` via ces fonctions exportées, y compris la fonction qui initialise l'état depuis le stockage, avec une valeur d'entrée qui déclenche cette branche, et le test compare le résultat exact (message, état, éléments).

Pour que `app.js` s'importe sous Node, ne touche au DOM que si `typeof document !== "undefined"`.

Lance `node test.mjs`. Corrige jusqu'à ce que toutes les lignes `ok AC-n` s'affichent et que le code de sortie soit 0. Ne modifie pas `spec.json`.

Le pied de page légal est ajouté par l'usine à la publication : n'en écris pas.

{{PREVIOUS}}N'installe aucun paquet, ne pousse rien, ne déploie rien. Termine par `report.json` comme le demandent les règles du run.
