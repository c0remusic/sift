# Interface FR / EN — design

## Décisions d'Antoine (2026-09-23)

1. **Les deux langues, au choix** — pas un remplacement. Sélecteur dans Réglages (carte
   Apparence) : Auto / Français / English. `auto` suit la langue du système.
2. **Frontend, plus les messages du backend qui s'affichent.** « Pas tout le code » : ni les
   commentaires, ni les identifiants, ni les journaux, ni les docs de développement.

## Architecture

**Front.** `frontend/i18n.ts`, feuille pure (env Node) : langue courante, `resolveLang`,
`dict({ fr, en })`, `numLocale()`. Un dictionnaire par module source sous `frontend/i18n/<module>.ts`,
de forme fixe :

```ts
const fr = { ... };
const en: typeof fr = { ... };   // parité tenue par tsc
export const D = { fr, en };      // lu par test/i18n-dictionaries.test.ts
export const T = dict(D);          // T().cle, lu À L'APPEL
```

Pas de dépendance : une bibliothèque i18n demandait une validation (`CLAUDE.md` § Dépendances), et
rien ici n'en a besoin — pas de pluriels ICU, deux langues, un seul accesseur.

**Démarrage.** `lang-boot.ts::initLang()` est attendu par `main.ts` AVANT le câblage des écrans :
lit `ui_lang` (même magasin que `ui_theme`), tranche avec `navigator.language`, pose
`<html lang>`, traduit la coquille d'`index.html` (attributs `data-i18n` / `data-i18n-title`,
dictionnaire `i18n/shell.ts`), pousse la langue au backend.

**Changer de langue recharge la fenêtre.** Un thème s'applique par un attribut ; une langue non,
chaque écran a déjà rendu. Recharger évite d'apprendre à 40 modules à se re-rendre. La vue
courante (Réglages) est confiée à `sessionStorage` et rouverte par `router.ts`.

**Rust.** `src-tauri/src/i18n.rs` : un atome de langue, poussé par `set_ui_lang`, et la macro
`tr!("fr", "en", args…)` — les deux gabarits reçoivent les mêmes arguments explicites, un argument
oublié d'un côté ne compile pas. Défaut : français, donc tous les tests existants restent vrais.
Surcharge par fil pour les tests (`with_lang`).

## Le piège : du texte qui est un protocole

Des chaînes affichées sont AUSSI des marqueurs que du code reconnaît. Les traduire les casse en
anglais seulement, sans erreur de compilation ni test rouge. Inventaire au 2026-09-23 :

| Marqueur | Émis par | Reconnu par | Enjeu |
|---|---|---|---|
| `FILE_GONE` = « n'existe plus », dans une phrase | `analysis/decode.rs` | `ipc.rs::analyze_path` (Rust !) et `filing.ts` | la reconnaissance SUPPRIME une ligne en base |
| « aucun XML Rekordbox lié… » | `ipc_library.rs`, `rekordbox_repairs.rs` | `sift-live.ts` `includes("aucun XML")` | message de repli faux |
| « …n'est plus ambiguë… », « piste choisie invalide… » | `rekordbox_repairs.rs` | `rekordbox-view.ts` `includes(...)` | toast générique au lieu du vrai motif |
| « Terminé », « Échec… », « Volume inaccessible… » | formatage USB (`usb_format`) | `usb-format-modal.ts` `===` / `startsWith` | **le formatage ne se termine jamais à l'écran** |
| « source gone », « NoLibraryRoot », « destination occupied »… | Rust (anglais interne) | front, qui affiche SA traduction | déjà sains : codes, pas prose |

Règle : un message reconnu par du code devient un **code stable** (sentinelle de
`shared/contracts.ts`, épinglée par un test de contrat), et le texte affiché vient du dictionnaire du
front. `FILE_GONE` reste tel quel — changer sa valeur est un changement de protocole — et son
affichage se traduit côté front.

## Phases

1. Socle (front + Rust + gates) — `i18n.ts`, `lang-boot.ts`, `shell.ts`, `i18n.rs`, Réglages.
2. Vague front : ~40 modules, 10 lots disjoints, un agent par lot, relecture par lot.
3. Phase Rust : les couplages ci-dessus, puis les messages affichés, fichier par fichier.
4. Docs : `content.md` § Locale `en` (la règle de glose tombe — l'app expédie l'anglais),
   `manuel.en.html` et son PDF décrivent l'interface anglaise.
5. Vérification dans la vraie fenêtre, en anglais : chaque écran, débordements de libellés.

## Hors périmètre

- `frontend/app.js` : démo navigateur, jamais chargée sous Tauri.
- `dev-inspector.ts`, `dev-annotate.ts`, `selftest.ts` : outils de dev, retirés du build de prod.
- Stories Storybook : documentation, leurs données d'exemple sont du contenu.
- Lignes `console.*` : elles s'adressent au développeur.

## Gates

- `tsc` : parité des clés (`const en: typeof fr`).
- `test/i18n.test.ts` : résolution de langue, accesseur lu à l'appel.
- `test/i18n-dictionaries.test.ts` : aucune valeur anglaise restée française (diacritiques,
  mots-outils). Limite : un mot français sans accent ni mot-outil (« Revue ») passe.
- `test/i18n-coverage.test.ts` : cliquet sur les littéraux français hors `frontend/i18n/` —
  526 au départ.
