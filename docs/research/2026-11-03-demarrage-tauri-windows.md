# Démarrage de Tauri v2 sous Windows : lancement animé et fenêtre montrée une fois peinte

Note de recherche du ticket #89 (carte #87), 2026-11-03.
Branche jetable `research/demarrage-tauri-windows`, jamais fusionnée.

Le dépôt est lu au commit `90bf331` (`origin/main`). Les versions viennent de
`src-tauri/Cargo.lock` : `tauri` 2.11.5, `tauri-runtime-wry` 2.11.4, `wry` 0.55.1,
`webview2-com` 0.38.2, `tauri-utils` 2.9.3, `tauri-plugin-window-state` 2.4.1,
`notify-debouncer-full` 0.7.0. Le code de ces crates a été lu dans
`~/.cargo/registry/src/index.crates.io-*/<crate>-<version>/`. Leurs chemins sont cités
ci-dessous sous la forme `<crate>/<fichier>:<ligne>`.

Rien de ce qui suit n'a été mesuré. Chaque coût sans source porte la mention
**non établi**. La note ne recommande rien.

---

## 1. Ce que font Tauri et wry au lancement d'une fenêtre (code, versions du dépôt)

### 1.1 Ordre : fenêtres de la config d'abord, `setup` de l'app ensuite, tout sur le fil principal

- `tauri/src/app.rs:2521-2535` : la fonction interne `setup` construit **d'abord** chaque fenêtre
  de `app.windows` de la config (`WebviewWindowBuilder::from_config(...).build()`, l. 2524-2526).
  Elle appelle **ensuite** la closure `.setup(...)` de l'application (l. 2530-2532). Elle est
  appelée sur `RuntimeRunEvent::Ready` (`app.rs:1423-1424`), donc depuis la boucle
  d'événements, sur le fil principal.
- Le guide « splashscreen » de Tauri v2 dit l'inverse en commentaire de code : « Runs before
  the main loop, so no windows are yet created » (source MDX du guide, `tauri-docs`, branche
  `v2`, `src/content/docs/learn/splashscreen.mdx:190`). À la version du dépôt, le code de
  `app.rs:2524-2531` contredit cette phrase. La fenêtre `main` existe déjà quand la closure
  `setup` de Sift s'exécute.
- `tauri-runtime-wry/src/lib.rs:301-335` : `create_window` passe par `send_user_message`.
  Appelé depuis le fil principal, ce message est traité **en ligne** (`lib.rs:235-248`), donc
  la création est synchrone.

### 1.2 La fenêtre est créée visible, puis WebView2 est créé de façon bloquante

- `visible` vaut `true` par défaut (`tauri-utils/src/config.rs:2029-2031`,
  `default = "default_true"`). Il est transmis tel quel à tao (`tauri-runtime-wry/src/lib.rs:939`).
- La fenêtre tao est construite (`tauri-runtime-wry/src/lib.rs:4621-4625`) **avant** la
  webview (`create_webview`, l. 4682-4695).
- Côté wry (`wry/src/webview2/mod.rs:109-168`), la création enchaîne deux étapes :
  - l'environnement : `CreateCoreWebView2EnvironmentWithOptions` (l. 283-365) ;
  - le contrôleur : `CreateCoreWebView2ControllerWithOptions` (l. 367-413).

  Chacune attend son résultat par `webview2_com::wait_with_pump`
  (`webview2-com/src/lib.rs:60-81`). Cette fonction boucle sur `GetMessageA` et
  `DispatchMessageA` jusqu'à la réponse : le fil principal attend, en pompant les messages.
- La navigation (`webview.Navigate`, `wry/src/webview2/mod.rs:531`) est lancée à la fin de
  la création, puis `controller.SetIsVisible(attributes.visible)` (l. 544). La page charge
  ensuite de façon asynchrone.
- Aucun environnement n'est partagé par défaut. `tauri-runtime-wry` ne passe un
  `environment` que s'il est fourni (`lib.rs:5059-5060`, alimenté par `features.opener`
  l. 4924). Sinon wry en crée un par webview (`wry/src/webview2/mod.rs:125-130`).
- Le dossier de données de WebView2 est forcé sous Windows à
  `LocalData/<identifier>` (`tauri/src/manager/webview.rs:534-551`), soit
  `%LOCALAPPDATA%\com.sift.app` pour Sift.

### 1.3 `transparent: true` sous Windows : ce que le code peint

