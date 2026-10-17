Phase Socle de Flop Factory : construire une app volontairement triviale pour tester la chaîne sans humain.

Crée dans le dossier courant un site statique d'une page, sans framework ni dépendance :

- `index.html` : titre « Flop Factory », une phrase expliquant que cette page a été construite et publiée sans intervention humaine, et la date de construction en clair.
- `style.css` : mise en page lisible sur mobile (< 640 px) et ordinateur, police système, pas de couleurs par défaut du navigateur.
- `test.mjs` : test Node sans dépendance (`node test.mjs`) qui vérifie que `index.html` existe, contient un `<title>`, une balise `<meta name="viewport">`, un lien vers `style.css`, et aucune URL `localhost`. Il sort avec le code 1 en cas d'échec.

Lance `node test.mjs`. S'il échoue, corrige jusqu'à ce qu'il passe.

N'installe aucun paquet, ne pousse rien, ne déploie rien : le workflow s'en charge après tes tests.

Termine par `report.json` comme le demandent les règles du run.
