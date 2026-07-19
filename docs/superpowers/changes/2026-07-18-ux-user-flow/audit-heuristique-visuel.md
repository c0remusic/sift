# Sift — Audit heuristique + critique visuelle

> Livrable 2 du chantier UX/UI (après `full-spec-user-flow.md`). Trois assises :
> heuristique conceptuel (Nielsen 10), contraste **WCAG calculé depuis les tokens
> OKLCH** de `frontend/styles.css`, et **critique visuelle sur la VRAIE app** —
> capturée via `tauri dev` + CDP WebView2 (port debug env, jamais en config), sur
> les données réelles d'Antoine (3904 morceaux, thème Sombre forcé). 2026-07-18.
>
> **Correction de méthode importante** : une première passe avait screenshoté la
> **maquette `app.js`** (serveur vite en navigateur) — non représentative (Antoine
> l'a signalé, à raison). La maquette est en clair avec des tuiles ; la vraie app
> est en sombre, master-detail de Sources, vocabulaire « Convertir »/« Écarter ».
> Cet audit distingue : findings **token** (valides partout, ex. contraste) et
> findings **app réelle** (les seuls valides pour le layout/comportement).

## 1. Findings prioritisés (à traiter)

| # | Finding | Sévérité | Écran | Fix |
|---|---|---|---|---|
| F1 | Contraste : `--color-text-tertiary` échoue WCAG AA en clair (2.84–2.92 sur fond principal/file) ; `--color-text-quaternary` échoue partout en clair (1.7–2.1) et sur surface en sombre (2.40) — et portent du texte signifiant | MAJEUR | tous | Assombrir tertiary/quaternary à ≥4.5:1, ou réserver quaternary au décoratif. `:root` clair ET sombre |
| F2 | Jargon d'erreur brut à l'utilisateur : « open failed… (os error 2) » | MAJEUR | Revue | Humaniser (« Le fichier a été déplacé ou supprimé depuis la détection ») |
| F3 | Signaux contradictoires Rekordbox : bandeau « XML illisible » mais lignes de synchro « à jour » | MOYEN | Rekordbox | Quand XML non lié/illisible → lignes « indisponible », pas « à jour » |
| F4 | « File vide » affiché à côté d'un morceau en Revue + « 3904 traités » | MOYEN | Revue | Clarifier l'état File (pending vs traités) ; ne pas dire « vide » quand un morceau est en cours |
| F5 | Élément flottant « Export clé USB… » persiste sur le Journal (mauvais écran) | MOYEN | Journal | Scoper le hint à Rekordbox/USB, le retirer au changement de vue |
| F6 | `content.md` périmé : app dit « Convertir »/« Écarter », doc dit « Ranger »/« Jeter » | MINEUR | doc | Resynchroniser `content.md` sur les libellés réels (ou décider du libellé canonique) |
| F7 | « Convertir » (bouton) sous-vend le « ranger » du principe « déplacer = encoder + ranger » | MINEUR | Revue | Décision de contenu : garder Convertir, ou « Convertir + ranger » ? |

## 2. Heuristiques Nielsen (10) — corrigé sur l'app réelle

- **1. Visibilité de l'état — PARTIEL/MAJEUR.** Fort : breadcrumb (« Accueil › complete »), badges de compte réels (« 2670 nouveaux », « Revoir 3904 morceaux »), progression d'encodage. Faible : pas d'indicateur global de conversion (cf. friction #2 du design) ; incohérences F3 (XML/à jour) et F4 (File vide).
- **2. Correspondance monde réel — PASS.** Vocabulaire DJ (Discogs, CDJ, lossless, bacs House/Deep/Techno), français, sobre. Réserve F7 (Convertir vs ranger).
- **3. Contrôle et liberté — PASS.** Écartés (rejeter ≠ effacer, re-sourcer/corbeille + revert), Journal (session/historique), confirmations, bouton Convertir désactivé sans destination. Solide.
- **4. Cohérence et standards — PARTIEL/MOYEN.** Nav, badges, tokens cohérents. Écarts : F5 (hint qui fuit), F6 (doc↔app). La dérive intra-projet reste un risque (historique de corrections `design-system-states`).
- **5. Prévention d'erreur — PASS (force).** Bouton Convertir désactivé sans destination, jeton Discogs masqué (œil), formatage USB « seuls disques amovibles », anti-upscale + backup master.db (backend). Le socle « inacceptable » du PRD tient à l'écran.
- **6. Reconnaissance vs rappel — PARTIEL/MAJEUR (aujourd'hui).** Le rangement exige de rappeler sa structure de dossiers → c'est exactement la suggestion de destination du design §3.1. La structure par genre (Réglages : House/Deep, Techno) valide l'approche style-Discogs→bac.
- **7. Flexibilité et efficacité — PASS.** Mode Détail/Lot, **raccourcis clavier affichés** (SPACE/ENTER/BKSP/HAUT-BAS), facettes Bibliothèque (Dossiers/Genres/Artistes), filtres (Tous/Lossless/MP3/Doublons), vues liste/grille. (Corrige la réserve de la passe conceptuelle.)
- **8. Esthétique et minimalisme — PASS.** Sombre sobre, surface continue, densité maîtrisée, pas de cartes-dans-cartes, badges sémantiques. L'intention design est tenue au rendu réel.
- **9. Erreurs : reconnaître/diagnostiquer/réparer — PARTIEL/MAJEUR.** Bon : erreurs remontées (pas avalées), Rekordbox humanisé (« relie un fichier »), re-source/undo. Faible : **F2** (os error 2 brut), et l'erreur d'analyse ne propose pas d'action (jeter/re-sourcer directement depuis le message).
- **10. Aide et documentation — PARTIEL/MINEUR.** Empty states actionnables (Journal « Ouvrir Revue », Écartés), explicatifs en Réglages (Discogs, dossier racine, thème), « obtenir un jeton ». Manque : premier-run balisé (design §3.3), aide contextuelle sur Rekordbox (tiers) et USB.

## 3. Contraste WCAG (calculé, OKLCH→sRGB — valide app réelle, tokens partagés)

**Clair** (texte / fond) : primary AAA (10–12) · secondary AA (5.7–7) · **tertiary
FAIL 2.84–2.92** (AA-large 3.48 sur surface) · **quaternary FAIL 1.7–2.1** ·
warning AA-large 4.11 · danger/success/info AA.
**Sombre** : primary/secondary AAA/AA · tertiary AA 5.05 (large 3.29 sur surface) ·
**quaternary AA-large 3.68, FAIL 2.40 sur surface**.
Verdict : tertiary/quaternary sous le seuil AA pour texte normal — or ils portent
sous-labels, noms de fichiers mono, liens « afficher », badges nav (F1).

## 4. Critique visuelle — 7 lentilles (app réelle)

- **Hiérarchie 8/10** : titre → contenu → actions, ordre de décision respecté (Revue). Bémol : chip « doublon » (haut) loin de « Écarter (doublon) » (bas).
- **Clarté 8/10** : Accueil (Sources + « Revoir X morceaux ») et Journal (empty state + Ouvrir Revue) très lisibles ; Revue dense mais expert-friendly.
- **Cohérence 7/10** : forte intra-écran ; F5/F6 en écart.
- **Contraste 6/10** : F1 (tertiary/quaternary), confirmé au rendu sombre (mono/labels faibles).
- **Alignement 8/10** : grilles/tables/facettes propres.
- **White space 7/10** : Revue a un grand vide entre métadonnées et barre d'action.
- **CTA 9/10** : « Revoir 3904 morceaux » (vert) et « Choisis une destination pour convertir » (désactivé jusqu'à destination) — excellents, destination-first.

## 5. Observations écran par écran (app réelle)

- **Accueil** : master-detail Sources (complete 2670 / MUSIQUE A TRIER 1234), détail = dossier surveillé + couleur + toggle + Retirer (danger). CTA vert « Revoir 3904 morceaux ». Breadcrumb.
- **Revue** : poste de décision ; erreur d'analyse live (F2), badge « LECTURE INCOMPLÈTE », vocabulaire Convertir/Écarter, raccourcis affichés, destination-first, « File vide » ambigu (F4).
- **Écartés** : « 3 à re-sourcer · 0 en corbeille », liste avec nom de fichier mono, « Copier », chips « à re-sourcer », revert + corbeille. Conforme au design (rejet réversible).
- **Bibliothèque** : 5 tuiles (Total/Lossless/MP3/Doublons/À re-sourcer), facettes Dossiers/Genres/Artistes, recherche + filtres + liste/grille, table triable. 1 piste filée (peu converti à ce stade).
- **Rekordbox** : explicatif du flux, **erreur « XML illisible — relie un fichier »** + « Changer de XML lié », lignes Fichiers/Métadonnées/Pochettes/Playlists « à jour » (F3).
- **Journal** : « Session courante | Tout l'historique », empty state actionnable « Ouvrir Revue ».
- **Réglages** : Discogs (jeton masqué + œil + « obtenir un jeton »), Bibliothèque (dossier racine `Desktop\KEPT`, arborescence par genre), Apparence (Thème Auto/Clair/**Sombre**), Formater clé USB (disques amovibles ; « impossible de lister » + Actualiser).

## 6. Suite

- Corriger `content.md` (F6) — décider le libellé canonique Convertir/Écarter.
- F1 (contraste) : édition token dans `:root` clair+sombre, revérifier WCAG.
- F2/F3/F4/F5 : correctifs ciblés dans les vues concernées.
- Captures réelles transitoires (`C:\dev\real-*.png`) : non versionnées, à retirer au nettoyage. tauri dev encore ouvert.