- Le contrôleur WebView2 reçoit un fond `(0,0,0,0)` quand la webview est transparente
  (`wry/src/webview2/mod.rs:127-131` et 452-454). Tant que la page n'a rien peint, c'est la
  couche de la fenêtre qui se voit.
- Pour une fenêtre transparente, `tauri-runtime-wry` crée une surface `softbuffer` et la
  remplit (`lib.rs:4700-4713`, puis à chaque `RedrawRequested`, l. 4189-4202). La couleur est
  `backgroundColor`, sinon `0`, c'est-à-dire noir
  (`tauri-runtime-wry/src/window/windows.rs:53-66`).
- La doc de `backgroundColor` (`tauri-utils/src/config.rs:2175-2183`) dit que, sous Windows,
  l'alpha est ignoré pour la couche fenêtre, et ignoré pour la couche webview dès qu'il n'est
  pas nul.
- Sift appelle `DwmExtendFrameIntoClientArea` (marges -1) et `DWMWA_WINDOW_CORNER_PREFERENCE`
  à la **fin** de sa closure `setup` (`src-tauri/src/lib.rs:354-358`). D'après 1.1, c'est
  après la création et l'affichage de la fenêtre.
- **Non établi** : ce que l'œil voit entre la création de la fenêtre et l'appel DWM (cadre
  noir, verre, rien ?). Seule une capture sur un build release le dira.

### 1.4 Le plugin `window-state` montre la fenêtre de lui-même

- Sift l'enregistre avec `tauri_plugin_window_state::Builder::default()`
  (`src-tauri/src/lib.rs:228`). Les drapeaux par défaut valent `StateFlags::all()`
  (`tauri-plugin-window-state/src/lib.rs:62-67`), `VISIBLE` compris (l. 56).
- À chaque fenêtre prête (`on_window_ready`, l. 407-429), il appelle `restore_state`.
  Celui-ci finit par `self.show()` et `self.set_focus()` quand `VISIBLE` est dans les drapeaux
  et que l'état sauvé était visible, ou qu'aucun état n'existe encore (`should_show = true`
  par défaut) (l. 179, 227, 262-265).
- Conséquence lue dans le code : déclarer `"visible": false` sur `main` ne suffit pas tant que
  ce plugin restaure `VISIBLE`. Le plugin offre `with_state_flags(...)` (l. 340),
  `skip_initial_state(label)` (l. 369) et `with_denylist(...)` (l. 352-353). Sa doc
  donne l'exemple des fenêtres de lancement pour la liste d'exclusion. Aucun essai n'a été
  fait.

### 1.5 Permissions côté frontend

- `src-tauri/capabilities/default.json` accorde `core:default` et quelques permissions
  `core:window:*` (`minimize`, `toggle-maximize`, `close`, `start-dragging`, `set-shadow`),
  mais **pas** `core:window:allow-show`.
- Le jeu `core:window:default` de tauri 2.11.5 (`tauri/permissions/window/autogenerated/reference.md:1-33`)
  ne contient que des lectures (`allow-is-visible`, etc.). Un `getCurrentWindow().show()`
  appelé du JS serait donc refusé sans ajout de permission. Un `#[tauri::command]` Rust qui
  appelle `show()` n'a pas besoin de cette permission.

---

## 2. WebView2 : coût de démarrage et ce qui l'abaisse (docs Microsoft)

Source : *Performance best practices for WebView2 apps*,
https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance (ms.date
2026-01-12), et *Process model for WebView2 apps*,
https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model.

- **Coût du démarrage à froid** (§ « Cold start ») : créer un contrôle WebView2 et naviguer pour
  la première fois est « a common performance bottleneck ». À froid, WebView2 doit lancer ses
  processus et ses caches disque. **Aucun chiffre** n'est publié, le délai varie selon le
  matériel et le contenu. Coût pour Sift : **non établi**, à mesurer.
