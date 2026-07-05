# Rekordbox — page d'intégration dédiée

> Suite de l'audit UI 2026-07-05 (annotation Alt+Clic #3 : "actuellement 'rekordbox' et 'clef
> usb' ont des fonctions d'export, ce n'est pas le but"). Périmètre de ce brainstorm : Rekordbox
> uniquement. Clé USB est un brainstorm séparé, décidé explicitement — correction après vérif
> pendant l'écriture du plan : le formatage USB a déjà une UI réelle (carte "Formater une clé
> USB", `sift-live.ts:1314+`, id `sift-reglages-usb`), mais dans **Réglages**, jamais reliée à
> l'item de nav "Clé USB" (qui reste un simple toast). Le futur brainstorm USB portera donc sur
> "faut-il migrer/dupliquer cette carte vers une page dédiée", pas sur "construire une UI de
> zéro".

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
- **Nav = markup statique** : les items de nav (labels, `data-view`, groupe) sont dans
  `index.html` (pas `app.js`) — `<div class="nv-grp" data-grp="export">Export</div>` et
  `<div class="nv nv-export" data-view="rkb" title="Rekordbox">...</div>`. `#nav` est un
  descendant de `#pa`, donc les clics `[data-view]` traversent bien le délégué capture-phase de
  `sift-live.ts:1688` avant d'atteindre le routeur bubble-phase d'`app.js` — retirer
  l'interception pour "rkb" suffit, **aucune nouvelle plomberie de routing à écrire** (le clic
  sur un `[data-view]` set déjà `view` + appelle `render()`, généricement, pour tout écran).
- **`.nv-export` marque visuellement "action secondaire"** (`styles.css:121-123` :
  `opacity:.55` + puce `.nv-export-dot` au lieu d'une icône, plutôt qu'un `.nv` normal comme
  Bibliothèque/Journal). Une page réelle sous cette classe se lirait comme une action
  mineure/désactivée — contredit l'objectif même de ce brainstorm.
- **`empty-state.ts` ne supporte qu'un seul CTA fixe** ("Aller à Revue →", `backToRevue`) — pas
  de mécanisme pour un bouton d'action arbitraire ("Lier un fichier XML"). Le réutiliser tel
  quel pour l'état non-lié, comme envisagé initialement, ne marche pas sans extension.

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
  garde son comportement actuel (toast) tant que son propre brainstorm n'a pas eu lieu. Le
  routing lui-même (clic `[data-view]` → `view` + `render()`) existe déjà génériquement dans
  `app.js` ; retirer l'interception suffit à l'activer pour "rkb".
- `index.html:20-21` : le label du groupe passe de "Export" à "Intégrations" (texte seulement —
  l'attribut `data-grp="export"` n'est lu nulle part, inchangé). L'item Rekordbox perd la classe
  `.nv-export` (opacity .55 + puce `nv-export-dot`, réservée aux actions secondaires) — il
  devient un `.nv` normal avec une icône (ex. `ti-disc`), même traitement que Bibliothèque/
  Journal. "Clé USB" **garde** `.nv-export`/la puce — reste une action, pas une page, jusqu'à
  son propre brainstorm.
- `app.js`'s `renderRkb()` reçoit le même patron que les autres écrans réels : garde
  `if(!('__TAURI_INTERNALS__' in window)){ /* contenu mock existant, inchangé — démo web */ }`
  puis `if(window.__siftRkb)window.__siftRkb();`. Le contenu mock actuel (chips XML/master.db,
  bandeau "Ferme Rekordbox avant de synchroniser") n'est pas retouché — il ne sert que la démo
  web publique (Vercel), jamais visible dans l'app desktop réelle.
- Nouvelle fonction `renderRekordboxLive()` dans `sift-live.ts`, exposée via
  `window.__siftRkb = renderRekordboxLive` dans `installLiveWiring()` (même schéma que
  `window.__siftBiblio`/`window.__siftJournal`).
- Le docstring de `runNavExport` (`sift-live.ts:599-603`) devient inexact sur deux points une
  fois "rkb" retiré de l'interception — à corriger dans le même geste : "Doesn't switch screens"
  ne vaut plus que pour "cle", et "USB has no backend" est déjà faux aujourd'hui (`ipc_usb.rs`/
  `usb_format/` existent, seulement sans UI — trouvé pendant ce brainstorm, sans rapport avec le
  changement lui-même mais dans la même fonction).

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

### États de la carte de statut (tous déjà représentés par `RekordboxLinkStatus`)

`drift_detected` n'est **pas exclusif** des 3 autres états ci-dessous (c'est un flag séparé,
`linked`/`error` en sont d'autres) — la bannière drift (3) s'affiche **au-dessus de n'importe
quel état lié** (sain ou en erreur) quand le flag est vrai, pas seulement en alternative à
l'état sain. Ne pas implémenter comme un `if/else if` à 4 branches mutuellement exclusives.

1. **Non lié** (`linked=false`) → composant `empty-state.ts`, **étendu** : `EmptyStateOpts` gagne
   un champ optionnel `actionHtml?: string` (markup de bouton fourni par l'appelant, rendu après
   le lien "Aller à Revue →" quand `backToRevue` est fourni — les deux champs sont indépendants).
   Rekordbox omet `backToRevue` (pas pertinent ici) et passe `actionHtml` avec le bouton
   `data-bib="rkblink"` existant ("Lier un fichier XML Rekordbox") — déjà géré par le délégué
   global `#pa`, `wireEmptyState()` n'a besoin d'aucune modification. Titre "Aucun XML Rekordbox
   lié", note reprenant le bloc explicatif.
2. **Lié, sain** (`linked=true, error=null, drift_detected=false`) → chemin (`s.path`),
   compteurs (`N playlists · N pistes`), deux boutons : "Réexporter maintenant" **appelle la
   même fonction `runNavExport("rekordbox")` inchangée** (pas l'IPC brut `exportRekordboxXml()`
   directement) — elle gère déjà `exportRunning`/`setTask`/toast/erreurs, `runNavExport` continue
   de servir aussi "cle" (toast usb) ; et "Changer de XML lié" (`data-bib="rkblink"` — déjà géré
   par le délégué global `#pa`, aucun re-branchement requis pour cette nouvelle page).
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
