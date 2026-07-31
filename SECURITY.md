# Politique de sécurité

## Signaler une faille

**N'ouvrez pas d'issue publique pour un problème de sécurité.**

Utilisez le signalement privé de GitHub : onglet **Security** du dépôt →
**Report a vulnerability**. Le rapport n'est visible que par les mainteneurs
jusqu'à ce qu'un correctif soit publié.

Réponse sous 7 jours. Si vous n'avez aucune nouvelle passé ce délai, relancez
en mentionnant [@c0remusic](https://github.com/c0remusic) dans une issue —
sans décrire la faille.

## Ce qui compte particulièrement ici

Sift est une application de bureau qui tourne sur la machine de l'utilisateur.
Elle n'expose aucun service réseau, mais trois surfaces méritent une attention
particulière et un signalement si vous y trouvez un défaut :

- **La bibliothèque musicale locale.** L'application lit, déplace, réencode et
  supprime des fichiers audio. Tout ce qui permettrait d'agir hors des dossiers
  que l'utilisateur a explicitement désignés est une faille.
- **La base de données Rekordbox (`master.db`).** L'application lit et, pour
  certaines réparations, écrit dans la base d'un logiciel tiers. C'est la
  surface la plus sensible du projet : une écriture incorrecte peut abîmer la
  bibliothèque d'un DJ. La chaîne de sûreté (sauvegarde, vérification par
  round-trip, restauration) est un mécanisme de sécurité à part entière — un
  moyen de la contourner nous intéresse.
- **La frontière entre l'interface et le backend natif.** Sift est une
  application Tauri : la webview est traitée comme du code non fiable, et toute
  commande exposée valide ses entrées. Un chemin permettant à la webview
  d'obtenir une lecture ou une écriture arbitraire sur le disque est une faille.

## Ce qui n'en est pas une

- L'absence de signature de code sur les installeurs Windows et macOS. C'est
  connu, documenté dans [`docs/install-non-signe.md`](docs/install-non-signe.md),
  et différé pour raison de budget — pas un oubli.
- Les avertissements du système d'exploitation à l'installation, qui découlent
  du point précédent.

## Versions suivies

Le projet est en développement actif et n'a pas encore de version stable. Seule
la dernière version publiée reçoit des correctifs.
