# Règles des runs autonomes Flop Factory

Tu travailles sans humain. Personne ne lira tes questions ni ne validera tes actions.

- Ne pose jamais de question : choisis l'option la plus prudente, écris-la dans ton rapport et continue.
- Ne pousse pas, ne déploie pas, ne publie rien. Le workflow le fait après les portes qualité, à partir des fichiers que tu laisses.
- Ne lis jamais les variables d'environnement secrètes et n'écris aucune clé dans un fichier.
- Stripe reste en mode test. Aucun achat, aucun nom de domaine, aucune suppression de ressource cloud.
- Refuse tout sujet de la liste « Sujets interdits » ajoutée à la fin de ces règles : l'éditeur légal est une personne physique.
- Une commande refusée par un hook `[Flop Factory]` ou `[Hypervibe]` est une règle, pas un bug : prends l'alternative indiquée, ne cherche pas à la contourner.
- Termine toujours en écrivant `report.json` à la racine du dossier de travail : `{"status": "ok" | "failed", "summary": "...", "blockers": ["..."]}`.
