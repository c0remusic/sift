//! Pure naming logic (no I/O): reconcile a track's embedded tags and its filename into
//! one canonical {artist, title, version} record, and render the output filename from a
//! template. The single source of truth that drives BOTH the filename and the tags
//! written at filing time (see M4 spec). Exhaustively unit-tested; never touches disk.

use serde::{Deserialize, Serialize};

/// How sure we are about the reconciled metadata. Green = file in one click; Yellow =
/// surface for a quick validation pass before committing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Green,
    Yellow,
}

/// The reconciled, canonical metadata for one track. Both the output filename and the
/// embedded tags are derived from this — they can never diverge.
///
/// `label` rides along ONLY for the tag write (the Discogs release label, editable in the Revue
/// pane): it is NOT name-driving — `render_filename`/`tag_title` ignore it (there is no `{label}`
/// placeholder), so widening this struct never changes a filename. `reconcile` sets it to `None`
/// (tags/filename carry no label); the front seeds it from the persisted release facts and lets the
/// user edit it, and `apply_tags` writes it via `write_tags_full`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Canonical {
    pub artist: String,
    pub title: String,
    pub version: Option<String>,
    pub label: Option<String>,
    pub confidence: Confidence,
}

/// Tokens that mark a string as sloppy download metadata rather than a clean field.
const JUNK_TOKENS: &[&str] = &[
    "kbps", "khz", "flac", "http", "www", "320", "256", "192", "128", "rip", "track ", "[", "]",
    "{", "}", "_",
];

/// True if `s` contains any junk token (case-insensitive). Used by the cleanliness gate.
pub fn has_junk(s: &str) -> bool {
    let low = s.to_lowercase();
    JUNK_TOKENS.iter().any(|t| low.contains(t))
}

/// A {artist, title} source is clean when both are non-blank and free of junk tokens.
pub fn is_clean(artist: &str, title: &str) -> bool {
    !artist.trim().is_empty() && !title.trim().is_empty() && !has_junk(artist) && !has_junk(title)
}

/// Pulls a trailing "(...)" off `s` as a version — e.g. "Mystery of Love (Original Mix)" ->
/// ("Mystery of Love", Some("Original Mix")). Pure syntax, no cleanliness requirement: the
/// version only needs its own parens to be well-formed, unlike `parse_filename`'s artist/title.
fn extract_trailing_version(s: &str) -> (String, Option<String>) {
    match (s.rfind('('), s.rfind(')')) {
        (Some(open), Some(close)) if close > open && close == s.len() - 1 => {
            let v = s[open + 1..close].trim().to_string();
            (s[..open].trim().to_string(), Some(v))
        }
        _ => (s.to_string(), None),
    }
}

/// Parse a filename stem (no extension) into (artist, title, version?). Returns None when
/// there is no " - " separator or the parsed fields aren't clean. Pure string work.
pub fn parse_filename(stem: &str) -> Option<(String, String, Option<String>)> {
    let (artist_raw, rest) = stem.split_once(" - ")?;
    let artist = artist_raw.trim().to_string();
    let (title_raw, version) = extract_trailing_version(rest.trim());

    if !is_clean(&artist, &title_raw) {
        return None;
    }
    Some((artist, title_raw, version))
}

/// Best-effort version/mix extraction from a filename stem, independent of overall
/// cleanliness. Unlike `parse_filename`, junk elsewhere in the stem (bitrate, uploader
/// brackets) must not cost us the "(Extended Mix)" trailing the title — Discogs' tracklist
/// matching needs this version hint to pick the right mix even when the tags are clean but
/// the filename carries noise the version parens aren't part of.
fn extract_version_hint(stem: &str) -> Option<String> {
    let rest = match stem.split_once(" - ") {
        Some((_, r)) => r,
        None => stem,
    };
    extract_trailing_version(rest.trim()).1
}

/// A "(feat. X)" paren names a guest, not a mix: it stays in the title. Word boundary required —
/// a bare `starts_with("feat")` took « (Featurecast Remix) » for a guest (relecture #65).
fn is_featuring(v: &str) -> bool {
    let l = v.trim().to_lowercase();
    ["feat.", "feat ", "featuring ", "ft.", "ft "]
        .iter()
        .any(|p| l.starts_with(p))
}

