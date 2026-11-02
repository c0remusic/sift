// Contenu de la barre de menus macOS, en données pures (#58). Séparé de `macos-menu.ts`, qui le
// construit par l'API de Tauri, pour que Vitest puisse le lire en env Node.
//
// C'est un équivalent STRICT du menu que Tauri 2.11.5 pose de lui-même quand aucun menu n'est
// configuré (`tauri/src/menu/menu.rs`, `Menu::default`, branche macOS) : mêmes sous-menus, mêmes
// articles natifs, même ordre. Seuls les intitulés changent : Tauri les écrit en anglais, ici ils
// suivent la langue de Sift. Aucune commande nouvelle — le contenu de Fichier, d'Aide et de
// Présentation reste une décision d'Antoine sur #58.
import type { T as MenuDict } from "./i18n/macos-menu";

type Labels = ReturnType<typeof MenuDict>;

/** Article natif de Tauri (`PredefinedMenuItem`), le comportement vient du système. */
type NativeItem =
  | "Separator"
  | "About"
  | "Services"
  | "Hide"
  | "HideOthers"
  | "Quit"
  | "CloseWindow"
  | "Undo"
  | "Redo"
  | "Cut"
  | "Copy"
  | "Paste"
  | "SelectAll"
  | "Fullscreen"
  | "Minimize"
  | "Maximize";

export interface MenuEntry {
  item: NativeItem;
  text?: string;
}

interface SubmenuSpec {
  text: string;
  /** Les deux identifiants que Tauri reconnaît en posant le menu (`app.rs`, `init_app_menu`) : ces
   *  sous-menus deviennent le menu Fenêtre et le menu Aide de NSApp, où macOS ajoute la liste des
   *  fenêtres et le champ de recherche de l'aide. Les mêmes que dans le menu par défaut. */
  id?: typeof WINDOW_MENU_ID | typeof HELP_MENU_ID;
  items: MenuEntry[];
}

/** Miroirs de `WINDOW_SUBMENU_ID` et `HELP_SUBMENU_ID` (`tauri/src/menu/menu.rs`). */
export const WINDOW_MENU_ID = "__tauri_window_menu__";
export const HELP_MENU_ID = "__tauri_help_menu__";

const SEP: MenuEntry = { item: "Separator" };

export function macosMenuSpec(t: Labels, app: string): SubmenuSpec[] {
  return [
    {
      text: app,
      items: [
        { item: "About", text: t.about(app) },
        SEP,
        { item: "Services", text: t.services },
        SEP,
        { item: "Hide", text: t.hide(app) },
        { item: "HideOthers", text: t.hideOthers },
        SEP,
        { item: "Quit", text: t.quit(app) },
      ],
    },
    { text: t.file, items: [{ item: "CloseWindow", text: t.closeWindow }] },
    {
      text: t.edit,
      items: [
        { item: "Undo", text: t.undo },
        { item: "Redo", text: t.redo },
        SEP,
        { item: "Cut", text: t.cut },
        { item: "Copy", text: t.copy },
        { item: "Paste", text: t.paste },
        { item: "SelectAll", text: t.selectAll },
      ],
    },
    { text: t.view, items: [{ item: "Fullscreen", text: t.fullscreen }] },
    {
      text: t.window,
      id: WINDOW_MENU_ID,
      items: [
        { item: "Minimize", text: t.minimize },
        { item: "Maximize", text: t.zoom },
        SEP,
        { item: "CloseWindow", text: t.closeWindow },
      ],
    },
    { text: t.help, id: HELP_MENU_ID, items: [] },
  ];
}