- **Écran de lancement** (§ « Don't use WebView2 for initial UI ») : Microsoft conseille de
  dessiner les écrans de lancement en XAML ou en Win32 léger plutôt qu'en WebView2,
  « due to startup costs and resource contention ».
- **Dossier de données** (§ « Optimize the User Data Folder (UDF) location ») : le garder dans
  le dossier local par défaut, sur un disque physique rapide. C'est déjà le cas chez Tauri
  (1.2).
- **Runtime Evergreen** (§ « Use the Evergreen Runtime ») : si Edge tourne déjà dans la même
  version, les binaires de WebView2 sont en mémoire, ce qui accélère le lancement.
- **Instances redondantes** (§ « Avoid redundant WebView2 instances ») : réutiliser une
  WebView2 plutôt qu'en créer d'autres. Chaque contrôle a son jeu de processus
  (§ « Memory usage and process management »).
- **Processus partagés** (*Process model* § « WebView2 Runtime processes and the user data
  folder » et § « Multiple environment objects ») :
  - le premier WebView2 d'un dossier de données démarre le processus navigateur ;
  - les environnements configurés de la même façon sur le même dossier partagent ce
    processus ;
  - un second environnement sur le même dossier mais avec des options différentes (exemple
    donné : `Language`) **échoue** à créer des WebView2.

  Pour une seconde fenêtre Tauri (lancement), c'est une contrainte d'égalité des options,
  dont `additionalBrowserArgs`.
- **Charge initiale** (§ « Reduce initial payloads ») : préférer du HTML statique au premier
  affichage, qui « loads, parses, and renders faster » que le JavaScript, et différer les
  composants lourds.
- **Priorité des fils** (§ « Manage process priority ») : avec une forte charge native, régler
  la priorité des fils pour ne pas affamer ceux de WebView2.

---

## 3. Ce que fait le démarrage de Sift avant le premier affichage (code, `90bf331`)

### 3.1 Backend, `src-tauri/src/lib.rs`

Ordre d'exécution, d'après 1.1 :

0. Avant `setup`, Tauri crée la fenêtre `main` (visible par défaut, aucune clé `visible` dans
   `src-tauri/tauri.conf.json:15-27`), son environnement et son contrôleur WebView2, et lance
   la navigation. Le plugin `window-state` la montre et lui donne le focus (1.4).
1. Plugins enregistrés à la construction : `single-instance`, `dialog`, `window-state`, `os`,
   `process` (`lib.rs:221-230`).
2. Dans `setup`, **sur le fil principal et de façon synchrone** :
   - plugin de log en debug seulement (`lib.rs:232-238`), puis plugin `updater` (`lib.rs:253-259`) ;
   - création du dossier de données, puis `db::open` (`lib.rs:265-273`). `db::open` pose WAL
     et `busy_timeout`, puis exécute `run_migrations` (`src-tauri/src/db.rs:631-640`) ;
   - **re-verdict** : `reverdict::run_and_log` (`lib.rs:285-287`). Son commentaire donne un
     pire cas **mesuré** de 420 à 434 ms pour 3 386 lignes à re-juger, en `--release`, le
     2026-09-01, lors d'un changement de version du verdict (`lib.rs:277-279`). Quand tout est
     à jour, la passe ne lit aucune ligne, selon le même commentaire ;
   - `worker::count_filed_needing_analysis` (`lib.rs:290-296`) ;
   - écriture de l'identifiant de session, `queue::mark_session_start` (`lib.rs:297-312`) ;
   - `manage` de la connexion, création du cache de pochettes et du scope `asset:`
     (`lib.rs:313-334`) ;
   - **`watcher::start_all`** (`lib.rs:335`), en ligne. Pour chaque source surveillée, il crée
     un debouncer et appelle `debouncer.watch(path, Recursive)`
     (`src-tauri/src/watcher.rs:34-67`, 79-94). Dans `notify-debouncer-full` 0.7.0, `watch`
     appelle `add_root` puis `cache.add_path` (`lib.rs:577-607`). Sous Windows, le cache est un
     `FileIdMap` (`cache.rs:63-65`), dont `add_path` parcourt **tout l'arbre** avec `WalkDir`
     et lit l'identifiant de chaque entrée (`file_id_map.rs:39-54`). Coût sur la bibliothèque
     d'Antoine : **non établi** ;
   - lancements en fils séparés, qui ne bloquent pas `setup` : scan de rattrapage
     (`lib.rs:338`, `ipc.rs:819-824`, `std::thread::spawn` sur une connexion à part), purge du
     cache de lecture (`lib.rs:341-350`), purge du journal différée de 10 s (`lib.rs:155`,
     167-188) ;
   - `worker::init` (création du pool, `worker.rs:359`) et `worker::refill`. `refill` exécute
     `select_needing_analysis` sous le verrou de la base, en ligne (`worker.rs:390-407`) ;
   - à la fin, DWM : extension du cadre et coins arrondis (`lib.rs:354-358`).
3. Tant que la closure `setup` n'a pas rendu la main, la boucle d'événements ne traite rien
   d'autre (1.1). En particulier aucune commande IPC du frontend n'est servie.
   **Non établi** : si la fenêtre déjà visible répond ou peint pendant ce temps (le contenu
   WebView2 est rendu par d'autres processus, 2.).

### 3.2 Frontend, `index.html` et `frontend/main.ts`

- `index.html:7` charge `frontend/styles.css` dans `<head>`. Le corps contient en HTML
  statique la coquille du rail (`index.html:18-77`), et `index.html:78` charge
  `frontend/main.ts` en module.
- `main.ts:23-42` importe sept fichiers `@fontsource` et la feuille d'icônes Tabler.
  Le poids du chunk principal et le blocage du rendu par ces feuilles dans le build :
  **non établis** (le commentaire `main.ts:113-114` cite un index de 294 ko, mesure
  antérieure).
- `main.ts:67` : sous Tauri, `boot()` s'exécute. Il fait `await initLang()` (`main.ts:82`), qui
  enchaîne **deux allers-retours IPC** avant tout câblage : `getSetting` puis `setUiLang`
  (`frontend/lang-boot.ts:35-51`). Viennent ensuite `installLiveWiring()`,
  `installRouter()` et `installAsideResize()` (`main.ts:83-86`). `installLiveWiring` pose la
  barre de titre (`injectTitlebar`), le thème (`initTheme`), les sources du rail, etc.
  (`frontend/sift-live.ts:206-236`).
- Hors dev, `installUpdateBanner()` (`main.ts:95`). Puis un test IPC en tâche de fond :
  `appInfo`, `dbHealth`, `ffmpegVersion`, `report_smoke` (`main.ts:96-108`).
- Aucun signal « première peinture faite » n'est envoyé au backend aujourd'hui.

---

## 4. Les trois mécanismes : ce qu'ils demandent, ce qu'ils coûtent, leurs contraintes

Les coûts en millisecondes sont tous **non établis** : aucune mesure n'existe sur cette
machine. Seules les étapes que chaque mécanisme ajoute ou retire sont listées.

### A. Fenêtre `main` en `visible: false`, montrée sur signal du frontend

- **Ce qu'il faut** :
  - `"visible": false` sur la fenêtre (`tauri-utils/src/config.rs:2029-2031`) ;
  - empêcher `window-state` de la montrer d'office (1.4) ;
  - un signal : soit une commande Rust qui appelle `show()`, soit la permission
    `core:window:allow-show` pour l'appeler du JS (1.5).
- **Ce que ça ne règle pas seul** : rien n'est visible avant ce signal. Le délai jusqu'à
  l'affichage inclut la création de WebView2 à froid (2.), la closure `setup` de Sift (3.1)
  et le `boot()` du frontend (3.2). La contrainte « lancement animé visible en < 300 ms »
  n'est tenue par A que si ce cumul est inférieur à 300 ms. **Non établi.**
- **Avec `decorations: false` / `transparent: true`** : aucune contrainte propre relevée dans
  le code. L'appel DWM de `lib.rs:354-358` se ferait sur une fenêtre encore cachée. Effet
  visuel au `show()` : **non établi**.

### B. Fenêtre de lancement séparée (guide « splashscreen » de Tauri v2)

- **Le guide** (https://v2.tauri.app/learn/splashscreen/, source
  `tauri-docs/src/content/docs/learn/splashscreen.mdx`) :
  - `main` est déclarée `"visible": false` (l. 62-71) ;
  - une fenêtre `splashscreen` visible charge `/splashscreen` ;
  - une commande `set_complete` attend deux drapeaux, frontend et backend, puis fait
    `splash_window.close()` et `main_window.show()` (l. 208-229) ;
  - le travail lourd du backend est lancé en tâche (`spawn`) depuis `setup`, pas attendu
    (l. 189-194) ;
  - le guide ajoute qu'un écran de lancement tend à signaler une app qui ne charge pas assez
    vite, et qu'une petite indication dans la fenêtre principale est souvent préférable
    (§ « Should you have a splashscreen? », l. 262-272).
- **Coût, d'après le code et les docs** :
  - la fenêtre de lancement est une **seconde WebView2**. `tauri-runtime-wry` ne partage pas
    l'objet environnement (1.2), mais le même dossier de données et les mêmes options
    partagent le processus navigateur (2., *Process model*) ;
  - les options doivent être **identiques** entre les deux fenêtres, sinon la seconde
    échoue (2.) ;
  - Microsoft déconseille WebView2 pour un écran de lancement (2.) ;
  - les deux fenêtres sont construites l'une après l'autre sur le fil principal, avant la
    closure `setup` (1.1). L'écart entre la première peinture du lancement et celle de
    `main` : **non établi**.
- **Contraintes avec `decorations: false` / `transparent: true`** : ces clés valent par
  fenêtre (`tauri-utils/src/config.rs:2020-2034`). La fenêtre de lancement peut avoir les
  siennes. Une fenêtre transparente sous Windows reçoit le remplissage `softbuffer` décrit
  en 1.3. `window-state` doit exclure la fenêtre de lancement (`with_denylist`, 1.4).
- **Variante non-WebView (Win32 natif)** : c'est la voie que recommande Microsoft (2.).
  Le runtime sait créer une fenêtre sans webview (branche `if let Some(webview)` facultative,
  `tauri-runtime-wry/src/lib.rs:4682`). Mais le seul contenu que Tauri y peint est un aplat
  de couleur `softbuffer` (1.3). **Non établi** : une API Tauri documentée pour y dessiner
  une animation. Il faudrait du code Win32 ou GDI propre, hors de ce que Tauri fournit.

### C. Lancement dessiné dans la fenêtre principale elle-même

- **Ce qu'il faut** : le mark animé en HTML et CSS **statiques** dans `index.html`, peint
  avant l'exécution du module JS. C'est le conseil « Reduce initial payloads » de Microsoft
  (2.). Il reste retiré une fois l'app prête.
- **Coût** :
  - le premier pixel attend toujours la création de WebView2 (1.2) et le chargement de
    `index.html` et de `styles.css`, feuille bloquante (`index.html:7`) ;
  - une seule WebView2, aucune fenêtre supplémentaire ;
  - le délai jusqu'au premier pixel du mark : **non établi**.
- **Deux réglages possibles** :
  - fenêtre visible dès la création (aujourd'hui) : la fenêtre paraît avant que la page ait
    peint. C'est l'état décrit en 1.3 et 1.4 ;
  - combiné avec A (`visible: false`, puis `show()` au premier `requestAnimationFrame` du
    mark) : la fenêtre ne paraît qu'avec le mark peint, et le délai inclut le cumul cité
    en A.
- **Avec `transparent: true`** : la webview a un fond transparent (1.3). Ce que montre la
  couche fenêtre derrière la page avant la première peinture dépend du remplissage
  `softbuffer` (noir par défaut ou `backgroundColor`) et de l'appel DWM (1.3).
  **Non établi** à l'œil.

---

## 5. Ce qui reste à mesurer (pour la carte, sans trancher)

Sur un build release, dans une instance bac à sable avec une copie de la base :

- t(fenêtre visible) ;
- t(fin de la création de WebView2) ;
- durée de la closure `setup`, découpée : migrations, re-verdict, `watcher::start_all`,
  `worker::refill` ;
- t(première peinture de `index.html`) ;
- t(fin de `boot()`).

Puis ce que l'œil voit entre la création de la fenêtre et l'appel DWM.

## Sources

- Tauri v2, guide « Splashscreen » : https://v2.tauri.app/learn/splashscreen/ (source MDX :
  https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/learn/splashscreen.mdx).
- Microsoft, *Performance best practices for WebView2 apps* :
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance
- Microsoft, *Process model for WebView2 apps* :
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model
- Code source aux versions de `src-tauri/Cargo.lock` : `tauri` 2.11.5, `tauri-runtime-wry`
  2.11.4, `wry` 0.55.1, `webview2-com` 0.38.2, `tauri-utils` 2.9.3,
  `tauri-plugin-window-state` 2.4.1, `notify-debouncer-full` 0.7.0.
- Dépôt Sift au commit `90bf331` : `src-tauri/src/lib.rs`, `src-tauri/src/db.rs`,
  `src-tauri/src/watcher.rs`, `src-tauri/src/worker.rs`, `src-tauri/src/ipc.rs`,
  `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `index.html`,
  `frontend/main.ts`, `frontend/lang-boot.ts`, `frontend/sift-live.ts`.
