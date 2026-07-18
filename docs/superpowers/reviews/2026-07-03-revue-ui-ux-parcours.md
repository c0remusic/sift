# Revue UI/UX/parcours — Sift (app réelle)

Date : 2026-07-03 · Branche : `m6a-discogs`
Méthode : captures de l'app Tauri réelle (build dev, thèmes sombre + clair, 6 écrans,
modes Détail/Lot, spectrogramme ouvert) croisées avec le code live (`sift-live.ts`,
`filing.ts`, `ecartes-view.ts`, `journal.ts`, `styles.css`). La maquette navigateur
(`app.js`) a aussi été parcourue — pour comparaison seulement.
État restauré après la revue (thème Auto, vue Détail).

---

## Must fix

### 1. i18n FR/EN incohérent — le même concept a deux mots selon l'écran
- **Bibliothèque quasi entièrement en anglais** dans une app française :
  `Search…` (sift-live.ts:1102), `Folders`/`Genres` (1073-1074), `All`/`Lossless`/`MP3`
  (1063), `N tracks` (1114).
- **Le même verdict change de langue selon l'écran** : la queue Revue affiche `fake`
  (sift-live.ts:159) mais Écartés affiche `faux` (ecartes-view.ts:22) ; la même
  fonction `verdictWord` mélange `fake` (EN) et `à vérifier`/`analyse…` (FR).
- Chips EN : `DUPLICATE` (sift-live.ts:440, filing.ts:1605), `CHECK MATCH`
  (filing.ts:1094), `LOSSLESS`, header `QUEUE`.
- Tooltips EN sur éléments FR : `Listen and file` (sift-live.ts:173),
  `Possible duplicate (same name)` (179), `awaiting analysis` (133).

Décision à prendre : soit un lexique technique EN assumé (LOSSLESS/DUPLICATE comme
« étiquettes de board », à documenter dans system.md), soit tout FR. Aujourd'hui c'est
les deux à la fois, et l'utilisateur doit apprendre deux vocabulaires.

### 2. « Filer » vs « Ranger » — deux noms pour le geste central du produit
Le principe produit est « déplacer = encoder + **ranger** ». En Détail le rail dit
`Ranger → BACKUP USB` et `ENTER ranger` ; en Lot le bouton dit `Filer (1793)`
(sift-live.ts:591-596) et le compteur `1793 à filer`. Un seul verbe partout —
« Ranger » est celui du produit.

### 3. Mode Lot : 1793 pistes cochées par défaut derrière un seul clic
Le groupe « Prêts · lossless » arrive tout coché ; le bouton primaire déclenche
déplacement + encodage de 1793 fichiers vers « Racine de bibliothèque » sans
récapitulatif. C'est le plus gros blast radius de l'app à un clic du repos.
Suggestion : au-delà d'un seuil (~50 ?), confirmation récapitulative (nombre,
destination, format, espace estimé) — cohérent avec le garde-fou existant du revert
Journal (confirmation > 10, journal.ts:252).

### 4. Aucun état de chargement — écran blanc ~3 s sur Revue
Sur une file de 1793 items, entrer dans Revue laisse un blanc total (~3 s observés,
label QUEUE seul) : `renderQueue` construit un innerHTML monolithique
(sift-live.ts:166-192) et le passage Détail↔Lot/nav montre l'ANCIEN écran pendant
~1 s avec le nav déjà actif ailleurs (observé : nav « Écartés » actif, contenu
Sources encore affiché). Un skeleton/spinner suffit à court terme ; à moyen terme,
la liste mérite une virtualisation (1793 nœuds × 2 lignes).

---

## Should fix

### 5. Queue Revue : « lossless » répété sur 100 % des lignes
Chaque ligne porte le dot vert ET le mot `lossless` (sift-live.ts:163, 187). Quand
tout est vert, le signal est nul — et dot + mot sont redondants entre eux. N'écrire
le mot que pour l'anomalie (`fake`, `à vérifier`, `analyse…`), garder le dot seul
pour OK. Idem en Lot où `DUPLICATE` ambre fonctionne bien précisément parce qu'il
est rare.

### 6. Écartés : 7 liens boutiques sur chacune des 92 lignes
`Copier le nom · Beatport · Traxsource · Juno · Bandcamp · Amazon · Apple Music`
rendus inconditionnellement sous chaque piste (ecartes-view.ts:35-51, 80-84) →
~650 liens à l'écran, mur de bruit. Divulgation progressive : liens visibles
seulement sur la ligne survolée/sélectionnée, ou repli « Racheter → » par ligne.

### 7. Chemin brut du fichier en pleine largeur dans le header du player
La ligne mono `C:\Users\LEETJ\Documents\Soulseek Downloads\complete\(1984) Doin'…`
est plus longue et plus visible que le titre. Info secondaire : tronquer
(`…\complete\<fichier>`), tooltip pour le complet, clic = copier.

