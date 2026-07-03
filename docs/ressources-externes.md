# Ressources externes & veille technique — Sift

> Veille des libs / outils / API utiles à Sift, classée par jalon, avec **statut**
> (mûr / jeune / référence-only) et liens. Inclut deux évaluations menées le
> 2026-06-24 : **test Symphonia vs FFmpeg** et **étude chromaprint-next vs
> rusty-chromaprint**.
>
> Rappel pile : Tauri v2 (Rust), FFmpeg via `ffmpeg-sidecar` (bundlé), SQLite
> (`rusqlite`), `rustfft`, `lofty`, `rusty-chromaprint`, `ureq`. MSRV projet =
> Rust 1.77.2.

---

## M2 — Analyseur / détection de faux lossless ⭐

Feature signature. Le gros du gisement est dans l'algorithme de détection.

- **[Audio Fake Detector PRO](https://github.com/alessandrocomito/audiofakedetectorpro)**
  — open source, alternative gratuite à *Fakin' The Funk*. **Algo étudiable** et
  directement transposable : découpe en segments → inspection bitmap du
  spectrogramme par segment → **vote majoritaire** → + validation **auCDtect**
  (analyse PCM statistique) pour les lossless. _Statut : référence + code à lire
  avant d'écrire M2._
- **[auCDtect](https://thewelltemperedcomputer.com/SW/AudioTools/Detect.htm)** —
  validation statistique d'authenticité lossless (référence historique).
- **[Fakin' The Funk](https://fakinthefunk.net/en/)** /
  **[Spek / Fabl](https://www.fabl.app/tools/audio-quality-checker)** —
  concurrents/références pour calibrer le **verdict UX**. _Référence-only._
- Principe technique commun : repérer la **coupure de fréquence** (frequency
  cutoff) qui trahit un encodage lossy planqué dans un WAV/FLAC. Côté Sift, c'est
  `rustfft` (déjà en deps) sur des trames PCM.

## M3 — Décodage / waveform / analyse

- **[Symphonia](https://github.com/pdeljanov/Symphonia)** — décodage audio **pur
  Rust** (FLAC, MP3, AAC, ALAC, WAV, AIFF, OGG…). _Statut : mûr, évalué ci-dessous
  → **adopter pour le chemin d'analyse**._
- **[bpm-finder-tools](https://crates.io/crates/bpm-finder-tools)** — détection
  BPM en Rust. _Statut : à évaluer si le BPM entre dans le scope._
- _(Détection de tonalité / key : **hors scope**, décidé le 2026-06-24.)_

## M5 — Empreinte / dédoublonnage / identification

- **[rusty-chromaprint](https://crates.io/crates/rusty-chromaprint)** — **déjà en
  dépendance** (`0.2`). Pur Rust, sur crates.io. Marche pour l'algo par défaut.
- **[chromaprint-next](https://github.com/attilagyorffy/chromaprint-next)** —
  alternative pur Rust **bit-identique** à la lib C. _Voir étude ci-dessous._
- **[Chromaprint / AcoustID (réf C)](https://github.com/acoustid/chromaprint)** —
  implémentation de référence + service d'identification en ligne.

## Export Rekordbox (partie historiquement la plus pénible)

- **[rbox](https://crates.io/crates/rbox)** — Rust, **lit ET écrit** le XML
  Rekordbox + One Library + fichiers d'analyse. _Statut : candidat n°1 pour
  « pousser des playlists »._
- **[rekordcrate](https://github.com/Holzhaus/rekordcrate)** — Rust, parse les
  exports device CDJ/XDJ (PDB + ANLZ + XML). _Statut : solide mais ⚠️ « heavy
  development », API susceptible de casser._
- **[pyrekordbox](https://pypi.org/project/pyrekordbox/)** — Python ; précieux
  comme **doc vivante des formats** Rekordbox même si non utilisé. _Référence-only._

## Renommage Discogs

- **[API Discogs](https://www.discogs.com/developers/)**. À intégrer dès le design :
  - **60 req/min** (authentifié clé+secret) vs **25 req/min** (anonyme).
  - **User-agent unique obligatoire** pour obtenir le quota max.
  - Lire les headers `X-Discogs-Ratelimit`, `-Used`, `-Remaining` pour throttler
    (fenêtre glissante de 60 s).
  - Flux de matching : `/search` → `/master` (le plus canonique pour titre/année)
    → `/release` pour le détail.
  - Token utilisateur requis seulement pour les ressources privées (collection,
    inventaire) — inutile pour du simple lookup de metadata.

---

## Évaluation 1 — Symphonia vs FFmpeg (2026-06-24)

**Question** : remplacer/compléter le sidecar FFmpeg par Symphonia (pur Rust,
in-process) pour le **chemin d'analyse** (décodage → PCM → `rustfft` / peaks /
empreinte).

**Méthode** : projet jetable hors-repo (`~/Desktop/sift-symphonia-probe`,
`symphonia 0.5` features mp3/flac/wav/aiff/aac/alac, build `--release`). Décodage
intégral en `f32`, mesure du wall-time (run à chaud). Comparé à
`ffmpeg -v error -i <f> -f null -` (décode tout, jette la sortie), bundlé Sift.
Fichiers : 2 vrais morceaux + fixtures du repo.

| Fichier | Durée | Symphonia | FFmpeg (incl. spawn) |
|---|---|---|---|
| Vrai FLAC | 5:44 (344 s) | 276 ms | **163 ms** |
| Vrai MP3 | 8:29 (509 s) | 710 ms | **632 ms** |
| Fixture FLAC | 10 s | **5,3 ms** | 67 ms |
| Fixture MP3 | 10 s | **9,2 ms** | 73 ms |

**Constats**
- FFmpeg gagne ~1,2–1,7× en **débit brut** sur les longs fichiers, mais paie un
  **coût fixe ~60 ms de spawn process par fichier** (visible sur les fixtures
  courtes où Symphonia est 8–12× plus rapide).
- En valeur absolue, décoder un morceau de 5–8 min coûte 0,2–0,7 s aux deux : non
  bloquant.
- Symphonia a décodé **correctement** tous les fichiers (sample rate, canaux,
  durée, peak, somme des magnitudes plausibles).
- Symphonia sort des **`f32` directement en mémoire** → branchement direct sur
  `rustfft` (déjà en deps). La voie FFmpeg impose spawn + pipe PCM `f32le` sur
  stdout + parsing (le `-f null` du bench ne pipe même pas les données).
- Symphonia est **decode-only** : **pas d'encodage**. FFmpeg reste **obligatoire**
  pour la conversion au format CDJ (étape « ranger »).

**Recommandation : architecture hybride.**
- **Garder FFmpeg sidecar** pour la **conversion CDJ** (Symphonia ne sait pas
  encoder) — il est de toute façon déjà bundlé.
- **Adopter Symphonia pour le chemin de lecture/analyse** (décode → PCM →
  `rustfft` / peaks / alimentation empreinte) :
  - pas de coût de spawn répété sur une biblio de milliers de fichiers (scan) ;
  - `f32` direct, intégration propre avec `rustfft`, zéro pipe/parsing fragile ;
  - pur Rust, multiplateforme, pas d'IPC.
  Le déficit de débit brut (~100 ms sur un long fichier) est négligeable face au
  gain de spawn + à la simplicité d'intégration.

**À garder en tête** : Symphonia 0.6 est sorti (testé en 0.5 pour stabilité API) ;
FFmpeg reste plus robuste sur fichiers exotiques/cassés (fallback utile).

> Projet de test conservé à `~/Desktop/sift-symphonia-probe` (hors repo, jetable —
> supprimable). Code du probe : `src/main.rs`.

---

## Évaluation 2 — chromaprint-next vs rusty-chromaprint (2026-06-24)

**Contexte** : Sift dépend **déjà** de `rusty-chromaprint 0.2`. La vraie question
n'est donc pas « ajouter chromaprint-next » mais « **faut-il migrer ?** ».

**Findings (chromaprint-next)**
- Pur Rust, **bit-identique** à la lib C de référence sur **les 5 variantes**
  d'algo (vérifié côte-à-côte), **~4 % plus rapide** (269 vs 258 Melem/s @ 120 s).
- vs `rusty-chromaprint` : ce dernier marche pour l'algo par défaut **mais**
  utilise un resampler différent, **ne reproduit pas certains bugs C nécessaires à
  la compatibilité avec la base**, et a des **presets incomplets sur 3 des 5
  variantes**.
- ⚠️ **Distribution** : uniquement en **dépendance git + submodules**
  (`clone --recursive`), pas un simple crate versionné crates.io comme
  rusty-chromaprint → friction de build/CI Win+Mac.
- ⚠️ **Licence** : **MIT AND LGPL-2.1-or-later** (le resampler est un port LGPL de
  `av_resample` de FFmpeg). OK pour une app desktop, mais à noter.
- MSRV : non documentée (à vérifier vs 1.77.2 avant adoption).

**Décision pilotée par l'usage de l'empreinte**
- **Dédoublonnage strictement local** (comparer les fichiers de la biblio entre
  eux) → seule la **cohérence interne** compte, pas la compatibilité bit-à-bit
  avec la base C. → **Rester sur `rusty-chromaprint`** (déjà en place, crates.io,
  zéro friction).
- **Identification via le service AcoustID en ligne** → la base AcoustID a été
  construite avec la lib C (bugs compris). Le **bit-identique de chromaprint-next
  améliore le taux de match**. → Envisager la migration, **après un spike** qui
  valide MSRV + build git/submodules en CI Win+Mac + licence.

**Recommandation** : ne pas migrer maintenant. Verrouiller d'abord si M5 vise
l'AcoustID en ligne ou seulement le dédoublonnage local. Si online → spike
chromaprint-next ; sinon → statu quo.

---

## Évaluation 3 — workflow d'itération UI en direct (2026-07-03)

**Question** : comment itérer sur l'UI (couleur/spacing/cohérence) sans rebuild
Tauri complet à chaque changement, avec Claude capable de voir le rendu avant
d'éditer.

**Constat (root cause confirmé sur le repo)** : trois implémentations UI
parallèles coexistent, pas deux — `design_handoff_sift_refonte/Sift.dc.html`
(maquette figée, DSL propriétaire, son propre `README.md` dit explicitement
« pas du code de production à copier tel quel ») ; `frontend/app.js` (355
lignes, aucun import, data bidon en dur, ses propres fonctions
`renderHome()`/`renderRevue()` — un **mock navigateur autonome**) ; le vrai
code (`chrome.ts`, `home-sources.ts`, `report-view.ts`…). `frontend/main.ts`
ne charge le vrai câblage (`installLiveWiring()`) que si `__TAURI_INTERNALS__`
existe ; `app.js` a le garde-fou inverse par vue (`if(!('__TAURI_INTERNALS__'
in window)){...}`). **Vérifié en lançant le serveur Vite et en screenshotant** :
le navigateur affiche bien le mock `app.js` (data "Mr. Fingers" en dur), jamais
le vrai `chrome.ts`.

**Pistes écartées** : Storybook / Pattern Lab (recréent une double
implémentation via un langage de template séparé) ; Cursor Visual Editor
(optimisé React, fiabilité douteuse sur `var(--token)`) ; migration React (ne
traite pas la root cause, non chirurgical).

**Piste testée : Claude in Chrome** (`mcp__claude-in-chrome__*`, équivalent de
`claude --chrome`/`/chrome` — pas de flag CLI de ce nom dans ce harnais).
Fonctionne réellement (navigateur connecté, screenshot obtenu), mais regarde le
même onglet Vite que ci-dessus → **voit le mock, pas le vrai code**. Valide
uniquement pour `styles.css` (fichier de tokens partagé par les trois
implémentations, non gated par `inTauri`), pas pour le markup.

**Piste retenue — `tauri dev` + HMR + computer-use** : `src-tauri/tauri.conf.json`
(`devUrl: http://localhost:5173`, `beforeDevCommand: npm run dev`) fait pointer
la vraie fenêtre Tauri sur le même serveur Vite. Dans cette fenêtre,
`__TAURI_INTERNALS__` existe réellement → le mock `app.js` se tait, le vrai
code s'affiche avec les vraies données IPC, et le HMR Vite s'applique en direct
à tout fichier `frontend/*.ts`/`styles.css` **sans rebuild Rust** (seul
`src-tauri/*.rs` en nécessite un). C'est littéralement l'app elle-même,
éditable en direct — il n'y a plus besoin de maquette. Reste à valider : que
`computer-use` (fenêtre desktop native, pas un onglet Chrome) peut effectivement
voir/cliquer cette fenêtre — nécessite l'autorisation `request_access` de
l'utilisateur, pas encore testé en pratique.

**Recommandation** : `styles.css` reste itérable via Chrome DevTools
Workspaces/`preview_*`/Claude in Chrome sur le serveur Vite nu (couleur/
spacing/tokens uniquement). Tout changement de markup/structure (`chrome.ts`,
`report-view.ts`, `home-sources.ts`…) doit être vérifié dans la vraie fenêtre
`tauri dev` via `computer-use`, jamais via le navigateur seul.

**Suite testée le même jour — `computer-use` écarté, `mcp__claude_design__*`
confirmé réel.** Antoine a explicitement écarté `computer-use` comme défaut
("ça bouffe trop de tokens") — voir mémoire
`prefer-ask-user-to-test-over-computeruse`. Le défaut redevient donc : Antoine
regarde lui-même la fenêtre `tauri dev` (retour instantané, zéro coût), avec
un screenshot ponctuel via `claude-in-chrome` seulement si un point précis a
vraiment besoin d'être vu — jamais une session interactive complète.

En creusant l'alternative "demander à Claude Design de juger à ma place" :
- `mcp__claude_design__*` est un accès réel et authentifié au compte
  claude.ai/design (`list_projects` a listé les projets existants, dont
  "Refonte UI Sift", celui qui a produit `Sift.dc.html`). Rôle confirmé :
  outil d'**exploration/wireframe pour une nouvelle direction** (génère des
  options, donne un lien à ouvrir), jamais un mécanisme de sync live avec le
  code réel — le réutiliser comme "maquette toujours à jour" recréerait
  exactement le problème diagnostiqué plus haut.
- `render_preview(render:true)` (rendu headless serveur → screenshot direct)
  est **désactivé sur ce compte** ("Server-side rendering not enabled here")
  — pas de raccourci gratuit pour que Claude Design "voie" à la place de
  Claude ou d'Antoine.
- `write_files` n'accepte que du contenu inline complet (`local_path` non
  implémenté côté serveur) — pousser un fix, même d'une ligne, sur un gros
  `.dc.html` coûte de faire transiter le fichier entier. À réserver aux vrais
  bugs, pas aux micro-syncs cosmétiques.
- **Bug structurel trouvé et corrigé** : `Sift.dc.html` ouvert seul (`file://`,
  hors de l'éditeur Claude Design) affichait des `{{...}}` bruts, aucune
  erreur console. Cause : `support.js` (le runtime dc, vérifié identique sur
  l'ancienne version restaurée ET sur une version fraîchement régénérée via
  `create_support_js`) exige `window.React`/`window.ReactDOM` déjà présents
  sur la page — fournis silencieusement par l'éditeur hébergé Claude Design,
  jamais par le fichier exporté lui-même. Fix : ajouter les balises
  `<script>` React 18.3.1 UMD (version épinglée + hash SRI) avant
  `support.js` dans `<head>`. Appliqué au fichier local et à la copie cloud,
  vérifié sans erreur console et avec les vraies données interpolées.

---

## Évaluation 4 — `/design-sync` et Open Design pour le sync design↔code (2026-07-03)

**Question** : deux outils évalués pour automatiser la synchronisation entre
`Sift.dc.html` (mockup Claude Design) et `styles.css`/le code réel, en
continuation de l'Évaluation 3 ci-dessus.

**`/design-sync` (outil natif `DesignSync`, disponible dans cette install
CLI)** — écarté après lecture du schéma complet de l'outil et vérification
réelle du projet cible. L'outil synchronise une **bibliothèque de composants**
vers un projet Claude Design de type `PROJECT_TYPE_DESIGN_SYSTEM`
(marqueurs `@dsCard`, `register_assets`...) — pas un mockup applicatif
unique. Vérifié via `get_project` : le projet "Refonte UI Sift" (celui qui a
produit `Sift.dc.html`) est de type `PROJECT_TYPE_PROJECT`, pas
`DESIGN_SYSTEM`, et ce type est immuable à la création. `/design-sync` ne
s'applique donc pas à l'artefact actuel sans le reconstruire entièrement en
composants cardés.

**Open Design (`nexu-io/open-design`, GitHub, vérifié via `gh api`)** — projet
réel et actif (74 629 ⭐, créé 2026-04-28, push quotidien), écarté quand même.
Architecture : daemon Node/Express + SQLite (persistant, à faire tourner en
continu, Electron ou Docker) qui spawn le CLI d'un agent de code en
sous-processus. Import `/api/import/claude-design` : **plus permissif que
supposé** — lu le code source (`claude-design-import.ts`), c'est un parseur
ZIP maison qui cherche juste un fichier `.html` dedans, sans validation de
schéma Claude Design (`Sift.dc.html` + `support.js` zippés fonctionneraient
mécaniquement). Mais la fonctionnalité qui résoudrait vraiment le problème
(pipeline `code-migration` : `design-extract`/`token-map`, crosswalk de
tokens source→cible) est **non implémentée** — les deux atomes concernés sont
explicitement marqués `Status: Reserved id, prompt-only fragment in v1` dans
leur propre `SKILL.md`. Rejeté pour deux raisons cumulées : service
persistant à maintenir pour un outil solo desktop (contradiction avec le
principe déjà appliqué à `tauri-plugin-updater`/`tauri-specta`, reportés pour
la même raison), et la fonctionnalité de fond n'existe pas encore.

**Root cause du vrai problème (pas un outil manquant)** : l'infidélité
design→code venait de deux causes distinctes, pas d'une absence de sync
automatique — (1) absence de vérification par état (hover/sélectionné/thème)
avant de déclarer un portage fini (voir `sift-audit-fidelite-methode`), et
(2) `Sift.dc.html` encode de la vraie logique JS conditionnelle par état
(ex. `M={green,amber,neutral,muted}` dans le fichier), pas de simples valeurs
statiques — la lire correctement demande de simuler cette logique, pas de la
copier.

**Décision** : pas d'outil de sync adopté. `docs/design-system-states.md`
(catalogue d'états par composant réel, alimenté 2026-07-03) sert de source de
vérité pour le portage — extrait du vrai code une fois, réutilisé à chaque
nouveau design plutôt que re-dérivé de `Sift.dc.html` à chaque fois. `Sift.dc.html`
reste un artefact d'exploration figé, jamais resynchronisé en continu.

---

## Veille concurrente — MediaMonkey (2026-06-24)

Gestionnaire de biblio musicale ([mediamonkey.com](https://www.mediamonkey.com/)),
voisin de Sift. Ce qu'il fait et comment :

| Brique | MediaMonkey | Technique |
|---|---|---|
| Auto-tag | Metadata + artwork manquants | Empreinte acoustique → lookup **MusicBrainz** (fingerprint envoyé au serveur) |
| Doublons | Détecte/supprime | **MD5** → seulement les fichiers **octet-identiques** |
| Auto-organize | Déplace/renomme | **DSL de masks** déclaratif, déclenché à l'ajout/édition |
| Conversion | Compat appareils | À la volée |
| Stockage | Biblio 100k+ | **SQLite** (comme Sift) |

**3 enseignements pour Sift :**

1. **Dédoublonnage = différenciateur.** MediaMonkey ne fait que du **MD5**
   (octet-identique) → rate « même morceau, bitrate/encodage différent », le cas DJ.
   Le plan Sift (**Chromaprint**) détecte ces quasi-doublons → avantage produit à
   mettre en avant. Confirme le choix M5.
2. **Voler le DSL de masks** pour le renommage/rangement (Discogs). Éprouvé,
   transposable — en prendre une **version réduite** (pas le couteau suisse) :
   - Tokens : `<Artist>`, `<Album>`, `<Title>`, `<Track#:2>` (zero-pad), `<Year>`,
     `<BPM>`, regroupement alpha `<Artist@3>`.
   - Fonctions : `$If(crit,oui,non)`, `$Replace(s,a,b)`, `$RemovePrefix("The")`,
     `$Left/$Right/$Mid`, `$Upper/$Lower`.
   - Ex. : `C:\Music\<Artist>\<Album>\<Track#:2> - <Title>`.
3. **MusicBrainz vs Discogs pour M5.** MediaMonkey identifie par **fingerprint →
   MusicBrainz** (lié à AcoustID). **Discogs n'a pas de service d'empreinte**
   (matching texte) mais excelle sur pressages/électronique/vinyle. → Archi
   possible : **empreinte → MusicBrainz pour *identifier*, Discogs pour
   *enrichir/renommer***.

---

## Veille UX — design d'interface (2026-06-24)

- **[Designing user-friendly interfaces — a practical guide for putting people first](https://medium.com/design-bootcamp/designing-user-friendly-interfaces-a-practical-guide-for-putting-people-first-272a51cee37a)**
  (Medium / Design Bootcamp). _Statut : référence — checklist UX à appliquer au
  frontend Sift._ Principes retenus, mappés aux **gaps repérés sur Sift** :
  1. **Éviter les boutons icon-only** : la nav et les lignes (play / lien Discogs /
     identifier) n'ont que des icônes → ajouter **labels + `title` + `aria-label`**.
  2. **Microcopy** : nos erreurs IPC sont des chaînes techniques (`NO_TOKEN`,
     `NoLibraryRoot`…) → **humaniser** (messages, états vides, confirmations).
  3. **Accessibilité** : contraste, **navigation clavier** au-delà des raccourcis
     existants (Space/Enter/X/I en Revue).
  4. **Cohérence** (design system vivant via les `--color-*`), **simplicité**
     (1 action primaire par écran), **but clair par écran**, **états de chargement**
     (skeleton / waveform instantanée déjà en place).
  > À traiter dans la passe design du M6b Lot 2 (détail unifié) puis Lot 5 (audit
  > de conformité). Voir spec `docs/superpowers/specs/2026-06-24-m6b-library-design.md`.

---

## Titlebar custom (Windows fait, macOS/OS-detection reste à faire)

> Statut mis à jour 2026-07-03 (vérifié contre le code réel via
> `docs/handoff-verdict-card-titlebar.md`, généré par `/design-handoff`) —
> corrige la décision 2026-06-30 ci-dessous, devenue partiellement fausse :
> **2 des 3 briques sont déjà livrées**, pas "pas en chantier".
> `decorations:false` est posé (`tauri.conf.json:21`) et la barre custom
> Windows (min/max/close, drag region, tokens CSS) est fonctionnelle dans
> `frontend/chrome.ts:112-137`. Seule la brique 1 (détection OS + variante
> macOS feux tricolores) n'a pas commencé — `tauri-plugin-os` absent de
> `Cargo.toml`/`package.json` (vérifié par grep). Gaps connus à traiter avec
> cette brique : pas de tooltip sur nom de fenêtre tronqué, icône `max` ne
> bascule pas vers un glyphe "restore" quand déjà maximisé, hover du bouton
> fermer en rouge Windows en dur (`#e81123`, OK pour Windows, pas transposable
> tel quel à macOS).
>
> Décision 2026-06-30 d'origine (pour mémoire) : chantier noté sans coder,
> aucune dépendance ajoutée pour éviter le bloat d'une dep qui dort. Toujours
> valable pour la brique 1 seule — à attaquer comme un vrai chantier UI quand
> on s'y met, routage CLAUDE.md : `design-flow` (nouveau screen) ou `impeccable`.

Trois briques distinctes (et `tauri-plugin-os` n'en couvre qu'UNE) :

1. **Détecter l'OS** → `tauri-plugin-os` (officiel, suit la version majeure
   Tauri). Sert à placer les contrôles au bon endroit : feux tricolores à
   gauche sur macOS, minimize/maximize/close à droite sur Windows. C'est le
   SEUL rôle du plugin ici. _Statut : **pas commencé** — seule brique restante._
2. **Fenêtre sans décoration** → `decorations: false` dans `tauri.conf.json`
   + recréer la barre en HTML/CSS. Pas de plugin, config + DOM.
   _Statut : **fait** (`tauri.conf.json:21`, `chrome.ts`)._
3. **Actions fenêtre** → `@tauri-apps/api/window` (`getCurrentWindow().minimize()`
   / `.toggleMaximize()` / `.close()`) + attribut `data-tauri-drag-region`
   sur la zone de déplacement. Pas de plugin.
   _Statut : **fait** (`chrome.ts:128-136`)._

- **[agmmnn/tauri-controls](https://github.com/agmmnn/tauri-controls)** —
  contrôles de fenêtre d'apparence native pour Tauri 2 (boutons dessinés selon
  les prototypes de design officiels de chaque OS, PAS des contrôles natifs).
  ⚠️ Livré en React/Solid/Vue/Svelte+Tailwind — **pas de variante vanilla TS**.
  _Statut : **référence-only**._ Usage prévu : copier leur rendu CSS/SVG
  par-OS pour le pixel-perfect, réimplémenter en vanilla TS. Jamais en dépendance.
- **[agmmnn/tauri-ui](https://github.com/agmmnn/tauri-ui)** — **écarté**
  2026-06-30. Scaffolder shadcn/ui (React), sert à démarrer un projet de zéro,
  pas à enrichir l'existant ; hors scope vanilla TS ; maintenance douteuse
  (issue #21 upgrade Tauri 2 sans réponse). Rien à en tirer pour Sift.

---

## Infra / Release — décisions en attente

- **tauri-plugin-updater** (2026-06-30) : pas encore intégré. Nécessite des décisions d'infra d'abord (clé de signature, hébergement du manifeste : GitHub Releases vs CrabNebula, config `tauri.conf.json`, signature au build). Reporté à la phase release — infra avant code.
- **tauri-specta** (IPC type-safe, 2026-06-30) : évalué et reporté post-RC. Mieux sur le papier, mais conversion invasive (~45 commandes), dépendance RC dans une couche critique, perte de la doc métier des wrappers manuels actuels. Le double-miroir `ipc.ts` + `shared/contracts.ts` reste la solution tant que le risque de migration dépasse le gain.

---

## Écarté

- **[vykee.co](https://vykee.co)** — écarté le 2026-06-24. SDK SaaS d'**onboarding
  produit cloud** (tours guidés, checklists, divulgation progressive servis depuis
  un service tiers). **Incompatible avec l'ADN de Sift** : gratuit, offline-first,
  100 % local, un seul binaire — pas de dépendance réseau ni de tiers pour l'UI.
  **Garder l'idée** de **divulgation progressive** (progressive disclosure : ne
  montrer que ce qui est pertinent au moment T, déplier le reste à la demande) mais
  l'**implémenter nativement** dans le frontend (comme le repli spectrogramme /
  « N autres résultats » déjà en place), jamais via un service externe.
- **SoundTouch.js (key-lock M3)** — écarté le 2026-06-24. Le key-lock actuel utilise
  le time-stretch natif du navigateur (`preservesPitch` via l'élément `<audio>` de
  WaveSurfer v7), suffisant pour le nudge DJ ±8 %. WaveSurfer v7 n'a plus de backend
  WebAudio lecture → SoundTouch imposerait de ré-architecturer toute la lecture
  (play/pause/seek/curseur) en Web Audio pour un gain marginal à ce ratio. À
  reconsidérer seulement si on veut du stretch « pro » à gros ratios.
- **Qdrant / vector DB** (et l'annuaire `qdrant.tech/documentation/frameworks/`) —
  écarté le 2026-06-24. Les tâches moteur de Sift (détection spectrale, empreinte
  Chromaprint comparée en Hamming, metadata Discogs) ne sont pas des problèmes de
  similarité vectorielle. ANN inutile à l'échelle d'une biblio perso ; serveur
  requis → casse l'esprit offline/léger. Si un jour « trouve-moi des morceaux qui
  *sonnent* pareil » (embeddings audio), préférer `sqlite-vec` (in-process) à
  Qdrant.
- **Graphify (graphe de connaissance du codebase)** — écarté le 2026-07-01,
  après éval réelle (extraction + clustering sur tout le repo,
  `graphify-out/GRAPH_REPORT.md` : 1174 nodes, 2695 edges, 50 communautés).
  Les communautés (noms générés) recoupaient correctement la structure connue
  (Filing Rail UI, Discogs Track Matching…) mais la section « Surprising
  Connections » — censée apporter la valeur *nouvelle* — contenait des faux
  liens cross-langage (ex. `add_source()` en Rust lié à tort à `state` en TS)
  par collision de nom d'identifiant lors du linking, pas par un artefact de
  construction du graphe (`graphify diagnose multigraph --directed` : 0 edge
  collapsé). Le mode gratuit (cluster-only) ne fait que du matching structurel ;
  le mode sémantique (`--backend claude-cli`, gratuit via la souscription Claude
  Code) n'a pas pu être testé jusqu'au bout — bloqué par le classifieur auto-mode
  (action jugée trop risquée : lecture + envoi de tout le corpus vers un
  sous-process externe sans autorisation explicite assez précise). Overhead
  d'entretien (`.graphifyignore`, hooks git, rebuild à chaque changement de
  structure) pas justifié pour un repo de la taille de Sift tant que
  l'attribution sémantique n'est pas fiable.
