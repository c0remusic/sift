# Rekordbox — page d'intégration dédiée

> Suite de l'audit UI 2026-07-05 (annotation Alt+Clic #3 : "actuellement 'rekordbox' et 'clef
> usb' ont des fonctions d'export, ce n'est pas le but"). Périmètre de ce brainstorm : Rekordbox
> uniquement. Clé USB est un brainstorm séparé, décidé explicitement (backend déjà construit —
> `ipc_usb.rs`/`usb_format/` — mais zéro UI ; traité plus tard).

## Constat (état réel vérifié, pas supposé)

- **Nav "Export"** : "Rekordbox" et "Clé USB" sont aujourd'hui des **actions en un clic**, pas
  des écrans. `sift-live.ts:1684-1699` intercepte le clic en phase de capture et appelle
  `runNavExport()` directement — `app.js`'s `renderRkb()`/`renderCle()` (les vrais rendus mock)
  ne s'affichent **jamais** en Tauri.
- **Statut Rekordbox déjà réel** : `rekordbox_status()`/`export_rekordbox_xml()`
  (`ipc_library.rs`) existent et alimentent une carte (`rekordboxCardHtml()`,
  `sift-live.ts:1488`) — mais elle vit **en tête de l'écran Bibliothèque**
  (`sift-live.ts:1588`), pas dans la nav Export.
- **`drift_detected` invisible** : `RekordboxLinkStatus.drift_detected` (vrai signal — un
  repair de chemin lors d'un rangement a échoué à corriger le XML lié) existe côté backend
  depuis FIX-7 mais n'est **affiché nulle part** dans le frontend, seulement loggué serveur.
- **Pas d'historique d'export** : aucune date de dernier export n'est persistée. Décision de ce
  brainstorm : ne pas en ajouter (rester scopé à ce que `rekordbox_status()` sait déjà).
- **Patron de rendu existant** : les écrans réels (Bibliothèque, Journal, Accueil) suivent tous
  le même patron dans `app.js` — un rendu mock avec garde `if(!('__TAURI_INTERNALS__' in
  window)){...}` suivi d'un appel `if(window.__siftX)window.__siftX();` vers le vrai rendu
  (`sift-live.ts`). `renderRkb()` actuel n'a **ni garde ni hook** — c'est le seul écran mock
  jamais branché.

## Décisions actées (brainstorm)

1. **Nature du problème** : "export" décrit une action ponctuelle ; le vrai besoin est un écran
   de statut/gestion durable (lien, compteurs, avertissements), pas un bouton-toast.
2. **Périmètre de ce brainstorm** : Rekordbox seulement. Clé USB reste tel quel (nav → toast)
   pour l'instant.
3. **Scope fonctionnel** : strictement ce qui existe aujourd'hui (statut de lien XML, export,
   drift). Pas de préview du futur M8 (sync native `master.db`) — ce travail n'est pas encore
   porté en Rust, rien à accrocher visuellement à un état qui n'existe pas.
4. **Carte de statut** : déplacée depuis Bibliothèque vers la nouvelle page (pas dupliquée).
   Bibliothèque redevient plus légère (stats + liste, sans le bloc Rekordbox).
5. **Historique** : non ajouté. La page n'affiche que ce que `rekordbox_status()` sait déjà.
6. **Label nav** : le groupe "Export" est renommé **"Intégrations"**.
7. **Bloc explicatif** : une ou deux lignes sous le titre expliquant le round-trip manuel (Sift
   range → export fusionne le XML → réimport côté Rekordbox) — réduit la confusion sans
   construire un onboarding complet.

## Design de la page

### Routing

- Nav : "Rekordbox" dans le groupe "Intégrations" **navigue** vers `data-view="rkb"` au lieu de
  déclencher l'export directement. Le bloc d'interception capture-phase dans
  `installLiveWiring()` (`sift-live.ts:1688-1699`) est retiré **pour "rkb" seulement** — "cle"
  garde son comportement actuel (toast) tant que son propre brainstorm n'a pas eu lieu.
- `app.js`'s `renderRkb()` reçoit le même patron que les autres écrans réels : garde
  `if(!('__TAURI_INTERNALS__' in window)){ /* contenu mock existant, inchangé — démo web */ }`
  puis `if(window.__siftRkb)window.__siftRkb();`. Le contenu mock actuel (chips XML/master.db,
  bandeau "Ferme Rekordbox avant de synchroniser") n'est pas retouché — il ne sert que la démo
  web publique (Vercel), jamais visible dans l'app desktop réelle.
