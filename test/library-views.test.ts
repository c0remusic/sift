import { afterEach, describe, expect, it } from "vitest";
import type { LibraryTrack } from "../shared/contracts";
import { setCurrentLang } from "../frontend/i18n";
import { libraryTableHeaderHtml, libraryTableRowHtml } from "../frontend/library-views";

// Les textes que la table Rangés pose dans le markup — en-têtes de colonnes, nom accessible d'une
// ligne, bouton de lecture — dans les deux langues. Le piège visé est celui de `i18n.ts` : un
// libellé lu AU CHARGEMENT reste français quand la langue passe à l'anglais. Les en-têtes y étaient
// exposés plus que tout autre texte, puisqu'ils vivaient dans `DEFAULT_COLUMNS`, un tableau construit
// à l'import de `library-columns.ts`.

function track(over: Partial<LibraryTrack> = {}): LibraryTrack {
  return {
    id: 7,
    path: "C:/musique/sans-tags.flac",
    artist: null,
    title: null,
    format: "flac",
    bitrate: null,
    duration: null,
    bpm: null,
    year: null,
    label: null,
    genres: [],
    discogs_release_id: null,
    cover_path: null,
    has_cover: false,
    verdict: null,
    folder: null,
    ...over,
  };
}

const SORT = { field: "artist", dir: "asc" } as const;

afterEach(() => {
  setCurrentLang("fr");
});

describe("library-views — en-têtes", () => {
  it("nomme les colonnes en français par défaut", () => {
    const html = libraryTableHeaderHtml(SORT);
    for (const l of [">Artiste ▴</button>", ">Titre</button>", ">Durée</button>", ">Genre</button>", ">Année</button>"])
      expect(html).toContain(l);
    expect(html).toContain('role="columnheader">Format</span>');
  });

  it("nomme les colonnes en anglais quand la langue change après l'import", () => {
    setCurrentLang("en");
    const html = libraryTableHeaderHtml(SORT);
    for (const l of [">Artist ▴</button>", ">Title</button>", ">Duration</button>", ">Genre</button>", ">Year</button>"])
      expect(html).toContain(l);
    expect(html).not.toMatch(/Artiste|Titre|Durée|Année/);
  });
});

describe("library-views — ligne", () => {
  it("annonce les champs manquants et le bouton de lecture en français", () => {
    const html = libraryTableRowHtml(track(), null);
    expect(html).toContain('aria-label="Artiste inconnu — Titre inconnu, —, genre inconnu, année inconnue"');
    expect(html).toContain('aria-label="Écouter"');
  });

  it("les annonce en anglais", () => {
    setCurrentLang("en");
    const html = libraryTableRowHtml(track(), null);
    expect(html).toContain('aria-label="Unknown artist — Unknown title, —, unknown genre, unknown year"');
    expect(html).toContain('aria-label="Play"');
  });
});
