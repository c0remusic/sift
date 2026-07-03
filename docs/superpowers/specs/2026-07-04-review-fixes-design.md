# Design — 3 fixes issus de la revue Steve Jobs (2026-07-04)

> Source : revue de design end-to-end (Accueil→Revue→Filing→Bibliothèque/Écartés),
> verdict NOT DONE 7/10. Ce spec couvre les 3 correctifs "code" retenus (fix list
> #1, #2, #4 de la revue). Le titlebar macOS non vérifié (#3) reste hors scope —
> pas implémentable à l'aveugle, suivi manuel séparé.

## Contexte

Trois défauts distincts, indépendants, repérés lors de la revue :

1. **Freeze de la queue** (`#ql`, Revue-Détail) à 7000+ pistes — mémoire
   `sift-large-queue-black-screen.md` : liste non virtualisée, `renderQueue()`
   reconstruit l'intégralité du `innerHTML` à chaque poll/événement (~300ms de
   debounce pendant un scan actif). Coût dominant : reconstruction de milliers
   de nœuds DOM à chaque appel, pas seulement le rendu visuel — une mitigation
   CSS seule (`content-visibility`) ne suffirait pas, et son support WebKit/
   macOS est récent (Safari 18).
2. **Échec de lecture silencieux** — `report-view.ts` `mountPlayer()`,
   `ws.on("error", ...)` ne fait que logger (console + `report_smoke` côté
   Rust) ; le DJ ne voit rien s'afficher quand la lecture échoue après le
   chargement.
3. **3 `window.confirm()` restants** malgré l'incident documenté
   (`window-confirm-unreliable-tauri-computeruse`, 265 pistes rangées par
   erreur) : `filing.ts:1312` (dérogation rail-mismatch), `journal.ts:186`
   (revert de masse), `journal.ts:258` (annulation batch >10 pistes).

## Section 1 — Virtualisation de `#ql`

**Approche retenue** : fenêtre virtuelle à hauteur fixe (mesurée, pas
supposée — même discipline que la mesure du canvas spectrogramme et le
positionnement du popover de destination).

- `sift-live.ts` mesure la hauteur réelle d'une ligne `.qi` une fois
  (`getBoundingClientRect()` sur la première ligne rendue), mise en cache.
- `renderQueue()` et un listener `scroll` sur `#ql` (throttlé via
  `requestAnimationFrame`) calculent la plage d'index visible à partir de
  `#ql.scrollTop` + une marge tampon (~15 lignes au-dessus/en-dessous).
- Seule cette tranche de `currentItems` est rendue en lignes `.qi` réelles,
  encadrée par deux `<div>` espaceurs (`indexStart*rowHeight` et
  `(total-indexEnd)*rowHeight`) pour conserver un ascenseur proportionnel
  correct — pas de positionnement absolu, pas de recyclage de nœuds.
- Le re-rendu ne se déclenche que si la fenêtre visible a réellement changé
  (pas à chaque pixel de scroll).
- **Délégation de clic inchangée** : déjà déléguée sur `#pa`
  (`sift-live.ts:1406-1425`), pas par ligne — fonctionne sur n'importe quel
  sous-ensemble de lignes montées sans modification.
- **Navigation clavier (↑/↓) à corriger** : `filing.ts installFilingKeys()`
  cherche aujourd'hui `document.querySelectorAll("#ql .qi")` et clique le
  voisin trouvé (`filing.ts:1622-1631`) — casse dès qu'une ligne hors fenêtre
  n'existe plus dans le DOM. Fix : extraire ↑/↓ dans une nouvelle fonction
  exportée de `sift-live.ts` (ex. `stepQueueSelection(delta: 1 | -1)`), qui
  possède déjà `currentItems` — elle calcule le prochain item par index, fait
  défiler la liste pour l'amener dans la fenêtre rendue, puis ouvre
  directement la piste (au lieu de chercher un nœud DOM à cliquer).
  `filing.ts installFilingKeys()` garde Space/Enter/Backspace/I ;
  `sift-live.ts` appelle les deux au montage.

