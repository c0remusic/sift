import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "node_modules/**",
      "storybook-static/**",
      ".claude/**",
      "docs/**",
      // Scripts de build/outillage : Node, hors du périmètre `tsconfig.json`
      // (`include: ["frontend", "shared"]`). Ils ne partagent ni les globals
      // navigateur ni les conventions du front.
      "scripts/**",
    ],
  },
  {
    files: ["frontend/**/*.ts", "shared/**/*.ts"],
    extends: [
      js.configs.recommended,
      // Version NON type-checked : aucun programme TypeScript n'est chargé, donc
      // le lint reste rapide et ne double pas `npx tsc --noEmit`, qui est déjà la
      // gate de types du projet (CI + `.claude/verify.sh`).
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      // `tsconfig.json` a déjà `noUnusedLocals` + `noUnusedParameters`, et le
      // compilateur TypeScript exempte nativement les identifiants préfixés `_`.
      // Sans cet alignement, les deux gates se contredisent sur le même fichier :
      // `tsc --noEmit` passe et `eslint` échoue. Cas réel au premier lancement —
      // `verdictCardHtml(_r)` (`frontend/report-view.ts`), un no-op délibéré dont
      // le paramètre est conservé pour ne pas toucher ses appelants.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // LA MAQUETTE, lintée depuis le 2026-09-15.
    //
    // Elle ne l'était pas : `frontend/app.js` figurait dans `ignores` au-dessus, avec un
    // commentaire disant que « la retirer de cette liste est une décision à prendre pour
    // elle-même ». Elle a été prise — mais la retirer des `ignores` ne suffisait PAS, et c'est le
    // piège : tous les autres blocs ciblent `**/*.ts`, donc le fichier n'était couvert par aucune
    // règle et `npm run lint` restait vert sur du code mort injecté exprès. Une gate qu'on croit
    // posée et qui ne couvre rien est pire que pas de gate.
    //
    // Ce qu'elle garde : ce fichier a porté 58 lignes de code mort — un pont `window.__sift*`
    // sans écrivain depuis 2026-08-19 et sept gardes `__TAURI_INTERNALS__` toujours fausses. Il
    // n'a ni test ni story ; `no-unused-vars` et `no-constant-condition` sont le seul filet
    // automatique qu'il puisse avoir.
    //
    // `browser` et pas `node` : c'est une page, et elle tourne dans un navigateur. `var` et les
    // fonctions nommées y sont volontaires (ES5 lisible sans outillage), donc aucune règle de
    // style moderne n'est imposée — seulement `js.configs.recommended`.
    files: ["frontend/app.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
  },
  {
    // La suite Vitest tourne en environnement Node (voir `vitest.config.ts`) : lui
    // donner les globals navigateur ferait passer un `document` qui n'existe pas.
    files: ["test/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },
);