### 8. Jeton Discogs affiché en clair (Réglages)
Le token est lisible à l'écran (et donc dans toute capture/partage d'écran).
`type="password"` + bouton œil.

### 9. La maquette `app.js` a décroché de l'app réelle
- Accueil réel = gestionnaire de Sources 2 colonnes ; maquette = 4 stat-cards +
  bandeau « 7 fichiers à trier → Trier ».
- Réglages maquette = 10 rangées (formats, nommage, sensibilité, Rekordbox…) ;
  réel = 3 cartes (Discogs, Bibliothèque, Apparence).
- Journal maquette = écran totalement vide (pas même un titre).
- Données maquette incohérentes : « 7 fichiers à trier dont 1 faux » mais les 7
  pistes de la file sont toutes « conforme ».
CLAUDE.md la présente encore comme « source de vérité UI initiale » — soit la mettre
à jour, soit la rétrograder explicitement (la mémoire d'audit-fidélité disait déjà :
« la maquette modélise parfois MOINS que le vrai code »).

### 10. Parcours Accueil → Revue sans pont
L'Accueil réel affiche « 2735 nouveaux » par source mais aucune action pour aller
les trier — il faut connaître le rail. La maquette avait ce CTA (« Trier → »).
Un bouton contextuel « Trier les N nouveaux → Revue » sur la source sélectionnée
refermerait la boucle du parcours principal.

---

## Could improve

11. **Rail Détail sans destination** : le primaire affiche `Ranger → —` (cryptique).
    Le désactiver avec microcopy « Choisis une destination » serait plus clair.
12. **« Preuve (spectre) » : afficher/masquer à ~1300 px du libellé** — le lien est
    à l'extrême droite d'une ligne pleine largeur (proximité faible). Rendre toute
    la ligne cliquable (c'est déjà le pattern des accordéons ailleurs).
13. **Table de verdict = dump technique** (dBTP, runs, DC offset, pts × s). Assumé
    comme « preuves », et la ligne « Décodé … encodage conforme » humanise déjà —
    mais grouper visuellement (2-3 sous-groupes : signal / silence / conteneur)
    la rendrait scannable.
14. **Nav rail inaccessible au clavier** : les `.nv` sont des div sans tabindex ;
    le focus-ring global (styles.css:198) ne s'applique donc à rien dans le rail.
    Les raccourcis Revue (SPACE/ENTER/BKSP/HAUT-BAS, affichés dans le rail : bien)
    ne couvrent pas la navigation entre écrans.
15. **Journal vide ≠ composant partagé** : « Aucune action dans cette session. »
    en une ligne (journal.ts:292) alors qu'Écartés vide utilise `emptyStateHtml`
    (titre + note + lien retour, ecartes-view.ts:100-104). Harmoniser.
16. **Bibliothèque : badge « ? » sur chaque ligne sans légende** — sens non évident
    à l'écran (aucun tooltip constaté). À expliciter (tooltip ou légende), d'autant
    que les doublons rangés (Dave DK ×2, Subsound ×2…) sont visibles côte à côte
    sans lien vers le dédoublonnage.

---

## Ce qui marche bien (à garder)

- **« Prêt à ranger » + NOM FINAL** (`→ The Liptrick - Lip Trick.aiff`) : la
  meilleure affordance de l'app — on voit exactement ce qui va se passer avant d'agir.
- **Discipline couleur 2 teintes** (vert = ok, ambre = doute) tenue partout, y
  compris dark ; les chips rares (DUPLICATE, faux, tronqué) portent du signal
  précisément parce que le reste est neutre.
- **Spectrogramme** : rendu superbe, net, et le repli par défaut garde l'écran calme.
- **Hints clavier dans le rail** (SPACE écouter · ENTER ranger · BKSP jeter) :
  divulgation légère, bien placée.
- **Thème clair/sombre complet et cohérent** (tokens systématiques, aucune zone
  « oubliée » constatée dans l'app réelle) ; persistance du mode Lot entre les vues.
- **Garde produit « jamais ranger un faux en masse »** matérialisée dans les groupes
  du Lot (fake → écarter uniquement).
- **Écartés** : le trio raison (`faux`/`tronqué`/`à re-sourcer`) + Copier le nom
  pour Soulseek + restaurer/corbeille = un vrai workflow de re-sourcing, unique
  au produit.

## Captures

Réalisées en session (computer-use, non sauvegardées sur disque) : Revue Détail
sombre + spectre ouvert, Revue Lot sombre + clair, Accueil/Sources, Écartés,
Journal (vide), Bibliothèque, Réglages, Réglages clair. Reproduire : app dev +
naviguer le rail.
