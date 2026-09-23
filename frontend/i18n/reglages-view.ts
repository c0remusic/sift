// L'écran Réglages (`reglages-view.ts`) : colonne des catégories, titres et phrases de chaque
// section, libellés des rangées, messages d'état (jeton Discogs, dossier racine, modèle de nommage)
// et toasts d'échec d'enregistrement du thème et de la langue.
//
// Les noms de langue de la rangée Langue (« Français », « English ») n'y sont PAS : ils s'écrivent
// dans leur propre langue, quelle que soit celle de l'interface, et restent des littéraux au site.
// Le texte de la phrase Nommage porte du markup (`<code>`, `&nbsp;`) : il part en `innerHTML`, jamais
// dans un attribut.
import { dict } from "../i18n";

const fr = {
  /** Libellés des catégories, indexés par `dataset.section` ; ce sont aussi les titres des sections. */
  categories: {
    bibliotheque: "Général",
    nommage: "Nommage",
    discogs: "Identification",
    apparence: "Apparence",
  },
  categoriesAria: "Catégories de réglages",
  colonneTitre: "Réglages",
  erreurEnregistrement: "Erreur d'enregistrement.",

  // Identification (Discogs)
  descDiscogs:
    "Le jeton permet à Sift d'interroger l'API Discogs pour identifier tes morceaux (label, année, genre). Sans jeton, Sift n'interroge pas Discogs du tout : le bouton Identifier renvoie ici. Le jeton est gratuit et se génère depuis un compte Discogs.",
  jetonAcces: "Jeton d'accès",
  jetonPlaceholder: "Jeton Discogs…",
  afficherJeton: "Afficher le jeton",
  masquerJeton: "Masquer le jeton",
  verifier: "Vérifier",
  obtenirJeton: "obtenir un jeton",
  verification: "Vérification…",
  jetonAccepte: "Jeton accepté par Discogs.",
  jetonEnregistre: "Jeton enregistré.",
  jetonEfface: "Jeton effacé.",

  // Général (dossier racine)
  descGeneral:
    "Le dossier racine est l'endroit réel sur ton disque où Sift convertit les morceaux filés. L'arborescence de destination (House/Deep, Techno…) vit à l'intérieur. Les dossiers surveillés se gèrent depuis le rail, section Sources.",
  dossierRacine: "Dossier racine",
  aucunDossier: "Aucun dossier sélectionné",
  changer: "Changer…",
  oublierRacine: "Oublier le dossier racine",

  // Nommage
  descNommage:
    "Le nom que Sift donne aux fichiers qu'il range. Trois champs disponibles, à insérer d'un clic. <code>{version}</code> se rend en «&nbsp;(Remix)&nbsp;» quand la piste en a une, et disparaît sinon — pas de parenthèses vides. Le modèle s'enregistre à la frappe.",
  modele: "Modèle",
  modeleAria: "Modèle de nommage",
  apercu: "Aperçu",
  revenirDefaut: "Revenir au modèle par défaut",
  avertVide: "Un modèle vide n'est pas utilisable.",
  avertSansTitle:
    "Sans {title}, deux morceaux du même artiste produisent le même nom — Sift ajoutera un suffixe numérique pour éviter l'écrasement.",
  avertSansArtist:
    "Sans {artist}, les reprises et remixes d'un même titre se retrouvent côte à côte sans distinction.",
  apercuIndisponible: "→ aperçu indisponible",
  modeleEnregistre: "Modèle enregistré.",
  echecEnregistrement: "Échec de l'enregistrement — réessaie.",

  // Apparence
  descApparence:
    "Auto suit le réglage clair/sombre de ton système. Clair et Sombre forcent un mode fixe, quel que soit le système.",
  theme: "Thème",
  auto: "Auto",
  clair: "Clair",
  sombre: "Sombre",
  langue: "Langue",
  langueNote: "Auto suit la langue du système. Changer de langue recharge la fenêtre.",
  themeNonEnregistre:
    "Thème appliqué, mais pas enregistré : il reviendra à sa valeur précédente au prochain lancement.",
  langueNonEnregistree: "Langue non enregistrée — l'interface reste inchangée.",
};

const en: typeof fr = {
  categories: {
    bibliotheque: "General",
    nommage: "Naming",
    discogs: "Identification",
    apparence: "Appearance",
  },
  categoriesAria: "Settings categories",
  colonneTitre: "Settings",
  erreurEnregistrement: "Save failed.",

  descDiscogs:
    "The token lets Sift query the Discogs API to identify your tracks (label, year, genre). Without a token, Sift doesn't query Discogs at all: the Identify button sends you here. The token is free — generate it from a Discogs account.",
  jetonAcces: "Access token",
  jetonPlaceholder: "Discogs token…",
  afficherJeton: "Show the token",
  masquerJeton: "Hide the token",
  verifier: "Verify",
  obtenirJeton: "get a token",
  verification: "Verifying…",
  jetonAccepte: "Discogs accepted the token.",
  jetonEnregistre: "Token saved.",
  jetonEfface: "Token cleared.",

  descGeneral:
    "The root folder is the real place on your disk where Sift converts filed tracks. The destination tree (House/Deep, Techno…) lives inside it. Manage watched folders from the rail, in the Sources section.",
  dossierRacine: "Root folder",
  aucunDossier: "No folder selected",
  changer: "Change…",
  oublierRacine: "Forget the root folder",

  descNommage:
    "The name Sift gives each file when filing it. Three fields available, inserted with one click. <code>{version}</code> renders as “(Remix)” when the track has one, and disappears otherwise — no empty parentheses. The template saves as you type.",
  modele: "Template",
  modeleAria: "Naming template",
  apercu: "Preview",
  revenirDefaut: "Restore the default template",
  avertVide: "An empty template can't work.",
  avertSansTitle:
    "Without {title}, two tracks by the same artist get the same name — Sift will add a numeric suffix to avoid overwriting.",
  avertSansArtist:
    "Without {artist}, covers and remixes of the same title end up side by side with nothing to tell them apart.",
  apercuIndisponible: "→ preview unavailable",
  modeleEnregistre: "Template saved.",
  echecEnregistrement: "Save failed — try again.",

  descApparence:
    "Auto follows your system's light/dark setting. Light and Dark force a fixed mode, whatever the system uses.",
  theme: "Theme",
  auto: "Auto",
  clair: "Light",
  sombre: "Dark",
  langue: "Language",
  langueNote: "Auto follows the system language. Changing the language reloads the window.",
  themeNonEnregistre: "Theme applied, but not saved: it will go back to its previous value at next launch.",
  langueNonEnregistree: "Language not saved — the interface stays as it was.",
};

export const D = { fr, en };
export const T = dict(D);
