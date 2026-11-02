// Barre de menus macOS (#58). Construite par le front, posée une fois au démarrage, après
// `initLang` : changer de langue recharge la fenêtre, et le menu se reconstruit dans la nouvelle.
// Windows n'a pas de barre de menus globale et ne monte rien (`decorations: false`).
//
// Le contenu vit dans `macos-menu-spec.ts`, en données pures. Ici, seulement la traduction vers
// l'API de Tauri.
import { getName } from "@tauri-apps/api/app";
import { Menu, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { T } from "./i18n/macos-menu";
import { macosMenuSpec, type MenuEntry } from "./macos-menu-spec";

function nativeItem(e: MenuEntry): Promise<PredefinedMenuItem> {
  // `About: null` : macOS ouvre alors son panneau standard, qui lit nom et version dans le bundle.
  // Le menu par défaut passe nom et version explicitement — les mêmes valeurs, puisque
  // `tauri.conf.json` ne déclare ni copyright ni éditeur.
  if (e.item === "About") return PredefinedMenuItem.new({ item: { About: null }, text: e.text });
  return PredefinedMenuItem.new({ item: e.item, text: e.text });
}

/** Pose la barre de menus. L'appelant ne l'invoque que sur macOS. Un échec laisse en place le
 *  menu par défaut de Tauri, en anglais mais complet : le copier-coller des champs reste servi. */
export async function installMacosMenu(): Promise<void> {
  try {
    const spec = macosMenuSpec(T(), await getName());
    const submenus = await Promise.all(
      spec.map(async (s) =>
        Submenu.new({ id: s.id, text: s.text, items: await Promise.all(s.items.map(nativeItem)) }),
      ),
    );
    const menu = await Menu.new({ items: submenus });
    await menu.setAsAppMenu();
  } catch (e) {
    console.error("installMacosMenu failed, keeping Tauri's default menu", e);
  }
}