**Hors scope, noté pour suite** : `batch-tracklist.ts:47`
(`startBatchTracklist`) crée aussi un nœud DOM par item, sans virtualisation.
Même classe de risque en théorie, mais aucun freeze rapporté en mode Batch à
ce jour (un run de batch est typiquement un sous-ensemble borné, pas la
bibliothèque entière) — pas de fix spéculatif sans preuve du même bug.

## Section 2 — Bandeau d'erreur de lecture

- `report-view.ts mountPlayer()` : ajoute un élément `.sift-player-error`
  (caché par défaut) sous la ligne du lecteur (`.sift-player-audition`).
- Sur `ws.on("error", ...)` (actuellement `report-view.ts:660-666`, ne fait
  que logger) : afficher le message, ex. « Lecture impossible — fichier
  illisible », même famille visuelle/tonale que le bandeau `.sift-analysis-fail`
  déjà utilisé dans `filing.ts` (texte direct, pas de jargon technique).
- Effacé au prochain `ready`/`play` réussi, ou à l'ouverture d'une nouvelle
  piste (ne doit jamais survivre à un changement de piste).
- Pas de bouton "réessayer" : `loadDecoded()` a déjà fait cascader Web Audio
  → transcodage backend avant que wavesurfer ne voie le fichier — si
  wavesurfer échoue quand même, les deux chemins ont déjà échoué, rien à
  retenter automatiquement.

## Section 3 — Overlay de confirmation partagé (remplace 3 `window.confirm()`)

- Nouveau petit module `confirm-modal.ts` : `confirmAction(message: string,
  confirmLabel?: string): Promise<boolean>`, réutilise la famille de classes
  `.sift-report-overlay`/`.sift-report-overlay-card` (même famille visuelle
  que le modal de rapport et le modal de formatage USB).
- Deux vrais boutons DOM (Annuler / Confirmer) — la promesse ne se résout
  qu'sur un clic réel à l'intérieur de la webview, ce qui élimine la faille
  d'origine (un `window.confirm()` est une boîte de dialogue OS bloquante
  qu'un clic synthétique a pu traverser sans s'afficher dans ce contexte
  Tauri/WebView2 — un bouton DOM classique n'a pas cette propriété).
- Pas de cycle armé/tapé façon USB (`usb-format-modal.ts`) — ce niveau de
  friction supplémentaire est volontairement réservé à une action
  irréversible de disque ; ces 3 sites restent au même niveau de friction
  qu'aujourd'hui (un clic de confirmation), juste rendu de façon fiable.
- Sites remplacés, même message qu'aujourd'hui :
  - `filing.ts:1312` — dérogation rail-mismatch (ranger un fichier déclaré
    lossless mais réellement compressé).
  - `journal.ts:186` — revert de masse (« {label} les {totalTracks} morceaux
    affichés ? »).
  - `journal.ts:258` — annulation d'un batch de plus de 10 morceaux.

## Tests / vérification

- Virtualisation : test manuel avec une bibliothèque de test à forte volumétrie
  (fixture ou dataset simulé) — vérifier que le scroll reste fluide et que
  ↑/↓ navigue correctement jusqu'aux extrémités de la liste. `cargo test`/`tsc`
  n'exercent pas ce chemin (DOM pur) — vérification manuelle dans `tauri dev`
  documentée comme telle, pas simulée en CI.
- Bandeau erreur lecture : difficile à déclencher à la demande (nécessite un
  fichier qui échoue après le fallback transcodage) — vérification par
  lecture de code + smoke test si un fichier de repro existe déjà dans les
  fixtures.
- Overlay confirm : test manuel des 3 sites (annuler ferme sans action,
  confirmer déclenche l'action existante), `npx tsc --noEmit` clean.

## Suivi hors scope

- Titlebar macOS non vérifié visuellement (fix #3 de la revue) — nécessite un
  vrai Mac, pas traité ici.
- `batch-tracklist.ts` non virtualisé — même pattern à risque que #ql, aucun
  incident rapporté à ce jour, à surveiller si un run de batch très large
  finit par geler l'UI.