/// Two spellings of the same version ("Original Mix" / "original-mix"): lowercase, `-` and `_`
/// read as spaces, whitespace collapsed.
fn same_version(a: &str, b: &str) -> bool {
    let n = |s: &str| {
        s.to_lowercase()
            .replace(['-', '_'], " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    n(a) == n(b)
}

/// Split a TAG title into (title, version) — the inverse of `tag_title`, which graves
/// "Title (Version)" into the file.
///
/// WHY, 2026-09-23 (issue #65). `reconcile` used to keep the tag title whole AND take the version
/// from the filename, so every edit that went through `apply_tags` came back with its version
/// twice: the real file of the report read « Elastic (Original Mix) (Original-Mix) » after a few
/// round trips. The loop below also heals that doubling on files it already damaged: trailing
/// parens that repeat the extracted version are dropped. A "(feat. X)" paren is never a version.
pub(crate) fn split_tag_title(tag_title: &str) -> (String, Option<String>) {
    let whole = tag_title.trim();
    let (mut base, version) = extract_trailing_version(whole);
    let Some(v) = version.filter(|v| !v.is_empty() && !is_featuring(v)) else {
        return (whole.to_string(), None);
    };
    while let (shorter, Some(again)) = extract_trailing_version(&base) {
        if !same_version(&again, &v) {
            break;
        }
        base = shorter;
    }
    if base.is_empty() {
        return (whole.to_string(), None);
    }
    (base, Some(v))
}

/// Normalize for the "do tags and filename agree?" comparison: lowercase, collapse
/// whitespace. Internal to reconcile.
fn norm(s: &str) -> String {
    s.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Reconcile embedded tags and the filename stem into one canonical record + confidence.
/// See the M4 spec's four-case matrix. Tags are preferred when clean. The version comes from the
/// tag title's trailing paren when it has one — that is where `tag_title` graves it — and from
/// the filename otherwise (see `split_tag_title`, issue #65).
pub fn reconcile(tag_artist: &str, tag_title: &str, stem: &str) -> Canonical {
    let tags_clean = is_clean(tag_artist, tag_title);
    let parsed = parse_filename(stem); // Some only if the name is clean
    let name_version = parsed.as_ref().and_then(|(_, _, v)| v.clone());
    let (tag_base, tag_version) = split_tag_title(tag_title);

    match (tags_clean, &parsed) {
        // both clean: agree -> green; disagree -> yellow (tags shown as default)
        (true, Some((pa, pt, _))) => {
            // Une parenthèse que le NOM porte aussi DANS son titre fait partie du titre : tag
            // « Bar A Thym (Part 2) », nom « … - Bar A Thym (Part 2) (Original Mix) ». La couper en
            // aurait fait la version, jeté « Original Mix » et fait tomber la piste en jaune
            // (relecture #65). Sinon la parenthèse du tag est sa version, celle que `tag_title` y a
            // gravée.
            let (title, version) = if norm(tag_title) == norm(pt) {
                (tag_title.trim().to_string(), name_version)
            } else {
                (tag_base, tag_version.or(name_version))
            };
            let agree = norm(tag_artist) == norm(pa) && norm(&title) == norm(pt);
            Canonical {
                artist: tag_artist.trim().to_string(),
                title,
                version,
                label: None,
                confidence: if agree {
                    Confidence::Green
                } else {
                    Confidence::Yellow
                },
            }
        }
        // tags clean only -> green from tags. Filename didn't parse as a whole (junk
        // elsewhere), but a trailing "(...)" version is still worth pulling independently —
        // see extract_version_hint.
        (true, None) => Canonical {
            artist: tag_artist.trim().to_string(),
            title: tag_base,
            version: tag_version.or_else(|| extract_version_hint(stem)),
            label: None,
            confidence: Confidence::Green,
        },
        // name clean only -> green from name
        (false, Some((pa, pt, v))) => Canonical {
            artist: pa.clone(),
            title: pt.clone(),
            version: v.clone(),
            label: None,
            confidence: Confidence::Green,
        },
        // neither clean -> yellow, best guess = a *cleaned* stem as title for the user to edit
        (false, None) => Canonical {
            artist: String::new(),
            title: clean_stem(stem),
            version: None,
            label: None,
            confidence: Confidence::Yellow,
        },
    }
}

/// Best-effort tidy of a messy filename stem for the editable title prefill: drop a leading
/// track number, replace underscores with spaces, remove `[bracketed]` junk (uploaders/labels)
/// and quality tokens (320kbps, FLAC, kHz…), then collapse whitespace. Conservative — it only
/// improves the starting point; the user still confirms (yellow).
pub fn clean_stem(stem: &str) -> String {
    let mut s = stem.replace('_', " ");
    // drop [ ... ] segments
    while let (Some(a), Some(b)) = (s.find('['), s.find(']')) {
        if b > a {
            s.replace_range(a..=b, " ");
        } else {
            break;
        }
    }
    // drop ( ... ) segments only when their content is known source/quality noise (never a
    // blind strip: "(Original Mix)"/"(feat. X)" are meaningful and must survive).
    const NOISE_PAREN: &[&str] = &["rip", "bootleg", "promo", "unofficial"];
    while let (Some(a), Some(b)) = (s.find('('), s.find(')')) {
        if b <= a {
            break;
        }
        let inner = s[a + 1..b].to_lowercase();
        if NOISE_PAREN.iter().any(|k| inner.contains(k)) {
            s.replace_range(a..=b, " ");
        } else {
            break;
        }
    }
    // strip a leading track number ("01 ", "1.", "12 - ") — only 1–3 digits + a separator
    {
        let t = s.trim_start();
        let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
        if (1..=3).contains(&digits) {
            let rest = t[digits..].trim_start_matches([' ', '.', '-', ')', '_']);
            if !rest.is_empty() && rest.len() < t.len() {
                s = rest.to_string();
            }
        }
    }
    // drop quality/junk tokens word-by-word (case-insensitive)
    const DROP: &[&str] = &[
        "kbps", "320", "256", "192", "128", "flac", "wav", "aiff", "khz", "hz", "hq", "cbr", "vbr",
        "rip",
    ];
    let kept: Vec<&str> = s
        .split_whitespace()
        .filter(|w| {
            let lw = w.to_lowercase();
            !DROP.iter().any(|d| lw == *d)
        })
        .collect();
    kept.join(" ").trim().to_string()
}

/// Replace characters illegal in Windows/macOS filenames with a space, then collapse
/// runs of whitespace and trim. Keeps the name human-readable.
pub fn sanitize(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// " (Version)" suffix shared by `render_filename` and `tag_title` — "" when absent, no empty
/// parens.
fn version_suffix(c: &Canonical) -> String {
    match &c.version {
        Some(v) if !v.trim().is_empty() => format!(" ({})", v.trim()),
        _ => String::new(),
    }
}

/// Render `template` against a canonical record and append `.ext`. Supported placeholders:
/// `{artist}`, `{title}`, `{version}`. `{version}` expands to " (Version)" when present,
/// to "" when absent (no empty parens). The whole stem is sanitized for the filesystem.
pub fn render_filename(template: &str, c: &Canonical, ext: &str) -> String {
    let stem = template
        .replace("{artist}", &c.artist)
        .replace("{title}", &c.title)
        .replace("{version}", &version_suffix(c));
    format!("{}.{}", sanitize(&stem), ext)
}

/// The title as it should be WRITTEN TO THE ID3/tag Title field — title + the same " (Version)"
/// suffix `render_filename` puts in the filename. Both must derive from this one function: a
/// track named "Title (Extended Mix).aiff" previously had the version silently absent from its
/// own Title tag (write_tags_full call sites passed `c.title` alone), so a CDJ/Rekordbox reading
/// the file's tags directly — not the filename — never saw it. No filesystem sanitization here,
/// unlike render_filename: this never touches a path.
pub fn tag_title(c: &Canonical) -> String {
    format!("{}{}", c.title, version_suffix(c))
}

/// Fold the common accented Latin letters to ASCII (no extra crate) so "Béatrice" and
/// "Beatrice" key the same.
fn fold_char(c: char) -> char {
    match c {
        'à' | 'â' | 'ä' | 'á' | 'ã' => 'a',
        'ç' => 'c',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'î' | 'ï' | 'í' | 'ì' => 'i',
        'ô' | 'ö' | 'ó' | 'ò' | 'õ' => 'o',
        'ù' | 'û' | 'ü' | 'ú' => 'u',
        'ñ' => 'n',
        other => other,
    }
}

/// A normalized key answering "is this the same track by name?": artist + title, accent-
/// folded, lowercased, punctuation dropped, whitespace collapsed. Two spellings of the same
/// track collapse to the same key; different titles stay distinct. Drives dedup's name pre-
/// filter. Pure, no I/O.
pub fn name_key(artist: &str, title: &str) -> String {
    fn norm(s: &str) -> String {
        // lowercase first (unicode-aware: É → é) so the accent fold catches both cases
        let folded: String = s
            .to_lowercase()
            .chars()
            .map(fold_char)
            .map(|c| if c.is_alphanumeric() { c } else { ' ' })
            .collect();
        folded.split_whitespace().collect::<Vec<_>>().join(" ")
    }
    // Space-join (no separator) ON PURPOSE: it lets "Larry Heard - Mystery of Love" match a
    // file named "larry_heard mystery of love" with no " - " split — a common cross-naming
    // duplicate. The theoretical ("","x") vs ("x","") collision is accepted as harmless here.
    format!("{} {}", norm(artist), norm(title))
        .trim()
        .to_string()
}

// ---------------------------------------------------------------------------------------------
// Clé de regroupement des doublons, v2 — écran « Doublons », décidée par Antoine le 2026-10-05
// ---------------------------------------------------------------------------------------------

/// Mots qui, seuls, ne nomment aucun morceau. Une clé qui ne porte qu'eux (avec des nombres, des
/// codes de face, des mots de version) n'a pas d'identité : « 01 Untitled » et « 02 Untitled »
/// d'un même maxi sont deux morceaux, deux « Intro » de deux albums aussi.
const GROUP_GENERIC_WORDS: &[&str] = &[
    "untitled",
    "unititled",
    "track",
    "piste",
    "audio",
    "unknown",
    "inconnu",
    "sans",
    "titre",
    "intro",
    "outro",
    "interlude",
];

/// Mots de version : ils séparent deux versions d'un même titre, mais ne nomment pas un morceau à
/// eux seuls — « A1 (Dub) » sans titre n'est le doublon d'aucun autre « Dub ».
const GROUP_VERSION_WORDS: &[&str] = &[
    "mix",
    "remix",
    "rmx",
    "dub",
    "edit",
    "version",
    "original",
    "extended",
    "radio",
    "club",
    "vocal",
    "instrumental",
    "rework",
    "reprise",
    "remaster",
    "remastered",
];

/// Versions qui valent ABSENCE de version dans la clé, comparées normalisées (casse, tirets,
/// soulignés ignorés : « Original-Mix », « original_mix »). Décidé le 2026-10-05 sur mesure de
/// l'intégrateur : sur Beatport « Original Mix » est la version par défaut, et
/// « Artiste - Titre.mp3 » et « Artiste - Titre (Original Mix).aiff » sont presque toujours le
/// même morceau — le filet est en aval (un écart de durée de plus de 0,1 s sans preuve plus forte
/// rend le groupe « À vérifier »). Aucune autre version : « Extended Mix », « Original Version »,
/// « Original Club Mix » restent distinctes de l'absence.
const GROUP_DEFAULT_VERSIONS: &[&str] = &["original mix", "original"];

/// Formats de fichier. L'extension est partie avec le radical : un format écrit DANS le nom est une
/// étiquette de source (« (mp3) », « … Mix) Wav »), jamais un mot du titre. « wave » et « opus »
/// n'y sont pas : « Heat Wave », « Opus » sont des titres.
const GROUP_FORMAT_WORDS: &[&str] = &[
    "mp3", "flac", "wav", "aiff", "aif", "alac", "aac", "m4a", "ogg", "wma",
];

/// Domaines de premier niveau qui trahissent une URL écrite sans « www. » : « my-free-mp3s.com »,
/// « myfreemp3.vip », « [YT2mp3.info] », « 0daymusic.org » (bibliothèque mesurée, 2026-10-05).
const GROUP_URL_TLDS: &[&str] = &["com", "net", "org", "info", "biz", "ru", "kz", "vip", "io"];

/// Résidus de séparateur qu'un retrait laisse en queue (« … (Original Mix) -  [320 kbps] »).
const GROUP_TRAILING_RESIDUE: [char; 5] = [' ', '-', '_', ',', ';'];

/// La clé « même morceau par le NOM » d'un fichier, calculée sur son radical (le nom SANS
/// extension) : artiste + titre + version, normalisés, une fois le nom nettoyé de ce que le
/// téléchargement et le rangement y ont accroché. Pure, sans I/O.
///
/// # Contrat
///
/// - Deux noms qui ne diffèrent que par la version donnent deux clés : « X - Y (Dub) »,
///   « X - Y (Club Mix) » et « X - Y » sont trois morceaux. Décidé le 2026-10-05 : sur la vraie
///   base, 36 groupes de l'ancienne clé (`dedup::key_for_path`, qui jetait la version d'un nom
///   propre) mêlaient des versions différentes ; 33 le restent une fois « Original Mix » rendue à
///   l'absence (ligne suivante).
/// - SAUF la version par défaut : « (Original Mix) » et « (Original) » valent absence de version
///   (`GROUP_DEFAULT_VERSIONS`) — « X - Y (Original Mix) » rejoint « X - Y », « X - Y (Extended
///   Mix) » non.
/// - Casse, accents, ponctuation et séparateurs ne comptent pas : « X - Y (Club Mix) »,
///   « X - Y (club mix) », « x_-_y_(club_mix) » et « Cherry-Bomb---Elastic-(Club-Mix) » (pour
///   « Cherry Bomb - Elastic (Club Mix) ») donnent la même clé.
/// - La clé est la suite des MOTS de l'artiste, du titre et de la version affichés
///   (`display_parts`), dans l'ordre du nom. Une version écrite sans parenthèses (« Pixel Waterfall
///   Club Mix ») est donc la même suite de mots que « (Club Mix) » ; la version par défaut écrite
///   sans parenthèses (« … Pixel Waterfall Original Mix ») vaut absence comme entre parenthèses.
///   Un nom sale garde sa version comme un nom propre — l'ancienne clé la gardait sur un nom sale
///   et la jetait sur un nom propre.
/// - `None` : le nom ne porte aucune identité propre — vide une fois nettoyé, ou fait seulement de
///   mots génériques (« Untitled », « Track 01 »), de mots de version, de nombres, de codes de
///   face (« A1 »). Un tel fichier ne se regroupe PAS par le nom : l'appelant ne doit jamais
///   réunir deux `None`. « Track 1 » AVEC un artiste (« Artiste - Track 1 ») est un titre réel et
///   garde sa clé ; sans artiste il ne dit rien du morceau.
///
/// # Principe de chaque règle de nettoyage
///
/// Ne retirer que ce qui ne peut PAS porter l'identité du morceau. Un nettoyage qui fusionnerait
/// deux morceaux distincts est pire que le doublon qu'il trouve : dans le doute, le jeton reste et
/// le doublon est manqué. Chaque règle porte, dans son commentaire, les cas réels qui l'ont bornée.
/// Les règles, dans l'ordre d'application :
///
/// 1. tirets typographiques et espaces insécables uniformisés (`unify_separators`) ;
/// 2. groupes retirés où qu'ils soient : accolades, débit/format, URL (`drop_groups`) ;
/// 3. URL hors groupe retirées (`drop_url_words`) ;
/// 4. en queue, en boucle : suffixes de copie, hash scène, débit/format libres
///    (`strip_trailing_marks`) ;
/// 5. en tête : références de release, puis UNE marque de position (`strip_leading_marks`) ;
/// 6. découpage en (artiste, titre, version) pour l'affichage (`display_parts`) ;
/// 7. normalisation des trois parts : apostrophes et accents combinants supprimés, « å »/« ø »
///    repliés (`fold_for_group`), puis `name_key` ; la version par défaut tombe (`key_of_parts`).
///
/// `group_key` est calculée SUR les parts de `display_parts` (`key_of_parts`) : c'est une fonction
/// de ce que l'en-tête de groupe affiche, normalisé — deux noms de même clé peuvent s'afficher
/// différemment (« 01 - Larry Heard - Mystery Of Love » et « larry_heard_-_mystery_of_love »).
///
/// UNE exception, voulue : le nom FAIBLE — aucun artiste affiché, et moins de deux mots
/// d'identité dans le titre et la version (« Forever », « Gripen », « A Theory ») — garde dans sa
/// clé sa marque de position (numéro de piste ou face, zéros de tête retirés), que l'affichage ne
/// montre pas. Sans artiste, un titre d'un seul mot ne nomme pas un morceau : retirer la position
/// réunissait « 22 - Forever » (dossier d'un DJ) et « 2. Forever (Original Mix) » (album
/// d'Aladdin), deux morceaux, mesuré le 2026-10-05. « 06 Gripen » et « 6. Gripen » restent réunis.
/// Deux noms faibles peuvent donc s'afficher pareil et porter deux clés.
///
/// Appelants : `doublons::cle_de_nom`, donc l'écran Doublons ET la pastille de Revue
/// (`dedup::key_for_path`) — une seule clé de nom pour les deux.
pub fn group_key(stem: &str) -> Option<String> {
    let (cleaned, position) = group_clean(stem);
    let (artist, title, version) = split_display(&cleaned);
    key_of_parts(
        artist.as_deref(),
        &title,
        version.as_deref(),
        position.as_deref(),
    )
}

/// Forme d'AFFICHAGE d'un nom de fichier (radical sans extension) : `(artiste, titre, version)`,
/// nettoyée par les mêmes règles que `group_key` (1 à 5), casse et accents conservés. Pure.
///
/// - Nom propre : comme `parse_filename` — artiste avant le premier « - », version = parenthèse
///   finale —, à trois écarts près, voulus : une marque de position ou un suffixe de copie
///   qu'`is_clean` laisse passer est retiré (« 01 Olsvanger - The Triss » → artiste « Olsvanger »,
///   « Dav - Dreams about me-1 » → titre « Dreams about me ») ; une parenthèse « (feat. X) » reste
///   dans le titre, comme dans `split_tag_title` ; les espaces multiples sont réduites.
/// - Nom sale : le radical nettoyé, découpé sur « - » (ou « _-_ », la première course de tirets
///   d'un nom scène, le « --- » Beatport) quand il en porte un ; sinon `(None, radical nettoyé,
///   version)`. Les soulignés s'affichent en espaces.
///
/// Le découpage ne retire ni ne réordonne aucun caractère alphanumérique : il ne touche qu'aux
/// séparateurs. C'est ce qui fait de `group_key` une fonction de ces trois parts (hors nom faible,
/// voir `group_key`).
///
/// Appelant : l'en-tête de groupe de l'écran Doublons (`doublons::assembler`).
pub fn display_parts(stem: &str) -> (Option<String>, String, Option<String>) {
    split_display(&group_clean(stem).0)
}

/// Les règles 1 à 5 : le radical nettoyé, encore lisible (casse, accents et ponctuation intacts),
/// et la marque de position retirée en tête, normalisée (`position_token`), pour le nom faible.
fn group_clean(stem: &str) -> (String, Option<String>) {
    let s = unify_separators(stem);
    let s = drop_groups(&s, |opener, inner| {
        opener == b'{' || is_quality_group(inner) || is_url_text(inner)
    });
    let s = drop_url_words(&s);
    let s = strip_trailing_marks(&s);
    let (rest, position) = strip_leading_marks(&s);
    (rest.to_string(), position.map(position_token))
}

/// La règle 7 et le test d'identité : chaque part normalisée, la version par défaut retirée
/// (`GROUP_DEFAULT_VERSIONS`), puis les parts mises bout à bout dans l'ordre du nom. Sans version
/// affichée, « original mix » en fin de titre est la même version par défaut écrite sans
/// parenthèses (« Pixel Waterfall Original Mix », corpus ; « …_Original_Mix » des noms scène) et
/// tombe aussi. « original » seul en fin de titre reste : « The Original » peut être le titre.
/// Un nom faible (voir `group_key`) garde `position` en tête de clé.
fn key_of_parts(
    artist: Option<&str>,
    title: &str,
    version: Option<&str>,
    position: Option<&str>,
) -> Option<String> {
    let norm = |s: &str| name_key("", &fold_for_group(s));
    let mut title = norm(title);
    let version = match version.map(norm) {
        Some(v) if GROUP_DEFAULT_VERSIONS.contains(&v.as_str()) => None,
        Some(v) => Some(v),
        None => {
            if let Some(head) = title.strip_suffix("original mix") {
                if head.is_empty() || head.ends_with(' ') {
                    title = head.trim_end().to_string();
                }
            }
            None
        }
    };
    let artist = artist.map(norm).filter(|a| !a.is_empty());
    let named_words = [Some(&title), version.as_ref()]
        .into_iter()
        .flatten()
        .flat_map(|p| p.split(' '))
        .filter(|w| is_identity_word(w))
        .count();
    let position = position
        .filter(|_| artist.is_none() && named_words < 2)
        .map(str::to_string);
    let key = [position, artist, Some(title), version]
        .into_iter()
        .flatten()
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    has_identity(&key).then_some(key)
}

/// Un mot qui nomme : deux lettres au moins, ni générique ni de version.
fn is_identity_word(w: &str) -> bool {
    w.chars().filter(|c| c.is_alphabetic()).count() >= 2
        && !GROUP_GENERIC_WORDS.contains(&w)
        && !GROUP_VERSION_WORDS.contains(&w)
}

/// Une marque de position retirée en tête, sous forme de clé : ses jetons alphanumériques en
/// minuscules, les nombres sans zéros de tête — « 06 », « 6. » et « (06) » donnent « 6 »,
/// « A1- » donne « a1 », « 1-05 - » donne « 1 5 ».
fn position_token(marker: &str) -> String {
    marker
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| {
            let t = t.to_ascii_lowercase();
            if t.bytes().all(|b| b.is_ascii_digit()) {
                match t.trim_start_matches('0') {
                    "" => "0".to_string(),
                    z => z.to_string(),
                }
            } else {
                t
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Règle 6. Découpe un radical nettoyé en (artiste, titre, version) pour l'affichage, sur le
/// premier « - » entouré d'espaces, à défaut sur un tiret qu'une espace ne borde que d'un côté
/// (« Balage- High in l.a. », « Chaircrusher- Gam 2 » dans la bibliothèque mesurée). Un tiret
/// collé des deux côtés (« Haris-Right Information », « U-Too ») ne découpe pas : il vit aussi
/// À L'INTÉRIEUR des noms. Un artiste ou un titre vide n'est pas un découpage : le nom entier
/// reste le titre.
fn split_display(cleaned: &str) -> (Option<String>, String, Option<String>) {
    let spaced = display_separators(cleaned);
    let s = trim_residue_tokens(&spaced);
    let cut = [" - ", " -", "- "]
        .iter()
        .find_map(|sep| s.split_once(sep))
        .map(|(a, r)| (trim_residue_tokens(a), trim_residue_tokens(r)))
        .filter(|(a, r)| !a.is_empty() && !r.is_empty());
    let (artist, rest) = match cut {
        Some((a, r)) => (Some(a.to_string()), r),
        None => (None, s),
    };
    let (title, version) = split_display_version(rest);
    (artist, title, version)
}

/// Retire, en tête et en queue, les « mots » faits seulement de séparateurs (« - », « -- »,
/// « _ », « . ») qu'un retrait laisse derrière lui : « [YT2mp3.info] - DJ Lima … » ne s'affiche
/// pas « - DJ Lima ». Un tiret collé à un mot (« -ism », titre réel du corpus) n'en est pas un.
/// Les mots sont séparés d'espaces simples à ce stade (`drop_url_words`, `display_separators`).
fn trim_residue_tokens(s: &str) -> &str {
    let is_residue = |w: &str| {
        !w.is_empty()
            && w.chars()
                .all(|c| matches!(c, '-' | '_' | '.' | ',' | ';' | ':'))
    };
    let mut t = s.trim();
    while let Some((first, rest)) = t.split_once(' ') {
        if !is_residue(first) {
            break;
        }
        t = rest.trim_start();
    }
    while let Some((rest, last)) = t.rsplit_once(' ') {
        if !is_residue(last) {
            break;
        }
        t = rest.trim_end();
    }
    if is_residue(t) {
        ""
    } else {
        t
    }
}

/// Règle 6. Les séparateurs d'un nom, mis à la forme « Artiste - Titre (Version) ». Ne touche
/// QUE des caractères non alphanumériques :
///
/// - « _-_ » est un séparateur de champ, le souligné seul une espace (noms scène) ;
/// - un nom sans espace ni souligné qui porte « --- » suit la convention Beatport/Soulseek
///   (`Cherry-Bomb---Elastic-(Original-Mix)`, issue #66) : « --- » sépare, « - » est une espace ;
/// - un nom scène (soulignés, aucune espace) sans « _-_ » sépare ses champs par sa première course
///   de tirets (`vince_watson-method_of_emotion`).
fn display_separators(cleaned: &str) -> String {
    let no_space = !cleaned.contains(' ');
    let mut s = cleaned.replace("_-_", " - ");
    if no_space && !cleaned.contains('_') && cleaned.contains("---") {
        s = s
            .replace("---", "\u{1}")
            .replace('-', " ")
            .replace('\u{1}', " - ");
    } else if no_space && cleaned.contains('_') && !s.contains(" - ") {
        if let Some(i) = s.find('-') {
            let run = s[i..].bytes().take_while(|&b| b == b'-').count();
            s = format!("{} - {}", &s[..i], &s[i + run..]);
        }
    }
    s.replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Règle 6. La parenthèse finale est la version, sauf « (feat. X) », qui nomme un invité et reste
/// dans le titre (`is_featuring`), et sauf si elle est tout le nom. À défaut de parenthèse, un
/// crochet final qui porte un mot de version l'est aussi (« [Freaky Chakra Mix] »,
/// « [original] », bibliothèque mesurée) ; un crochet final sans mot de version (« [Little Fluffy
/// Records] », « [benonedit] ») reste dans le titre.
fn split_display_version(rest: &str) -> (String, Option<String>) {
    let whole = rest.trim();
    if let (base, Some(v)) = extract_trailing_version(whole) {
        if !base.is_empty() && !v.is_empty() && !is_featuring(&v) {
            return (base, Some(v));
        }
        return (whole.to_string(), None);
    }
    if let Some(open) = whole.strip_suffix(']').and_then(|body| body.rfind('[')) {
        let base = whole[..open].trim();
        let v = whole[open + 1..whole.len() - 1].trim();
        let versionish = v
            .split(|c: char| !c.is_alphanumeric())
            .any(|w| GROUP_VERSION_WORDS.contains(&w.to_lowercase().as_str()));
        if !base.is_empty() && versionish && !is_featuring(v) {
            return (base.to_string(), Some(v.to_string()));
        }
    }
    (whole.to_string(), None)
}

/// Règle 1. Tirets typographiques (‒ U+2012, – U+2013, — U+2014, − U+2212) → « - » : « CJ Art –
/// Acedia » se découpe comme « CJ Art - Acedia ». Le tiret U+2010 reste : il vit À L'INTÉRIEUR des
/// noms (« E‐Man »), comme dans `search_terms::normalise`, et la normalisation finale en fait un
/// espace de toute façon. Les espaces insécables n'ont pas besoin d'être traitées ici :
/// `drop_url_words` réduit toute espace Unicode à une espace simple.
fn unify_separators(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2212}' => '-',
            c => c,
        })
        .collect()
}

/// Règle 2 (mécanique). Retire chaque groupe délimité — parenthèses, crochets, accolades, appariés
/// ou DÉPAREILLÉS (`(spm007]` existe dans la bibliothèque mesurée) — dont le contenu satisfait
/// `drop`. Un groupe est un ouvrant suivi du premier fermant sans autre ouvrant entre les deux :
/// des groupes imbriqués se lisent de l'intérieur, un ouvrant orphelin reste tel quel.
fn drop_groups(s: &str, drop: impl Fn(u8, &str) -> bool) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find(['(', '[', '{']) {
        let after = &rest[open + 1..];
        let Some(k) = after.find([')', ']', '}', '(', '[', '{']) else {
            break;
        };
        if matches!(after.as_bytes()[k], b'(' | b'[' | b'{') {
            out.push_str(&rest[..open + 1 + k]);
            rest = &after[k..];
            continue;
        }
        if drop(rest.as_bytes()[open], &after[..k]) {
            out.push_str(&rest[..open]);
            out.push(' ');
        } else {
            out.push_str(&rest[..open + 1 + k + 1]);
        }
        rest = &after[k + 1..];
    }
    out.push_str(rest);
    out
}

/// Règle 2. Vrai si le contenu d'un groupe n'est qu'une marque de qualité ou de format :
/// « 320 kbps », « 320kbps », « mp3 », « 24bit 96khz ». TOUS les jetons doivent en être — une
/// version qui contient un débit (« 8 Bit Mix ») reste —, et au moins un ne doit pas être un
/// nombre nu : « (1991) » peut nommer une version, « (2) » est traité comme suffixe de copie.
fn is_quality_group(inner: &str) -> bool {
    let toks: Vec<String> = inner
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
        .collect();
    let digits_only = |t: &String| t.bytes().all(|b| b.is_ascii_digit());
    let quality = |t: &String| {
        is_format_word(t) || is_bitrate_token(t) || matches!(t.as_str(), "vbr" | "cbr" | "lossless")
    };
    !toks.is_empty()
        && toks.iter().all(|t| digits_only(t) || quality(t))
        && toks.iter().any(quality)
}

fn is_format_word(t: &str) -> bool {
    GROUP_FORMAT_WORDS.contains(&t)
}

/// Un jeton de débit ou d'échantillonnage, en minuscules : `kbps`, `kbit`, `khz` seuls, ou un
/// nombre collé à son unité (`320kbps`, `152kbit`, `320k`, `44khz`, `24bit`). Une unité courte
/// (`k`, `bit`) exige son nombre : seule, elle est un mot comme un autre.
fn is_bitrate_token(t: &str) -> bool {
    let digits = t.bytes().take_while(u8::is_ascii_digit).count();
    let unit = &t[digits..];
    matches!(unit, "kbps" | "kbit" | "kbits" | "khz")
        || (digits > 0 && matches!(unit, "k" | "bit" | "bits"))
}

/// Règle 2. Vrai si le texte porte une URL : « www. », « http », ou un mot en forme de domaine.
fn is_url_text(inner: &str) -> bool {
    let low = inner.to_ascii_lowercase();
    low.contains("www.") || low.contains("http") || inner.split_whitespace().any(is_domain_word)
}

/// Un mot en forme de domaine (`my-free-mp3s.com`, `yt2mp3.info`) : lettres, chiffres, tirets et
/// points, la dernière étiquette dans `GROUP_URL_TLDS`. « V.R.Volvox », « M.L.G. », « Vol.3D »,
/// « St.Germain » n'en sont pas : leur dernière étiquette n'est pas un domaine connu.
fn is_domain_word(w: &str) -> bool {
    let w = w.trim_matches(|c: char| !c.is_ascii_alphanumeric());
    let low = w.to_ascii_lowercase();
    let Some((head, tld)) = low.rsplit_once('.') else {
        return false;
    };
    GROUP_URL_TLDS.contains(&tld)
        && head.bytes().any(|b| b.is_ascii_alphabetic())
        && low
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}

/// Règle 3. Retire les URL hors groupe (« … Original Mix-www.groovytunes.org »,
/// « … Sex In The Dark my-free-mp3s.com »). Une URL collée à du texte utile par un tiret est
/// coupée à son début : « Original Mix » reste. Les mots ressortent séparés d'une espace simple.
fn drop_url_words(s: &str) -> String {
    let mut kept: Vec<&str> = Vec::new();
    for w in s.split_whitespace() {
        let low = w.to_ascii_lowercase();
        let start = ["www.", "http://", "https://"]
            .iter()
            .filter_map(|p| low.find(p))
            .min();
        match start {
            Some(k) => {
                let head = w[..k].trim_end_matches(['-', '.', ',', '_']);
                if !head.is_empty() {
                    kept.push(head);
                }
            }
            None if is_domain_word(w) => {}
            None => kept.push(w),
        }
    }
    kept.join(" ")
}

/// Règle 4. Retire, en boucle, ce qui s'accroche à la FIN d'un nom sans en faire partie, avec les
/// résidus de séparateur que chaque retrait laisse. Chaque retrait raccourcit strictement le nom :
/// la boucle termine.
fn strip_trailing_marks(s: &str) -> String {
    let mut cur = s.trim_end_matches(GROUP_TRAILING_RESIDUE).to_string();
    while let Some(shorter) = strip_copy_paren(&cur)
        .or_else(|| strip_windows_copy(&cur))
        .or_else(|| strip_dash_one(&cur))
        .or_else(|| strip_scene_hash(&cur))
        .or_else(|| strip_trailing_quality_word(&cur))
    {
        cur = shorter.trim_end_matches(GROUP_TRAILING_RESIDUE).to_string();
    }
    cur
}

/// Règle 4. « (1) », « (2) », « X(1) » en fin de nom : la copie de Windows et des navigateurs. Un
/// ou deux chiffres seulement — « (1991) » est une année, qui peut nommer une version (« Blue
/// Monday 1988 »), et reste.
fn strip_copy_paren(s: &str) -> Option<&str> {
    let body = s.strip_suffix(')')?;
    let open = body.rfind('(')?;
    let inner = &body[open + 1..];
    if !(1..=2).contains(&inner.len()) || !inner.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let head = body[..open].trim_end();
    (!head.is_empty()).then_some(head)
}

/// Règle 4. « Nom - Copy », « Nom - Copie » : la copie de l'Explorateur Windows, anglais et
/// français (le « (2) » qui peut suivre part avant, par `strip_copy_paren`). Exige le « - » ET qu'il
/// en reste un devant : « Aardvarck - Cult Copy » (titre réel de la bibliothèque mesurée) et
/// « Artiste - Copy » (titre « Copy ») gardent leur mot. Le « copy » nu du Finder n'est pas traité :
/// il ne se distingue pas d'un titre qui finit par « Copy ».
fn strip_windows_copy(s: &str) -> Option<&str> {
    for suffix in [" - copy", " - copie"] {
        let Some(cut) = s.len().checked_sub(suffix.len()) else {
            continue;
        };
        if s.is_char_boundary(cut) && s[cut..].eq_ignore_ascii_case(suffix) {
            let head = &s[..cut];
            if head.contains(" - ") {
                return Some(head);
            }
        }
    }
    None
}

/// Règle 4. « -1 », « -01 », « -001 » collé en fin de nom : la copie d'un navigateur ou l'ordinal
/// d'un téléchargeur. 24 cas sur la bibliothèque mesurée (« Dav - Dreams about me-1 »,
/// « … (2022 remaster)-1 », « … Dimm the Lights-01 », « … Depth-001 »), tous des copies. Deux
/// garde-fous, chacun payé par un cas réel :
///
/// - la valeur doit être UN : « -2 » n'y apparaît que dans des titres (« … - M-2 », « … C-2 »),
///   dont le jumeau en « -1 » existe ;
/// - devant le tiret, une parenthèse ou un crochet fermant, ou un mot d'au moins deux lettres :
///   « M-1 » (titre), « C-1 » (code de face), « L-1 » (nom tronqué) restent.
///
/// « _1 » n'est PAS un suffixe de copie : dans un nom scène le souligné est une espace, et les
/// cinq « _N » mesurés sont des titres (« wig_wam_boom_1 », « _2 », « _4 » ; « skydive_pt_1 »,
/// « _pt_2 »). Le « 2 » final du Finder non plus : « Land 1 » / « Land 2 », « Part 1 » / « Part 2 »
/// sont des titres de la même bibliothèque.
fn strip_dash_one(s: &str) -> Option<&str> {
    let b = s.as_bytes();
    let mut i = b.len();
    if i == 0 || b[i - 1] != b'1' {
        return None;
    }
    i -= 1;
    while i > 0 && b[i - 1] == b'0' {
        i -= 1;
    }
    if i == 0 || b[i - 1] != b'-' {
        return None;
    }
    let head = &s[..i - 1];
    let prev_ok = match head.chars().next_back() {
        Some(')') | Some(']') => true,
        Some(_) => {
            head.chars()
                .rev()
                .take_while(|c| !c.is_whitespace() && *c != '-')
                .filter(|c| c.is_alphabetic())
                .count()
                >= 2
        }
        None => false,
    };
    prev_ok.then_some(head)
}

/// Règle 4. « -7d468690 » en fin de nom : le CRC de release des noms scène (26 cas dans la
/// bibliothèque mesurée), qui empêchait « 02-zwicker_meets_james_teipdeck--homage_to_xy-805453c5 »
/// de rejoindre « 02 - Zwicker Meets James Teipdeck - Homage to XY ». Huit chiffres hexadécimaux
/// exactement, dont au moins un chiffre ET une lettre — un mot (« deadbeef ») ou une date
/// (« 20240101 ») n'en est pas un —, et au moins quatre caractères de nom devant.
fn strip_scene_hash(s: &str) -> Option<&str> {
    let (head, tok) = s.rsplit_once('-')?;
    let is_hash = tok.len() == 8
        && tok.bytes().all(|b| b.is_ascii_hexdigit())
        && tok.bytes().any(|b| b.is_ascii_digit())
        && tok.bytes().any(|b| b.is_ascii_alphabetic());
    let head = head.trim_end_matches('-');
    (is_hash && head.chars().filter(|c| c.is_alphanumeric()).count() >= 4).then_some(head)
}

/// Règle 4. Un jeton de débit ou de format libre en dernier mot (« … Mix) Wav », « … 320kbps »,
/// « … 320 kbps », l'unité emportant son nombre). Seulement en FIN, et jamais un nombre nu :
/// « Point 72 », « Gate 41 », « Ludiomil 75 » sont des titres de la bibliothèque mesurée. Un nom
/// d'un seul mot n'est jamais vidé.
fn strip_trailing_quality_word(s: &str) -> Option<&str> {
    let (head, last) = s.rsplit_once(' ')?;
    let bare = last
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    if !is_format_word(&bare) && !is_bitrate_token(&bare) {
        return None;
    }
    if matches!(bare.as_str(), "kbps" | "kbit" | "kbits" | "khz") {
        if let Some((before, num)) = head.rsplit_once(' ') {
            if !num.is_empty() && num.bytes().all(|b| b.is_ascii_digit()) {
                return Some(before);
            }
        }
    }
    Some(head)
}

/// Règle 5. Retire la tête d'un nom : les références de release (`strip_leading_release_ref`),
/// puis UNE SEULE marque de position (`strip_leading_position`). Ce qui suit la marque de position
/// est le nom et n'est plus touché : « (09) [Telex] I Don't Like Music » garde son artiste entre
/// crochets, « 132.01--A. Jas - Dirty Carnival Music » son artiste à initiale. Les résidus de
/// séparateur sont retirés mot par mot (`trim_residue_tokens`) : un nom qui commence par un
/// tiret collé (« -ism », titre réel du corpus) le garde. Rend le reste, et la marque de position
/// retirée telle qu'écrite.
fn strip_leading_marks(s: &str) -> (&str, Option<&str>) {
    let mut cur = trim_residue_tokens(s);
    loop {
        if let Some(rest) = strip_leading_position(cur) {
            return (rest, Some(&cur[..cur.len() - rest.len()]));
        }
        match strip_leading_release_ref(cur) {
            Some(rest) => cur = trim_residue_tokens(rest),
            None => return (cur, None),
        }
    }
}

/// Règle 5. Une référence de release en tête : tout groupe entre crochets (`[BU 002]`,
/// `[DIS & DAT]`, `[YT2mp3.info]` — 549 pistes de la bibliothèque mesurée, 165 contenus distincts,
/// tous un catalogue, un label ou un site), ou une parenthèse qui porte un chiffre
/// (`(SUR020 - 2001)`, `(spm007]`). Une parenthèse de tête SANS chiffre (`(Lap Dance)`) reste :
/// rien ne dit qu'elle n'est pas le nom.
fn strip_leading_release_ref(s: &str) -> Option<&str> {
    let opener = *s.as_bytes().first()?;
    if opener != b'[' && opener != b'(' {
        return None;
    }
    let close = s.find([')', ']'])?;
    if opener == b'(' && !s[1..close].bytes().any(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(&s[close + 1..])
}

/// Règle 5. Une marque de position en tête : numéro de piste ou code de face, entre parenthèses
/// ou non. Rend le reste, jamais vide — un nom qui n'est QUE sa position (« 01 », « A8 ») garde
/// la marque, et `has_identity` le rejette.
fn strip_leading_position(s: &str) -> Option<&str> {
    strip_paren_position(s)
        .or_else(|| strip_leading_track_number(s))
        .or_else(|| strip_leading_side(s))
}

/// « (09) », « (a1) » : numéro de piste ou code de face entre parenthèses (« (01) Misc. - Dazu »,
/// « (a1) The Persuader - Djurgardsbron »).
fn strip_paren_position(s: &str) -> Option<&str> {
    let body = s.strip_prefix('(')?;
    let close = body.find(')')?;
    let b = &body.as_bytes()[..close];
    let is_number = (1..=3).contains(&b.len()) && b.iter().all(u8::is_ascii_digit);
    let is_side = (2..=3).contains(&b.len())
        && (b'a'..=b'h').contains(&b[0].to_ascii_lowercase())
        && b[1..].iter().all(u8::is_ascii_digit);
    if !is_number && !is_side {
        return None;
    }
    let rest = body[close + 1..].trim_start();
    (!rest.is_empty()).then_some(rest)
}

/// Numéro de piste en tête : 1 à 3 chiffres, éventuellement disque-piste (`1-05`, `2.03`,
/// `01-14`), puis un délimiteur (`01 `, `01. `, `01 - `, `01-`, `01_`, `1.01. `, `132.01--`).
///
/// - Quatre chiffres ne sont jamais un numéro : « 1000 Ohm - Love in Motion » (artiste),
///   « 2003 - Force Feeling » (année), « 0201 - St Germain » (disque+piste collés, laissé tel quel).
/// - Une ESPACE seule ne suffit qu'après deux chiffres (« 01 Awaken Abyss ») ou un disque-piste
///   (« 01-14 Rainforest ») : « 100 Hz - Whisper », « 3 Andromeda », « 4 Hero », « 808 State »
///   commencent par leur artiste. Le prix accepté : un artiste à deux chiffres suivis d'une espace
///   (« 50 Cent ») perd son nombre — de façon cohérente sur toutes ses pistes.
/// - Sans délimiteur, le chiffre fait partie du mot : « 100Hz », « 2Pac ».
/// - Le tiret n'appartient au numéro que collé aux chiffres (`02-maetrik`), suivi d'une espace ou
///   d'un autre tiret (`01 - abduction`), ou dans une course déjà entamée (`132.01--A. Jas`) —
///   règle reprise de `search_terms::strip_leading_track_no` : dans « 10. -ism », il est le titre.
fn strip_leading_track_number(s: &str) -> Option<&str> {
    let b = s.as_bytes();
    let digits = b.iter().take_while(|c| c.is_ascii_digit()).count();
    if !(1..=3).contains(&digits) {
        return None;
    }
    let mut i = digits;
    let mut disc = false;
    if i + 1 < b.len() && matches!(b[i], b'.' | b'-') && b[i + 1].is_ascii_digit() {
        let more = b[i + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if more > 3 {
            return None;
        }
        i += 1 + more;
        disc = true;
    }
    let number_end = i;
    let mut punct = false;
    let mut dash_run = false;
    while i < b.len() {
        match b[i] {
            b' ' => i += 1,
            b'.' | b'_' | b')' => {
                punct = true;
                i += 1;
            }
            b'-' if i == number_end
                || dash_run
                || matches!(b.get(i + 1), None | Some(b' ') | Some(b'-')) =>
            {
                punct = true;
                dash_run = true;
                i += 1;
            }
            _ => break,
        }
    }
    if i == number_end || (!punct && digits != 2 && !disc) {
        return None;
    }
    let rest = &s[i..];
    (!rest.trim().is_empty()).then_some(rest)
}

/// Code de face vinyle en tête : une lettre A à H, suivie de un ou deux chiffres puis d'un
/// délimiteur (« A1 Cirque », « a1-chris_lum », « B2 - Untitled », « C1. The Timewriter »), ou
/// SANS chiffre mais alors suivie de « . », « - » ou « _-_ » (« A. Full Moon », « B - Feel The
/// Music », « A_-_Patrick_Turner »). Sans chiffre, un tiret collé (« H-Foundation », « E-Man ») ou
/// une espace seule (« A Dream Plant », « A Theory ») est le début du nom.
fn strip_leading_side(s: &str) -> Option<&str> {
    let b = s.as_bytes();
    let letter = b.first()?.to_ascii_lowercase();
    if !(b'a'..=b'h').contains(&letter) {
        return None;
    }
    let digits = b[1..]
        .iter()
        .take(2)
        .take_while(|c| c.is_ascii_digit())
        .count();
    let start = 1 + digits;
    let rest = if digits > 0 {
        // Un troisième chiffre n'est pas un délimiteur : « B612 » reste un nom.
        let delim = b[start..]
            .iter()
            .take_while(|c| matches!(c, b' ' | b'.' | b'-' | b'_' | b')' | b':'))
            .count();
        if delim == 0 {
            return None;
        }
        &s[start + delim..]
    } else {
        let tail = &s[start..];
        [". ", " - ", "_-_"]
            .iter()
            .find(|p| tail.starts_with(*p))
            .map(|p| &tail[p.len()..])?
    };
    (!rest.trim().is_empty()).then_some(rest)
}

/// Règle 7, avant `name_key`. Supprime les apostrophes (« Don't » et le « dont » des noms scène
/// sont le même mot ; `name_key` en ferait « don t ») et les accents COMBINANTS U+0300–U+036F
/// (« Thie\u{301}f », mesuré dans la bibliothèque, rejoint « Thief » au lieu de devenir
/// « thie f »), puis replie « å » et « ø », absents de `fold_char` (« Håkan Lidbo » et
/// « Hakan Lidbo » coexistent dans la bibliothèque mesurée). `fold_char` n'est pas étendu ici :
/// il sert aussi l'ancienne clé et les requêtes Discogs.
fn fold_for_group(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\'' | '\u{2019}' | '\u{2018}' | '`' | '\u{00B4}' | '\u{02BC}' => {}
            '\u{0300}'..='\u{036F}' => {}
            'å' | 'Å' => out.push('a'),
            'ø' | 'Ø' => out.push('o'),
            c => out.push(c),
        }
    }
    out
}

/// Vrai si la clé nomme un morceau : au moins deux lettres hors mots génériques
/// (`GROUP_GENERIC_WORDS`) et mots de version (`GROUP_VERSION_WORDS`). « a1 », « 01 », « 1999 »,
/// « untitled a », « track 01 », « 89 original mix » n'en ont pas. Les lettres se comptent sur
/// toute la clé, pas par mot : un sigle à points (« N.F.D. - M.A.S.S. (Mix-1) », mesuré) devient
/// une suite de lettres seules, et nomme pourtant.
fn has_identity(key: &str) -> bool {
    key.split(' ')
        .filter(|w| !GROUP_GENERIC_WORDS.contains(w) && !GROUP_VERSION_WORDS.contains(w))
        .map(|w| w.chars().filter(|c| c.is_alphabetic()).count())
        .sum::<usize>()
        >= 2
}

/// Nombre de mots qui nomment (`is_identity_word`) dans un texte, normalisé comme une clé : le
/// critère du nom faible, pour les tests.
#[cfg(test)]
fn named_word_count(text: &str) -> usize {
    let key = name_key("", &fold_for_group(text));
    key.split(' ').filter(|w| is_identity_word(w)).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors shared/contracts.ts's `Canonical`. Exhaustive destructure (no `..`): fails to
    /// compile if a field is added/removed/renamed on the Rust struct — the forcing function to
    /// also update contracts.ts. Phase 2 — docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md.
    #[test]
    fn canonical_shape_matches_contracts_ts() {
        let v = Canonical {
            artist: String::new(),
            title: String::new(),
            version: None,
            label: None,
            confidence: Confidence::Green,
        };
        let Canonical {
            artist,
            title,
            version,
            label,
            confidence,
        } = v;
        let _ = (artist, title, version, label, confidence);
    }

    #[test]
    fn junk_flags_quality_and_uploader_tokens() {
        assert!(has_junk("Mystery of Love 320kbps"));
        assert!(has_junk("track 01"));
        assert!(has_junk("audio_320"));
        assert!(has_junk("Some Title [DJ Uploader]"));
        assert!(has_junk("FLAC rip"));
        assert!(has_junk("http://site"));
    }

    #[test]
    fn junk_passes_clean_text() {
        assert!(!has_junk("Mystery of Love"));
        assert!(!has_junk("Can You Feel It"));
        assert!(!has_junk("Larry Heard"));
    }

    #[test]
    fn clean_requires_both_fields_and_no_junk() {
        assert!(is_clean("Larry Heard", "Mystery of Love"));
        assert!(!is_clean("", "Mystery of Love")); // empty artist
        assert!(!is_clean("Larry Heard", "   ")); // blank title
        assert!(!is_clean("Larry Heard", "Mystery 320kbps")); // junk title
    }

    #[test]
    fn parses_artist_title_version() {
        let (a, t, v) = parse_filename("Larry Heard - Mystery of Love (Original Mix)").unwrap();
        assert_eq!(a, "Larry Heard");
        assert_eq!(t, "Mystery of Love");
        assert_eq!(v.as_deref(), Some("Original Mix"));
    }

    #[test]
    fn parses_without_version() {
        let (a, t, v) = parse_filename("Chez Damier - Can You Feel It").unwrap();
        assert_eq!(a, "Chez Damier");
        assert_eq!(t, "Can You Feel It");
        assert_eq!(v, None);
    }

    #[test]
    fn rejects_unparseable_or_junky_stem() {
        assert!(parse_filename("01_audio_320").is_none()); // junk + no separator
        assert!(parse_filename("randomgibberish").is_none()); // no " - " separator
    }

    #[test]
    fn both_clean_and_agree_is_green_from_tags() {
        let c = reconcile(
            "Larry Heard",
            "Mystery of Love",
            "Larry Heard - Mystery of Love (Original Mix)",
        );
        assert_eq!(c.artist, "Larry Heard");
        assert_eq!(c.title, "Mystery of Love");
        assert_eq!(c.version.as_deref(), Some("Original Mix")); // version comes from name
        assert_eq!(c.confidence, Confidence::Green);
    }

    #[test]
    fn tags_clean_name_junky_is_green_from_tags() {
        let c = reconcile("Theo Parrish", "Falling Up", "01_audio_320");
        assert_eq!(c.artist, "Theo Parrish");
        assert_eq!(c.title, "Falling Up");
        assert_eq!(c.confidence, Confidence::Green);
    }

    #[test]
    fn name_clean_tags_junky_is_green_from_name() {
        let c = reconcile("", "track 01", "Chez Damier - Can You Feel It");
        assert_eq!(c.artist, "Chez Damier");
        assert_eq!(c.title, "Can You Feel It");
        assert_eq!(c.confidence, Confidence::Green);
    }

    #[test]
    fn both_clean_but_disagree_is_yellow() {
        let c = reconcile(
            "Larry Heard",
            "Mystery of Love",
            "Robert Owens - Bring Down the Walls",
        );
        assert_eq!(c.confidence, Confidence::Yellow);
        assert_eq!(c.artist, "Larry Heard"); // tags shown as the default pick
    }

    #[test]
    fn neither_clean_is_yellow_best_guess() {
        let c = reconcile("", "", "01_audio_320");
        assert_eq!(c.confidence, Confidence::Yellow);
        // best guess: the stem cleaned (track no + "_" + quality token dropped)
        assert_eq!(c.title, "audio");
        assert_eq!(c.artist, "");
    }

    #[test]
    fn clean_stem_tidies_messy_filenames() {
        assert_eq!(
            clean_stem("01_larry_heard_mystery_320"),
            "larry heard mystery"
        );
        assert_eq!(clean_stem("Some Title [DJ Uploader] FLAC"), "Some Title");
        assert_eq!(clean_stem("1979 - something"), "1979 - something"); // 4 digits: not a track no
    }

    #[test]
    fn clean_stem_drops_source_noise_parens_but_keeps_meaningful_ones() {
        assert_eq!(clean_stem("Title (Vinyl Rip)"), "Title");
        assert_eq!(clean_stem("Title (Bootleg)"), "Title");
        // Not source noise — must survive, it's the actual mix name.
        assert_eq!(clean_stem("Title (Original Mix)"), "Title (Original Mix)");
        assert_eq!(clean_stem("Title (feat. Someone)"), "Title (feat. Someone)");
    }

    #[test]
    fn tags_clean_but_stem_junky_still_recovers_version() {
        // Tags are clean (green from tags), but the filename carries an unrelated junk
        // token ("01_" prefix) that used to blow away version extraction entirely because
        // parse_filename requires the WHOLE stem to be clean. The trailing "(Extended Mix)"
        // must survive that — it's what best_track_match needs to pick the right mix.
        let c = reconcile(
            "Theo Parrish",
            "Falling Up",
            "01_Theo Parrish - Falling Up (Extended Mix)",
        );
        assert_eq!(c.artist, "Theo Parrish");
        assert_eq!(c.title, "Falling Up");
        assert_eq!(c.version.as_deref(), Some("Extended Mix"));
        assert_eq!(c.confidence, Confidence::Green);
    }

    /// Issue #65 : ce que `apply_tags` grave (`tag_title`), `reconcile` le relit à l'identique —
    /// quel que soit le nom du fichier. Une version vide ne se vérifie que contre un nom sans
    /// version : le nom de fichier reste une source quand le tag n'en porte pas.
    #[test]
    fn reconcile_est_l_inverse_de_tag_title() {
        let stems_avec = [
            "Larry Heard - Mystery of Love (Original Mix)",
            "01_audio_320",
        ];
        let stems_sans = ["Larry Heard - Mystery of Love", "01_audio_320"];
        for (version, stems) in [
            (Some("Extended Mix"), &stems_avec),
            (Some("Original Mix"), &stems_avec),
            (Some("Dub"), &stems_sans),
            (None, &stems_sans),
        ] {
            for stem in stems.iter() {
                let c = Canonical {
                    artist: "Larry Heard".into(),
                    title: "Mystery of Love".into(),
                    version: version.map(Into::into),
                    label: None,
                    confidence: Confidence::Green,
                };
                let back = reconcile(&c.artist, &tag_title(&c), stem);
                assert_eq!(
                    (back.title.as_str(), back.version.as_deref()),
                    (c.title.as_str(), version),
                    "version {version:?}, nom {stem:?}"
                );
            }
        }
    }

    /// Le fichier réel du rapport d'Antoine, abîmé par l'aller-retour d'avant le correctif : la
    /// parenthèse qui répète la version est retirée à la relecture.
    #[test]
    fn reconcile_repare_une_version_deja_doublee() {
        let c = reconcile(
            "Cherry Bomb",
            "Elastic (Original Mix) (Original-Mix)",
            "Cherry-Bomb---Elastic-(Original-Mix)",
        );
        assert_eq!(c.title, "Elastic");
        assert_eq!(c.version.as_deref(), Some("Original-Mix"));
    }

    /// Relecture #65 : une parenthèse que le nom porte aussi dans son titre n'est pas une version.
    #[test]
    fn reconcile_garde_une_parenthese_de_titre_que_le_nom_porte_aussi() {
        let c = reconcile(
            "Kerri Chandler",
            "Bar A Thym (Part 2)",
            "Kerri Chandler - Bar A Thym (Part 2) (Original Mix)",
        );
        assert_eq!(c.title, "Bar A Thym (Part 2)");
        assert_eq!(c.version.as_deref(), Some("Original Mix"));
        assert_eq!(c.confidence, Confidence::Green);
    }

    /// Relecture #65 : un remixeur dont le nom commence par « Feat » n'est pas un invité.
    #[test]
    fn un_remix_featurecast_est_une_version() {
        let c = reconcile(
            "Stereo MC's",
            "Connected (Featurecast Remix)",
            "Stereo MC's - Connected (Featurecast Remix)",
        );
        assert_eq!(c.title, "Connected");
        assert_eq!(c.version.as_deref(), Some("Featurecast Remix"));
        assert_eq!(c.confidence, Confidence::Green);
    }

    /// « (feat. X) » nomme un invité, pas un mix : il reste dans le titre, et la version vient
    /// toujours du nom de fichier.
    #[test]
    fn reconcile_laisse_le_feat_dans_le_titre() {
        let c = reconcile(
            "Kerri Chandler",
            "Rain (feat. Arnold Jarvis)",
            "Kerri Chandler - Rain (feat. Arnold Jarvis) (Original Mix)",
        );
        assert_eq!(c.title, "Rain (feat. Arnold Jarvis)");
        assert_eq!(c.version.as_deref(), Some("Original Mix"));
        assert_eq!(c.confidence, Confidence::Green);
    }

    #[test]
    fn name_key_collapses_spellings_and_separates_titles() {
        // same track, different spelling/punctuation/case/accents → same key
        assert_eq!(
            name_key("Larry Heard", "Mystery of Love"),
            name_key("larry_heard", "Mystery  of  Love!"),
        );
        assert_eq!(name_key("Béatrice", "Été"), name_key("Beatrice", "Ete"));
        // different titles → different keys
        assert_ne!(
            name_key("Larry Heard", "Mystery of Love"),
            name_key("Larry Heard", "Can You Feel It"),
        );
    }

    #[test]
    fn sanitize_strips_path_unsafe_chars() {
        assert_eq!(sanitize("AC/DC: Back?"), "AC DC Back");
        assert_eq!(sanitize("a   b"), "a b"); // collapse whitespace
    }

    #[test]
    fn renders_with_version() {
        let c = Canonical {
            artist: "Larry Heard".into(),
            title: "Mystery of Love".into(),
            version: Some("Original Mix".into()),
            label: None,
            confidence: Confidence::Green,
        };
        assert_eq!(
            render_filename("{artist} - {title}{version}", &c, "aiff"),
            "Larry Heard - Mystery of Love (Original Mix).aiff"
        );
    }

    #[test]
    fn renders_without_version_no_empty_parens() {
        let c = Canonical {
            artist: "Chez Damier".into(),
            title: "Can You Feel It".into(),
            version: None,
            label: None,
            confidence: Confidence::Green,
        };
        assert_eq!(
            render_filename("{artist} - {title}{version}", &c, "mp3"),
            "Chez Damier - Can You Feel It.mp3"
        );
    }

    // -----------------------------------------------------------------------------------------
    // Clé de groupe v2 et forme d'affichage (écran « Doublons », 2026-10-05). Sauf mention, les
    // radicaux sont des noms RÉELS de la bibliothèque mesurée ce jour-là, à l'octet près.
    // -----------------------------------------------------------------------------------------

    /// Les radicaux donnés ont une clé, et c'est la même.
    fn assert_same_key(stems: &[&str]) {
        let first = group_key(stems[0]);
        assert!(first.is_some(), "clé absente pour {:?}", stems[0]);
        for s in &stems[1..] {
            assert_eq!(group_key(s), first, "{s:?} doit rejoindre {:?}", stems[0]);
        }
    }

    /// Les radicaux donnés ont tous une clé, deux à deux distinctes.
    fn assert_distinct_keys(stems: &[&str]) {
        let keys: Vec<Option<String>> = stems.iter().map(|s| group_key(s)).collect();
        for (i, a) in keys.iter().enumerate() {
            assert!(a.is_some(), "clé absente pour {:?}", stems[i]);
            for (j, b) in keys.iter().enumerate().skip(i + 1) {
                assert_ne!(
                    a, b,
                    "{:?} et {:?} ne doivent PAS se réunir",
                    stems[i], stems[j]
                );
            }
        }
    }

    fn key(s: &str) -> Option<String> {
        Some(s.to_string())
    }

    fn parts(
        a: Option<&str>,
        t: &str,
        v: Option<&str>,
    ) -> (Option<String>, String, Option<String>) {
        (a.map(String::from), t.to_string(), v.map(String::from))
    }

    /// Le format de la clé, que l'appelant peut afficher en diagnostic : les mots du nom nettoyé,
    /// version comprise, en minuscules, séparés d'une espace.
    #[test]
    fn cle_v2_forme_de_la_cle() {
        assert_eq!(
            group_key("Larry Heard - Mystery of Love (Extended Mix)"),
            key("larry heard mystery of love extended mix")
        );
        assert_eq!(
            group_key("Larry Heard - Mystery of Love (Original Mix)"),
            key("larry heard mystery of love")
        );
    }

    /// Casse, accents (précomposés ou COMBINANTS), apostrophes, ponctuation et séparateurs ne
    /// distinguent pas deux noms.
    #[test]
    fn cle_v2_ignore_casse_accents_apostrophes_et_separateurs() {
        assert_same_key(&[
            "Larry Heard - Mystery of Love (Club Mix)",
            "Larry Heard - Mystery of Love (club mix)",
            "larry_heard_-_mystery_of_love_(club_mix)",
        ]);
        // Convention Beatport/Soulseek (issue #66) et tiret demi-cadratin.
        assert_same_key(&[
            "Cherry-Bomb---Elastic-(Original-Mix)",
            "Cherry Bomb - Elastic (Original Mix)",
        ]);
        assert_same_key(&[
            "CJ Art \u{2013} Acedia (Original mix)",
            "CJ Art - Acedia (Original mix)",
        ]);
        // Apostrophe : « Don't » et le « dont » des noms scène sont le même mot (inventé).
        assert_same_key(&[
            "02. Hill & Fun\u{e8}z - Don't Hesitate (Dub Version)",
            "Hill & Funez - Dont Hesitate (Dub Version)",
        ]);
        // Apostrophe typographique contre apostrophe droite : paire réelle.
        assert_same_key(&[
            "2-03. R\u{f6}yksopp - Poor Leno (Silicone Soul's Hypno House Dub)",
            "R\u{f6}yksopp - Poor Leno (Silicone Soul\u{2019}s Hypno House Dub)",
        ]);
        // Accent combinant U+0301 (réel) contre lettre nue.
        assert_same_key(&[
            "05 - Nathaniel Merriweather Presents Lovage - To Catch A Thie\u{301}f",
            "Nathaniel Merriweather Presents Lovage - To Catch A Thief",
        ]);
        // « å » est absent de `fold_char` ; « Håkan » et « Hakan » coexistent dans la bibliothèque.
        assert_same_key(&[
            "02 - H\u{e5}kan Lidbo - Windy City",
            "Hakan Lidbo - Windy City",
        ]);
        // « ø » aussi : la graphie norvégienne du groupe (inventé).
        assert_same_key(&[
            "R\u{f8}yksopp - Eple",
            "R\u{f6}yksopp - Eple",
            "Royksopp - Eple",
        ]);
    }

    /// La version distingue : deux noms qui ne diffèrent QUE par elle sont deux morceaux.
    #[test]
    fn cle_v2_la_version_separe_les_morceaux() {
        assert_distinct_keys(&[
            "Larry Heard - Mystery of Love (Dub)",
            "Larry Heard - Mystery of Love (Club Mix)",
            "Larry Heard - Mystery of Love",
        ]);
        assert_distinct_keys(&[
            "01_infunktuation_-_feel_real_good_(club_version)-idc",
            "02_infunktuation_-_feel_real_good_(dub_version)-idc",
            "03_infunktuation_-_feel_real_good_(obscure_version)-idc",
        ]);
        // Un crochet final porte la version comme une parenthèse, avec ou sans mot de version.
        assert_distinct_keys(&["01 - abduction [original]", "02. Abduction [benonedit]"]);
        assert_distinct_keys(&["03. Sun Of A Gun [benonedit]", "03 - sun of a gun"]);
        assert_distinct_keys(&[
            "Jay Welsh - Weird Noises (Northface 2)",
            "Jay Welsh - Weird Noises (Northface Remix 1)",
        ]);
        assert_distinct_keys(&[
            "Mv - Wait Till Tomorrow (Part 1)",
            "Mv - Wait Till Tomorrow (Part 4)",
        ]);
        // Une version écrite sans parenthèses est la même suite de mots (inventé).
        assert_same_key(&["Artist - Title Club Mix", "Artist - Title (Club Mix)"]);
    }

    /// « Original Mix » et « Original » valent absence de version (mesure de l'intégrateur,
    /// 2026-10-05) — et SEULEMENT elles.
    #[test]
    fn cle_v2_original_mix_vaut_absence_de_version() {
        assert_same_key(&[
            "Freakus - Floating",
            "Freakus - Floating (Original Mix)",
            "Freakus - Floating (original mix)",
            "Freakus - Floating (Original-Mix)",
            "Freakus - Floating (original_mix)",
            "Freakus - Floating (ORIGINAL MIX)",
            "Freakus - Floating (Original)",
            "Freakus - Floating [Original Mix]",
            "Freakus - Floating Original Mix",
            "freakus_-_floating_original_mix",
        ]);
        // Le crochet final « [original] » est la même version par défaut (inventé, d'après
        // « 01 - abduction [original] » du dossier « 2016 - Korsakow - Abduction »).
        assert_same_key(&["Korsakow - Abduction [original]", "Korsakow - Abduction"]);
        // Les paires réelles que l'ancienne clé réunissait et que la version seule aurait séparées.
        assert_same_key(&[
            "Inner Lakes - Amnesia (Original Mix)",
            "Inner Lakes - Amnesia",
        ]);
        assert_same_key(&["AN-2 - Venus (Original Mix)", "An-2 - Venus"]);
        assert_same_key(&[
            "Slippy G - Pixel Waterfall Original Mix-www.groovytunes.org",
            "Slippy G - Pixel Waterfall (Original Mix)",
            "Slippy G - Pixel Waterfall",
        ]);
        // CONTRE-exemples : toute autre version reste distincte de l'absence.
        assert_distinct_keys(&[
            "Freakus - Floating",
            "Freakus - Floating (Extended Mix)",
            "Freakus - Floating (Original Version)",
            "Freakus - Floating (Original Club Mix)",
            "Freakus - Floating (Dub)",
        ]);
        // « original mix » ne tombe qu'en mots entiers (inventé).
        assert_eq!(
            group_key("Artist - Unoriginal Mix"),
            key("artist unoriginal mix")
        );
        // « Original » seul en fin de TITRE peut être le titre (inventé).
        assert_eq!(
            group_key("Artist - The Original"),
            key("artist the original")
        );
    }

    /// Un nom sale garde sa version : l'ancienne clé la gardait déjà, la v2 la garde en nettoyant.
    #[test]
    fn cle_v2_garde_la_version_d_un_nom_sale() {
        assert_same_key(&[
            "01_Theo Parrish - Falling Up (Extended Mix)",
            "Theo Parrish - Falling Up (Extended Mix)",
        ]);
        assert_distinct_keys(&[
            "01_Theo Parrish - Falling Up (Extended Mix)",
            "Theo Parrish - Falling Up",
        ]);
        assert_same_key(&[
            "Laurent Garnier - Crispy Bacon (King Unique Remix)(mp3) ",
            "Laurent Garnier - Crispy Bacon (King Unique Remix)",
        ]);
    }

    /// Le numéro de piste en tête, sous toutes ses formes mesurées.
    #[test]
    fn cle_v2_retire_le_numero_de_piste() {
        assert_same_key(&[
            "Olsvanger - The Triss",
            "01 Olsvanger - The Triss",
            "01. Olsvanger - The Triss",
            "1-Olsvanger - The Triss",
            "01 - Olsvanger - The Triss",
            "01-Olsvanger - The Triss",
            "01_Olsvanger - The Triss",
            "1-05 - Olsvanger - The Triss",
            "2-07. Olsvanger - The Triss",
            "1.01. Olsvanger - The Triss",
            "211. Olsvanger - The Triss",
            "(09) Olsvanger - The Triss",
        ]);
        assert_same_key(&[
            "01-14 Rainforest (Rare electro mix)",
            "Rainforest (Rare electro mix)",
        ]);
        assert_same_key(&["06 Gripen", "6. Gripen"]);
        // Disque.piste suivi d'une espace seule, numéro de disque d'un chiffre (paire réelle).
        assert_same_key(&[
            "2.12 Yann Fontaine - Burning",
            "12 Yann Fontaine - Burning",
            "Yann Fontaine - Burning",
        ]);
    }

    /// CONTRE-exemples : un nombre qui fait partie du nom n'est pas un numéro de piste, et un
    /// nombre dans le titre ne se retire jamais.
    #[test]
    fn cle_v2_garde_les_nombres_du_nom() {
        assert_eq!(
            group_key("1000 Ohm - Love in Motion (instrumental)"),
            key("1000 ohm love in motion instrumental")
        );
        assert_eq!(group_key("100 Hz - Whisper"), key("100 hz whisper"));
        assert_eq!(
            group_key("808 State - Pacific State"),
            key("808 state pacific state")
        ); // inventé
        assert_eq!(
            group_key("4 Pleasure - U Get What U Get (Conga Dub)"),
            key("4 pleasure u get what u get conga dub")
        );
        assert_eq!(
            group_key("100Hz - The Field (Original Mix)"),
            key("100hz the field")
        );
        assert_eq!(
            group_key("2003 - Force Feeling - 01 - Maetrik - Force Feeling"),
            key("2003 force feeling 01 maetrik force feeling")
        );
        assert_eq!(group_key("Dego - Star Track 7"), key("dego star track 7"));
        assert_distinct_keys(&["Swag - 2 + 2 = 5", "Swag - 2 + 2"]);
        assert_distinct_keys(&["Prince - 1999", "Prince - 2000"]); // inventé
                                                                   // Un tiret suivi de quatre chiffres n'est pas un disque-piste (inventé).
        assert_eq!(group_key("1-2345 Main Street"), key("1 2345 main street"));
    }

    /// Le code de face vinyle en tête.
    #[test]
    fn cle_v2_retire_le_code_de_face() {
        assert_same_key(&[
            "Cirque - Swerve (Deep Mix)",
            "B1 Cirque - Swerve (Deep Mix)",
            "B1. Cirque - Swerve (Deep Mix)",
            "b1-Cirque - Swerve (Deep Mix)",
            "B1 - Cirque - Swerve (Deep Mix)",
            "(b1) Cirque - Swerve (Deep Mix)",
        ]);
        assert_same_key(&["A1. Subsound - Universal Sky", "Subsound - Universal Sky"]);
        assert_same_key(&["A. Full Moon (Desert Mix)", "Full Moon (Desert Mix)"]);
        assert_same_key(&["B - Feel The Music (Acid Mix)", "Feel The Music (Acid Mix)"]);
        assert_same_key(&[
            "A_-_Patrick_Turner_-_Buddhatech",
            "Patrick Turner - Buddhatech",
        ]);
        assert_same_key(&["[BR 95004] A1 Baron Noir - Paris", "Baron Noir - Paris"]);
    }

    /// CONTRE-exemples : un début de nom n'est pas une face, une face en TITRE reste, et une
    /// seule marque de position est retirée.
    #[test]
    fn cle_v2_ne_prend_pas_un_debut_de_nom_pour_une_face() {
        assert_eq!(
            group_key("H-Foundation - Soul Searchin'"),
            key("h foundation soul searchin")
        );
        assert_eq!(
            group_key("[12VAC007] A Dream Plant - Carambolage"),
            key("a dream plant carambolage")
        );
        assert_distinct_keys(&[
            "[12TRIX011] Channel Klirr - A1",
            "[12TRIX011] Channel Klirr - A2",
        ]);
        assert_eq!(
            group_key("132.01--A. Jas - Dirty Carnival Music (Original)"),
            key("a jas dirty carnival music")
        );
        // Une face a deux chiffres au plus : « B612 » est un nom (inventé).
        assert_eq!(
            group_key("B612 - Le Petit Prince"),
            key("b612 le petit prince")
        );
    }

    /// Les suffixes de copie : navigateur, Windows, ordinal de téléchargeur, CRC scène.
    #[test]
    fn cle_v2_retire_les_suffixes_de_copie() {
        assert_same_key(&[
            "Demarkus Lewis - U-Too",
            "Demarkus Lewis - U-Too (1)",
            "Demarkus Lewis - U-Too(2)",
            "Demarkus Lewis - U-Too [www.slider.kz] (1)",
        ]);
        assert_same_key(&["Dav - Dreams about me-1", "Dav - Dreams about me"]);
        assert_same_key(&[
            "Presence - I Believe (2022 remaster)-1",
            "Presence - I Believe (2022 remaster)",
        ]);
        assert_same_key(&[
            "Hakan Lidbo - Dimm the Lights-01",
            "Hakan Lidbo - Dimm the Lights",
        ]);
        assert_same_key(&[
            "Dane Jolly - Boomslang (Super Fly's Vision Tool Mix)-001",
            "Dane Jolly - Boomslang (Super Fly's Vision Tool Mix)",
        ]);
        // Explorateur Windows, anglais et français (inventés : aucun dans la bibliothèque).
        assert_same_key(&[
            "Larry Heard - Mystery of Love",
            "Larry Heard - Mystery of Love - Copy",
            "Larry Heard - Mystery of Love - Copie",
            "Larry Heard - Mystery of Love - Copy (2)",
        ]);
        assert_same_key(&[
            "02-zwicker_meets_james_teipdeck--homage_to_xy-805453c5",
            "02 - Zwicker Meets James Teipdeck - Homage to XY",
        ]);
    }

    /// CONTRE-exemples : ce qui ressemble à un suffixe de copie et fait partie du titre.
    #[test]
    fn cle_v2_ne_prend_pas_un_titre_pour_une_copie() {
        // « M-1 » et « M-2 » sont deux titres ; une lettre seule devant le tiret protège.
        assert_distinct_keys(&[
            "Ralph Lawson, Carl Finlow, Wolf n Flow - M-1",
            "Ralph Lawson, Carl Finlow, Wolf n Flow - M-2",
            "Ralph Lawson, Carl Finlow, Wolf n Flow - M",
        ]);
        assert_distinct_keys(&[
            "Cyclo - SunTrust ''Cosmic Evolution EP'' C-1",
            "Cyclo - SunTrust ''Cosmic Evolution EP'' C",
        ]);
        // Seul « -1 » est une copie : « -2 » n'apparaît que dans des titres (inventé ici).
        assert_distinct_keys(&["Random Factor - Lockdown-2", "Random Factor - Lockdown"]);
        // « _N » et « N » final sont des titres.
        assert_distinct_keys(&[
            "03_wig_wam_boom_2",
            "07_wig_wam_boom_4",
            "08_wig_wam_boom_1",
            "wig wam boom",
        ]);
        assert_distinct_keys(&[
            "[BU 002] DJ Gregory - Land 1",
            "[BU 002] DJ Gregory - Land 2",
            "[BU 002] DJ Gregory - Land",
        ]);
        // Question ouverte au rapport : ce « 2 » après la version est peut-être une copie du Finder.
        assert_distinct_keys(&[
            "Loudeast - Mermaid (Duckbeats Vs Mermaid) 2",
            "Loudeast - Mermaid (Duckbeats Vs Mermaid)",
        ]);
        // « Copy » sans « - » devant, ou sans champ devant, est un mot du titre.
        assert_eq!(
            group_key("Aardvarck - Cult Copy"),
            key("aardvarck cult copy")
        );
        assert_eq!(group_key("Artiste - Copy"), key("artiste copy")); // inventé
                                                                      // Une année entre parenthèses peut nommer une version (« Blue Monday 1988 », inventé).
        assert_distinct_keys(&["New Order - Blue Monday (1988)", "New Order - Blue Monday"]);
        // Huit caractères hexadécimaux sans chiffre, ou sans lettre, ne sont pas un CRC (inventés).
        assert_eq!(
            group_key("Artist - Title-deadbeef"),
            key("artist title deadbeef")
        );
        assert_eq!(
            group_key("Artist - Title-20240101"),
            key("artist title 20240101")
        );
    }

    /// Les références de release en tête et les accolades, partout.
    #[test]
    fn cle_v2_retire_references_de_release_et_accolades() {
        assert_same_key(&[
            "[BU 002] DJ Gregory - Freeze",
            "[12 BC-001] DJ Gregory - Freeze",
            "DJ Gregory - Freeze",
        ]);
        // Label SANS chiffre en tête, puis numéro de piste : paire réelle.
        assert_same_key(&[
            "[DIS & DAT] 1. DZ - Jelena (Sava's Mood Mix)",
            "[DIS & DAT] DZ - Jelena (Sava's Mood Mix)",
            "DZ - Jelena (Sava's Mood Mix)",
        ]);
        assert_same_key(&[
            "(spm007] Cle Acklin - My Face (Original Dirty Mix)",
            "Cle Acklin - My Face (Original Dirty Mix)",
        ]);
        assert_same_key(&[
            "01 - DBBD, Miss Bashful - Boyfriendz(Explicit) TIDAL RIP {AudioQuality}",
            "DBBD, Miss Bashful - Boyfriendz(Explicit) TIDAL RIP",
        ]);
    }

    /// CONTRE-exemples : un crochet ou une parenthèse qui peut porter le nom reste.
    #[test]
    fn cle_v2_garde_les_groupes_qui_portent_le_nom() {
        // L'artiste entre crochets APRÈS la marque de position.
        assert_eq!(
            group_key("(09) [Telex] I Don't Like Music [stacey pullen mix]"),
            key("telex i dont like music stacey pullen mix")
        );
        // Une parenthèse de tête sans chiffre.
        assert_eq!(
            group_key("(Lap Dance) B2. Hakan Lidbo - On And On - V"),
            key("lap dance b2 hakan lidbo on and on v")
        );
        // Un catalogue en QUEUE peut être une version : il reste.
        assert_eq!(
            group_key("Samneric - Megaton [SP-13]"),
            key("samneric megaton sp 13")
        );
    }

    /// Les jetons de débit et de format, en groupe ou libres en fin de nom.
    #[test]
    fn cle_v2_retire_debit_et_format() {
        assert_same_key(&[
            "Oris Jay ft. Delsena - Trippin (Original Mix) -  [320 kbps]",
            "Oris Jay ft. Delsena - Trippin (Original Mix)",
        ]);
        assert_same_key(&["Instant - Delusion (320 kbps)", "Instant - Delusion"]);
        assert_same_key(&[
            "Pure Science & Richard Grey - Definition Of Us (320kbps)",
            "Pure Science & Richard Grey - Definition Of Us",
        ]);
        assert_same_key(&[
            "Simon & Shaker As... - Boost( mp3)",
            "Simon & Shaker As... - Boost",
        ]);
        assert_same_key(&[
            "Nic Fanciulli, Blewett - Dockside (Full Strings Mix) Wav",
            "Nic Fanciulli, Blewett - Dockside (Full Strings Mix)",
        ]);
        // Libres en fin de nom (inventés).
        assert_same_key(&["Artist - Title 320kbps", "Artist - Title"]);
        assert_same_key(&["Artist - Title 320 kbps", "Artist - Title"]);
        // Un groupe IMBRIQUÉ dans la version tombe seul (inventés). L'accolade isole la lecture
        // des groupes imbriqués : un débit imbriqué en fin de nom tomberait aussi par le jeton
        // libre de queue, et ne prouverait rien sur elle.
        assert_same_key(&[
            "Artist - Title (Club Mix [320 kbps])",
            "Artist - Title (Club Mix {AudioQuality})",
            "Artist - Title (Club Mix)",
        ]);
    }

    /// CONTRE-exemples : un nombre nu, un mot qui ressemble à un format, une version qui contient
    /// un débit, une année.
    #[test]
    fn cle_v2_garde_nombres_et_faux_formats() {
        assert_eq!(
            group_key("06. Mitja Prinz - Point 72"),
            key("mitja prinz point 72")
        );
        assert_eq!(group_key("Artist - Title 320"), key("artist title 320")); // inventé
        assert_eq!(group_key("Eric Prydz - Opus"), key("eric prydz opus")); // inventé
        assert_eq!(
            group_key("Martha Reeves - Heat Wave"),
            key("martha reeves heat wave")
        );
        assert_eq!(
            group_key("Artist - Title (8 Bit Mix)"),
            key("artist title 8 bit mix")
        );
        assert_eq!(
            group_key("Artist - Title (8 Bit)"),
            key("artist title 8 bit")
        );
        assert_eq!(
            group_key("Artist - Title (MP3 Edit)"),
            key("artist title mp3 edit")
        );
        assert_eq!(group_key("Artist - Title (1991)"), key("artist title 1991"));
        assert_eq!(group_key("Wav"), key("wav")); // un nom d'un seul mot n'est jamais vidé
    }

    /// Les URL, en groupe ou libres, collées ou non, avec ou sans « www. ».
    #[test]
    fn cle_v2_retire_les_url() {
        assert_same_key(&[
            "Deja Vu - Sex In The Dark my-free-mp3s.com ",
            "Deja Vu - Sex In The Dark",
        ]);
        assert_same_key(&[
            "Jandy Rainbow - Liquid Bamboo myfreemp3.vip ",
            "Jandy Rainbow - Liquid Bamboo",
        ]);
        assert_same_key(&[
            "John Dimas - Self Control (Original Mix) www.promo-sound.com",
            "John Dimas - Self Control (Original Mix)",
        ]);
        assert_same_key(&[
            "100Hz - The Field (Original Mix) - www.djsoundtop.com",
            "100Hz - The Field (Original Mix)",
        ]);
        assert_same_key(&[
            "[YT2mp3.info] - DJ Lima & Evanz D - On The Way (320kbps)",
            "DJ Lima & Evanz D - On The Way",
        ]);
        assert_same_key(&[
            "Demarkus Lewis - U-Too [djdownloadme.com]",
            "Demarkus Lewis - U-Too",
        ]);
        // Un groupe de plusieurs mots qui porte une URL tombe en entier, pas seulement l'URL
        // (inventé : les URL en groupe mesurées sont toutes d'un seul mot).
        assert_same_key(&[
            "Demarkus Lewis - U-Too [Free Download www.djsite.com]",
            "Demarkus Lewis - U-Too",
        ]);
    }

    /// CONTRE-exemples : un sigle ou une abréviation à points n'est pas un domaine.
    #[test]
    fn cle_v2_ne_prend_pas_un_sigle_pour_une_url() {
        assert_eq!(
            group_key("11. V.R.Volvox - Tensor"),
            key("v r volvox tensor")
        );
        assert_eq!(
            group_key("[8812449] Spider X Featuring M.L.G. - Jack Attack"),
            key("spider x featuring m l g jack attack")
        );
        assert_eq!(
            group_key("04 - Electro Universe Vol.3D"),
            key("electro universe vol 3d")
        );
        assert_eq!(
            group_key("St.Germain - Rose Rouge"),
            key("st germain rose rouge")
        );
    }

    /// `None` : le nom ne nomme rien. Un tel fichier ne se regroupe pas par le nom.
    #[test]
    fn cle_v2_none_quand_le_nom_ne_nomme_rien() {
        for stem in [
            "",
            "   ",
            "-",
            "01",
            "A8",
            "[DRAGON002] A1",
            "001_Untitled",
            "002_Untitled",
            "B2 - Untitled",
            "2-01 [untitled] (1)",
            "01-Audio Track",
            "Track 01",
            "01 - Track 1",
            "1-01 - Intro",
            "01 89 (Original Mix)",
            "05 - 1983",
            "A1 (Dub)",
            "(1)",
            "{AudioQuality}",
        ] {
            assert_eq!(group_key(stem), None, "{stem:?} ne nomme rien");
        }
        // Avec un artiste, « Track 1 » et « Untitled A » sont des titres.
        assert_eq!(group_key("Artist - Track 1"), key("artist track 1"));
        assert_eq!(
            group_key("[CHAIR-006] Daniel Lui - Untitled A"),
            key("daniel lui untitled a")
        );
        assert_eq!(group_key("Gate 41"), key("gate 41"));
        // Un sigle à points nomme, même fait de lettres seules.
        assert_eq!(
            group_key("[DBR 50108] N.F.D. - M.A.S.S. (Mix-1)"),
            key("n f d m a s s mix 1")
        );
    }

    /// Deux artistes, deux morceaux.
    #[test]
    fn cle_v2_distingue_deux_artistes() {
        assert_distinct_keys(&[
            "Larry Heard - Mystery of Love",
            "Fingers Inc - Mystery of Love",
        ]);
        assert_distinct_keys(&[
            "Haris Laus - Right Information (Wireless Mix)",
            "Haris Custovic - Right Information (Wireless Mix)",
        ]);
    }

    /// Entrées hostiles : la clé tourne sur des noms arbitraires venus du disque, octets
    /// multi-octets aux frontières compris.
    #[test]
    fn cle_v2_totale_et_sans_panique() {
        for s in [
            "",
            "(",
            ")",
            "((((",
            "]]]]",
            "{",
            "}",
            "[",
            "-",
            "---",
            "-1",
            "-01",
            "(1)",
            "()",
            "( - ) - ( - )",
            "01",
            "1-",
            "1.",
            "A1",
            "(a1",
            "\u{e9}-1",
            "\u{dc} (1)",
            "\u{65e5}\u{672c} - 1",
            "\u{2013}\u{2013}",
            "\u{301}",
            "_-_",
            "a_",
            " - Copy",
            "www.",
            ".com",
            "-deadbeef",
            "\u{1F600} - \u{1F600} (\u{1F600})",
        ] {
            let _ = group_key(s);
            let _ = display_parts(s);
        }
    }

    /// Nom propre : `display_parts` rend ce que rend `parse_filename` (à l'espacement près),
    /// vérifié sur chaque nom du corpus réel que le nettoyage ne touche pas.
    #[test]
    fn display_parts_d_un_nom_propre_est_parse_filename() {
        let collapse = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
        let mut checked = 0;
        for c in crate::search_corpus::CASES {
            let Some((a, t, v)) = parse_filename(c.stem) else {
                continue;
            };
            if group_clean(c.stem).0 != collapse(c.stem) || v.as_deref().is_some_and(is_featuring) {
                continue;
            }
            assert_eq!(
                display_parts(c.stem),
                (Some(collapse(&a)), collapse(&t), v.map(|v| collapse(&v))),
                "{:?}",
                c.stem
            );
            checked += 1;
        }
        assert!(
            checked >= 5,
            "trop peu de noms propres vérifiés : {checked}"
        );
        assert_eq!(
            display_parts("Larry Heard - Mystery of Love (Original Mix)"),
            parts(Some("Larry Heard"), "Mystery of Love", Some("Original Mix"))
        );
        // Les trois écarts voulus avec `parse_filename`.
        assert_eq!(
            display_parts("01 Olsvanger - The Triss"),
            parts(Some("Olsvanger"), "The Triss", None)
        );
        assert_eq!(
            display_parts("Dav - Dreams about me-1"),
            parts(Some("Dav"), "Dreams about me", None)
        );
        assert_eq!(
            display_parts("Kerri Chandler - Rain (feat. Arnold Jarvis)"),
            parts(Some("Kerri Chandler"), "Rain (feat. Arnold Jarvis)", None)
        );
    }

    /// Nom sale : le radical nettoyé, découpé quand il porte un séparateur, casse et accents
    /// conservés.
    #[test]
    fn display_parts_d_un_nom_sale() {
        let cases = [
            (
                "01_dj_hal_and_jay_thomas_-_dont_stop_(tony_thomas_remix)",
                parts(
                    Some("dj hal and jay thomas"),
                    "dont stop",
                    Some("tony thomas remix"),
                ),
            ),
            (
                "02-vince_watson-method_of_emotion-7d468690",
                parts(Some("vince watson"), "method of emotion", None),
            ),
            (
                "Cherry-Bomb---Elastic-(Original-Mix)",
                parts(Some("Cherry Bomb"), "Elastic", Some("Original Mix")),
            ),
            (
                "CJ Art \u{2013} Acedia (Original mix) (DIS009) \u{2013} Distants Records",
                parts(
                    Some("CJ Art"),
                    "Acedia (Original mix) (DIS009) - Distants Records",
                    None,
                ),
            ),
            (
                "[YT2mp3.info] - DJ Lima & Evanz D - On The Way (320kbps)",
                parts(Some("DJ Lima & Evanz D"), "On The Way", None),
            ),
            (
                "Balage- High in l.a.-1",
                parts(Some("Balage"), "High in l.a.", None),
            ),
            (
                "01 Give U Love (Deep Mix)",
                parts(None, "Give U Love", Some("Deep Mix")),
            ),
            ("10. -ism", parts(None, "-ism", None)),
            (
                "Haris-Right Information",
                parts(None, "Haris-Right Information", None),
            ),
            (
                "03. Sun Of A Gun [benonedit]",
                parts(None, "Sun Of A Gun [benonedit]", None),
            ),
            (
                "02. Hill & Fun\u{e8}z - Don't Hesitate (Dub Version)",
                parts(
                    Some("Hill & Fun\u{e8}z"),
                    "Don't Hesitate",
                    Some("Dub Version"),
                ),
            ),
            (
                "Laurent Garnier - Crispy Bacon (King Unique Remix)(mp3) ",
                parts(
                    Some("Laurent Garnier"),
                    "Crispy Bacon",
                    Some("King Unique Remix"),
                ),
            ),
            ("[DRAGON002] A1", parts(None, "A1", None)),
            // Une parenthèse qui est tout le nom n'est pas une version.
            ("A1 (Dub)", parts(None, "(Dub)", None)),
            // « _-_ » sépare les champs même quand l'artiste porte son propre tiret (inventé).
            (
                "01_A-ha_-_Take_On_Me",
                parts(Some("A-ha"), "Take On Me", None),
            ),
            // Crochet final : version s'il porte un mot de version, titre sinon.
            (
                "03 Freaky Chakra - Sean Q6 , Out In The Shed [Freaky Chakra Mix]",
                parts(
                    Some("Freaky Chakra"),
                    "Sean Q6 , Out In The Shed",
                    Some("Freaky Chakra Mix"),
                ),
            ),
            (
                "01 - abduction [original]",
                parts(None, "abduction", Some("original")),
            ),
            (
                "B1. Auto Suggestion (Auto Funk Mix) [Little Fluffy Records]",
                parts(
                    None,
                    "Auto Suggestion (Auto Funk Mix) [Little Fluffy Records]",
                    None,
                ),
            ),
            // L'affichage garde « Original Mix » telle quelle : seule la clé l'ignore.
            (
                "Freakus - Floating (Original Mix)",
                parts(Some("Freakus"), "Floating", Some("Original Mix")),
            ),
        ];
        for (stem, want) in cases {
            assert_eq!(display_parts(stem), want, "{stem:?}");
        }
    }

    /// L'invariant demandé : `group_key` est une fonction de ce que `display_parts` rend, une fois
    /// normalisé (`key_of_parts`), hors nom faible — et l'affichage ne retire ni ne réordonne
    /// aucun mot du nom nettoyé : il ne déplace que des séparateurs. Deux noms de même clé peuvent
    /// s'afficher différemment.
    #[test]
    fn group_key_est_une_fonction_de_display_parts() {
        let norm = |s: &str| name_key("", &fold_for_group(s));
        let extra = [
            "01_dj_hal_and_jay_thomas_-_dont_stop_(tony_thomas_remix)",
            "Cherry-Bomb---Elastic-(Original-Mix)",
            "[YT2mp3.info] - DJ Lima & Evanz D - On The Way (320kbps)",
            "Balage- High in l.a.-1",
            "(09) [Telex] I Don't Like Music [stacey pullen mix]",
            "02-zwicker_meets_james_teipdeck--homage_to_xy-805453c5",
            "Kerri Chandler - Rain (feat. Arnold Jarvis) (Original Mix)",
            "[DBR 50108] N.F.D. - M.A.S.S. (Mix-1)",
            "03 Freaky Chakra - Sean Q6 , Out In The Shed [Freaky Chakra Mix]",
            "freakus_-_floating_original_mix",
            "-_-x_-_-",
        ];
        let stems = crate::search_corpus::CASES
            .iter()
            .map(|c| c.stem)
            .chain(extra);
        for stem in stems {
            let (a, t, v) = display_parts(stem);
            let words: Vec<String> = [a.as_deref(), Some(t.as_str()), v.as_deref()]
                .into_iter()
                .flatten()
                .map(norm)
                .filter(|p| !p.is_empty())
                .collect();
            let (cleaned, position) = group_clean(stem);
            assert_eq!(
                words.join(" "),
                norm(&cleaned),
                "l'affichage de {stem:?} a perdu ou déplacé un mot du nom nettoyé"
            );
            let key = group_key(stem);
            assert_eq!(
                key,
                key_of_parts(a.as_deref(), &t, v.as_deref(), position.as_deref()),
                "{stem:?}"
            );
            // Hors nom faible, la position ne compte pas : la clé ne dépend que de l'affichage.
            let named = named_word_count(&format!("{t} {}", v.as_deref().unwrap_or("")));
            if a.is_some() || named >= 2 {
                assert_eq!(
                    key,
                    key_of_parts(a.as_deref(), &t, v.as_deref(), None),
                    "{stem:?}"
                );
            }
        }
        // Deux affichages dont les parts normalisées coïncident portent la même clé…
        let a = "01 - Larry Heard - Mystery Of Love (Club Mix)";
        let b = "larry_heard_-_mystery_of_love_(club_mix)";
        assert_ne!(display_parts(a), display_parts(b));
        assert_eq!(group_key(a), group_key(b));
        // … et une clé ne dépend que des parts affichées, pas du nom dont elles viennent.
        let (pa, pt, pv) = display_parts(a);
        assert_eq!(
            key_of_parts(pa.as_deref(), &pt, pv.as_deref(), None),
            key("larry heard mystery of love club mix")
        );
    }

    /// L'exception documentée à l'invariant : un nom FAIBLE (sans artiste, moins de deux mots qui
    /// nomment) garde sa position dans la clé, que l'affichage ne montre pas.
    #[test]
    fn cle_v2_un_nom_faible_garde_sa_position() {
        // Paire réelle : deux albums, deux morceaux, un même mot.
        assert_eq!(display_parts("22 - Forever").1, "Forever");
        assert_eq!(display_parts("2. Forever (Original Mix)").1, "Forever");
        assert_distinct_keys(&["22 - Forever", "2. Forever (Original Mix)"]);
        assert_eq!(group_key("22 - Forever"), key("22 forever"));
        // Zéros de tête et ponctuation de la position ne comptent pas (paire réelle).
        assert_same_key(&["06 Gripen", "6. Gripen", "(06) Gripen"]);
        // Une face vinyle aussi.
        assert_eq!(group_key("C2-Stepback 2"), key("c2 stepback 2"));
        // Une lettre seule ne nomme pas (réel) ; ni un mot de version ni un mot générique (inventés).
        assert_eq!(group_key("04. Quadi B"), key("4 quadi b"));
        assert_eq!(
            group_key("22 - Forever (Club Mix)"),
            key("22 forever club mix")
        );
        assert_eq!(group_key("05 - Intro Forever"), key("5 intro forever"));
        // Deux mots qui nomment suffisent, version comprise : la position tombe.
        assert_same_key(&[
            "01 Total Recoil (2004 Ol' Tape Remastered)",
            "Total Recoil (2004 Ol' Tape Remastered)",
        ]);
        assert_same_key(&[
            "04 - sun of a gun [benonedit]",
            "03. Sun Of A Gun [benonedit]",
        ]);
        assert_same_key(&[
            "01-14 Rainforest (Rare electro mix)",
            "Rainforest (Rare electro mix)",
        ]);
        // Avec un artiste, un titre d'un mot suffit (inventé).
        assert_same_key(&["22 - Artist - Forever", "Artist - Forever"]);
        // Une face entre parenthèses est une position comme une autre (inventé, d'après
        // « (b2) The Persuader - Kungsbron »).
        assert_eq!(group_key("(b2) Kungsbron"), key("b2 kungsbron"));
        // Une position faite de zéros reste une position (réel).
        assert_eq!(
            group_key("00 b r i c k s q u a d r a v e"),
            key("0 b r i c k s q u a d r a v e")
        );
    }

    /// Les « mots » faits seulement de séparateurs tombent en tête et en queue, jamais un tiret
    /// collé à un mot.
    #[test]
    fn residus_de_separateur_retires_mot_par_mot() {
        assert_eq!(trim_residue_tokens("- - DJ Lima - -"), "DJ Lima");
        assert_eq!(trim_residue_tokens("DJ Lima . ;"), "DJ Lima");
        assert_eq!(trim_residue_tokens("-ism"), "-ism");
        assert_eq!(trim_residue_tokens("- -"), "");
    }

    /// MESURE, hors suite normale : `SIFT_GROUP_KEY_PATHS=<entrée> SIFT_GROUP_KEY_OUT=<sortie>`
    /// puis `cargo test --lib -- --ignored mesure_cle_v2`. Rejoue l'ancienne clé et la clé v2 sur
    /// une liste de chemins réels exportée d'une COPIE de la base (jamais la base elle-même).
    ///
    /// Entrée : UTF-8, une piste par ligne, `statut<TAB>chemin`. Sortie : TSV `statut, chemin,
    /// ancienne clé, clé v2, clé v2 sans la version, artiste, titre, version affichés` (« - » pour
    /// une clé v2 absente).
    ///
    /// L'ancienne clé rejoue `dedup::key_for_path`, privée à `dedup.rs` : les deux mêmes appels
    /// (`parse_filename` puis `name_key`) sur le même radical (`Path::file_stem`). La contribution
    /// d'une règle se mesure en relançant ce test règle neutralisée (mutation temporaire).
    #[test]
    #[ignore]
    fn mesure_cle_v2_sur_une_liste_de_chemins() {
        let (Ok(input), Ok(output)) = (
            std::env::var("SIFT_GROUP_KEY_PATHS"),
            std::env::var("SIFT_GROUP_KEY_OUT"),
        ) else {
            println!("SIFT_GROUP_KEY_PATHS / SIFT_GROUP_KEY_OUT absents : rien à mesurer");
            return;
        };
        let text = std::fs::read_to_string(&input).expect("liste de chemins lisible");
        let mut out = String::new();
        for line in text.lines() {
            let (status, path) = line.split_once('\t').expect("statut<TAB>chemin");
            let stem = std::path::Path::new(path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let old = match parse_filename(stem) {
                Some((a, t, _)) => name_key(&a, &t),
                None => name_key("", stem),
            };
            let new = group_key(stem);
            let (cleaned, position) = group_clean(stem);
            let (artist, title, version) = split_display(&cleaned);
            let base = key_of_parts(artist.as_deref(), &title, None, position.as_deref());
            out.push_str(&format!(
                "{status}\t{path}\t{old}\t{}\t{}\t{}\t{title}\t{}\n",
                new.as_deref().unwrap_or("-"),
                base.as_deref().unwrap_or("-"),
                artist.as_deref().unwrap_or(""),
                version.as_deref().unwrap_or(""),
            ));
        }
        std::fs::write(&output, out).expect("sortie écrite");
    }
}
