# /geo

Optimise votre site pour être **cité par les IA** (ChatGPT, Claude, Perplexity, Gemini, Copilot, les AI Overviews de Google). Complémentaire à `/seo` : un site bien classé sur Google n'est pas forcément cité par les IA, et vice versa.

## Quand l'utiliser

- Votre site a un **contenu informatif** (articles, FAQ, tutoriels, documentation, blog) que les IA pourraient citer en réponse aux questions de leurs utilisateurs
- Vous voulez **devenir une source de référence** pour les questions posées aux IA dans votre domaine
- Vous avez déjà lancé `/seo` et vous voulez compléter pour le canal "IA"

## Comment ça se passe

1. **Préflight SEO** : Hypervibe vérifie d'abord que les fondations SEO classiques sont en place (metadata, sitemap, robots.txt, JSON-LD WebSite) et reprend ce que `/seo` a déjà vérifié. Une page que Google ne peut pas indexer correctement ne sera pas non plus bien vue par les IA. Si quelque chose manque, Hypervibe vous suggère `/seo` d'abord.

2. **Les robots d'IA peuvent-ils lire vos pages ?** C'est le point le plus important, il passe en premier :
  - **Le texte sans JavaScript** : presque aucun robot d'IA n'exécute de JavaScript. Hypervibe charge vos pages comme eux et vérifie que leur texte principal est bien dans le HTML. Une page dont le texte s'affiche dans le navigateur est vide pour eux, aussi belle soit-elle.
  - **Le pare-feu** : Cloudflare, où Hypervibe range vos domaines, bloque par défaut les robots d'IA sur les nouveaux domaines depuis juillet 2025. Hypervibe lit ce réglage sur votre domaine.
  - **robots.txt** : ce qu'il dit à chaque robot d'IA, lu dans une liste datée et sourcée (chaque robot, son éditeur, son rôle : remplir l'index de recherche d'un moteur IA, lire une page à la demande pendant une conversation, ou collecter des pages pour entraîner des modèles).

3. **Le contenu citable** : format questions/réponses et blocs qui tiennent seuls, signaux de citabilité (dates, chiffres, sources), signaux E-E-A-T (expérience, expertise, autorité, confiance). Les détections automatiques sont des indices à relire, pas des fautes.

4. **Les paris, présentés comme tels** : le fichier `llms.txt` (aucun grand moteur ne confirme le lire pour ses réponses ; il ne coûte rien) et le balisage FAQ (une aide plausible, pas démontrée).

5. **IndexNow (optionnel)** : pour un site qui publie régulièrement, prévient Bing (dont l'index sert aussi Copilot) à chaque publication.

6. **Un score calculé, pas jugé** : une grille fixe, et le résultat gardé dans le projet, pour comparer d'une fois sur l'autre.

7. **Corrections proposées et appliquées** : texte rendu côté serveur, règles robots.txt selon votre choix, données structurées, propositions de contenu (que vous validez).

## Ce que ça crée pour vous

- Les règles pour les robots d'IA dans votre robots.txt, selon votre choix : tout laisser entrer, être cité sans servir à l'entraînement, ou tout fermer
- Des pages dont le texte se lit sans JavaScript, si certaines ne l'étaient pas
- Si vous le voulez : un `llms.txt`, le balisage FAQ, IndexNow
- Des suggestions de réécriture pour la citabilité (chiffres, dates, sources)
- Un rapport et son score, gardés dans le projet pour la prochaine fois
- Un contrôle guidé de vos citations : les questions que posent vos clients, posées aux IA, cité ou non

## Prérequis

- Le SEO de base doit être en place (`/seo` en amont si nécessaire)
- Votre site doit avoir du **contenu informatif** : un simple site vitrine sans contenu n'a pas vraiment matière à être cité par les IA

## Astuces

{{callout:tip|GEO = un nouveau canal de visibilité}}
Le SEO classique vous fait apparaître dans les résultats Google (liste bleue). Le GEO vise à **être cité par les IA dans leurs réponses**. Les deux ne sont pas identiques : un site qui sort en première page Google peut ne pas être cité par ChatGPT, et vice versa. Plus la part des recherches passe par les IA, plus le GEO compte.
{{/callout}}

{{callout:warning|D'abord, que les robots puissent lire}}
Le meilleur contenu ne sert à rien s'il est invisible pour les robots d'IA : une page dont le texte s'affiche par JavaScript, ou un domaine dont le pare-feu les refoule, ne sera jamais cité. C'est par là que Hypervibe commence.
{{/callout}}

{{callout:info|llms.txt = un pari, pas un standard}}
Le fichier `llms.txt` a été proposé par Jeremy Howard (Answer.AI) en septembre 2024. Aucun grand moteur d'IA n'a confirmé le lire pour construire ses réponses, et Google dit que sa recherche l'ignore. Il ne coûte rien : Hypervibe le propose, sans le présenter comme une garantie.
{{/callout}}

{{callout:warning|Citabilité = chiffres + dates + sources}}
Pour qu'une IA vous cite, elle doit **avoir confiance** dans votre contenu. Les signaux clés : chiffres précis (pas "beaucoup d'utilisateurs" mais "12 % des utilisateurs"), dates explicites (pas "récemment" mais "en mars 2026"), et liens vers les sources que vous citez. Hypervibe peut suggérer ces enrichissements page par page.
{{/callout}}