- Nouvelle fonction `renderRekordboxLive()` dans `sift-live.ts`, exposée via
  `window.__siftRkb = renderRekordboxLive` dans `installLiveWiring()` (même schéma que
  `window.__siftBiblio`/`window.__siftJournal`).

### Layout (un seul écran, `block()` : padding 14/18, scroll vertical — cohérent avec
Bibliothèque/Réglages)

```
┌─────────────────────────────────────────────┐
│ Rekordbox                                    │  ← titre, même style que .jrnl-hd>span
│ Sift range tes morceaux → l'export fusionne  │  ← bloc explicatif, 1-2 lignes,
│ les nouveaux dans le XML lié → réimporte-le   │    color:text-tertiary, sous le titre
│ dans Rekordbox pour les voir apparaître.      │
│                                               │
│ ┌───────────────────────────────────────────┐│
│ │ [bannière drift — visible SEULEMENT si     ││  ← nouveau, background-warning,
│ │  drift_detected]                           ││    pas de side-stripe
│ └───────────────────────────────────────────┘│
│                                               │
│ ┌───────────────────────────────────────────┐│
│ │ Statut :                                   ││  ← carte agrandie (ex-rekordboxCardHtml,
│ │  • non lié → état vide (empty-state.ts)    ││    déplacée depuis Bibliothèque)
│ │  • lié → chemin + N pistes · N playlists   ││
│ │  • erreur → message illisible/corrompu     ││
│ │                                             ││
│ │ [Changer de XML lié]  [Réexporter maintenant]││
│ └───────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### États de la carte de statut (4, tous déjà représentés par `RekordboxLinkStatus`)

1. **Non lié** (`linked=false`) → composant `empty-state.ts` partagé (cohérence avec les autres
   écrans) : titre "Aucun XML Rekordbox lié", note reprenant le bloc explicatif, CTA "Lier un
   fichier XML Rekordbox" (réutilise l'action `data-bib="rkblink"` existante).
2. **Lié, sain** (`linked=true, error=null, drift_detected=false`) → chemin (`s.path`),
   compteurs (`N playlists · N pistes`), deux boutons : "Réexporter maintenant" (appelle
   `exportRekordboxXml()`, ex-`runNavExport("rekordbox")`, avec le même `setTask`/toast et le
   même garde `exportRunning` — un seul export à la fois, inchangé) et "Changer de XML lié"
   (`data-bib="rkblink"` — déjà géré par le délégué global `#pa`, aucun re-branchement requis
   pour cette nouvelle page).
3. **Lié, drift détecté** (`drift_detected=true`) → même carte que l'état sain, **plus** une
   bannière au-dessus : fond `--color-background-warning`, texte `--color-text-warning`, icône
   `ti-alert-triangle` — "Une correction de chemin a échoué lors d'un rangement récent — vérifie
   les pistes déplacées dans Rekordbox." Pas de side-stripe (ban CLAUDE.md). Le repair suivant
   réussi efface le flag (comportement backend inchangé).
4. **Lié, illisible/corrompu** (`s.error`) → message d'erreur existant, inchangé, plus le bouton
   "Changer de XML lié" (pas de "Réexporter" tant que le fichier n'est pas relié à un fichier
   valide — le backend refuse déjà l'export dans ce cas).

### Bibliothèque

`rekordboxCardHtml()` et son insertion (`sift-live.ts:1588`) sont retirés de
`renderBiblioLive()`. L'appel à `rekordboxStatus()` dans le `Promise.all` de
`renderBiblioLive()` est retiré (plus consommé par cet écran) — la note d'état vide de
Bibliothèque ("prêtes à exporter vers Rekordbox ou une clé USB") reste inchangée, elle ne
dépend pas de cet appel.

## Hors scope (explicitement écarté par ce brainstorm)

- Toute préview visuelle du M8 (sync native `master.db`) — non prouvé en Rust, rien à montrer.
- Historique d'export horodaté — pas de nouvel état persisté.
- Clé USB — brainstorm séparé, à faire plus tard.
- Renommage/retouche du comportement "Clé USB" actuel (reste un item de nav → toast).
