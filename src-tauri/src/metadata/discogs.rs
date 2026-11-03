//! Discogs implementation of MetadataProvider. The HTTP call (`search`) is a thin wrapper over
//! `ureq`; the response→Candidate mapping (`parse_search`) is pure and unit-tested via a
//! captured fixture, so the matching logic is covered without any network access.
use crate::metadata::{Candidate, MetadataProvider, ProviderError, Query};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

const USER_AGENT: &str = concat!("Sift/", env!("CARGO_PKG_VERSION"));

/// Per-request timeout: a stalled Discogs connection must never hang the IPC thread (which is
/// where `identify` runs). ureq has no read timeout by default, so we set one explicitly.
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

/// Plafond de lecture des réponses JSON. `read_json` sans configuration lit sans borne : une
/// réponse anormalement grosse — API compromise, intermédiaire hostile, ou simple changement de
/// format côté Discogs — se désérialiserait entièrement en mémoire avant qu'on puisse en juger.
/// `cover.rs` cape déjà ses téléchargements d'image ; les deux endpoints JSON ne l'étaient pas.
///
/// 2 Mo est deux ordres de grandeur au-dessus du réel observé (une recherche rend 6 résultats, une
/// release une tracklist) : le plafond n'est pas un réglage de performance, c'est une borne de
/// sûreté qui ne doit jamais être atteinte en fonctionnement normal.
const JSON_BODY_LIMIT: u64 = 2 * 1024 * 1024;

/// How many top candidates get a tracklist look-up (one HTTP call each) to find the matching
/// mix. Bounded to stay well under Discogs' 60 req/min while covering the realistic best hits.
const TRACKLIST_PROBE: usize = 6;

/// Idem pour un essai DÉGRADÉ de la cascade. Volontairement bas : sans ce plafond, une cascade à
/// trois marches multiplierait par trois le trafic de sondage, alors qu'un essai dégradé est par
/// construction moins susceptible d'être le bon. Budget total au pire : 1+6 puis 2×(1+2) = 13
/// requêtes par clic, contre 14 pour l'ancien schéma principal+repli — strictement mieux.
const TRACKLIST_PROBE_DEGRADED: usize = 2;

/// Nombre maximal d'essais réellement exécutés, quelle que soit la longueur de la cascade fournie.
/// La borne est un plafond de DÉBIT, pas une opinion sur la qualité des essais suivants.
const LADDER_MAX_ATTEMPTS: usize = 3;

/// Map a ureq error to our typed ProviderError. Shared by every Discogs HTTP call so a 429
/// (with Retry-After), a non-2xx status, and a transport failure are classified consistently.
fn map_ureq_err(e: ureq::Error) -> ProviderError {
    match e {
        ureq::Error::StatusCode(429) => ProviderError::RateLimited { retry_after_s: 60 },
        // Impasse A10 (issue #15) : 401 et 403 tombaient dans `Network` avec le reste, et l'écran
        // envoyait l'utilisateur vérifier sa connexion pour un jeton refusé. Discogs rend 401 pour
        // un jeton invalide et 403 pour un jeton valide mais sans le droit demandé ; les deux sont
        // des cas d'authentification, aucun ne se résout en réessayant.
        ureq::Error::StatusCode(code @ (401 | 403)) => {
            ProviderError::BadToken(format!("HTTP {code}"))
        }
        ureq::Error::StatusCode(code) => ProviderError::Network(format!("HTTP {code}")),
        other => ProviderError::Network(other.to_string()),
    }
}

pub struct Discogs {
    pub token: String,
}

/// Discogs "title" is `"Artist - Title"`. Split on the first " - "; if absent, the whole
/// string is the title and the artist is empty. The artist is cleaned of Discogs artifacts.
fn split_title(s: &str) -> (String, String) {
    match s.find(" - ") {
        Some(i) => (clean_artist(s[..i].trim()), s[i + 3..].trim().to_string()),
        None => (String::new(), s.trim().to_string()),
    }
}

/// Strip Discogs catalog artifacts from an artist credit that never belong in a real name:
/// the ANV asterisk ("Larry Heard*") and the numeric disambiguation suffix ("Aya (2)").
/// Parenthetical groups that aren't pure digits (e.g. "(Live)") are left untouched.
fn clean_artist(s: &str) -> String {
    let mut result: String = s.chars().filter(|&c| c != '*').collect();
    loop {
        let cut = result.find('(').and_then(|open| {
            result[open..].find(')').and_then(|rel| {
                let close = open + rel;
                let inner = &result[open + 1..close];
                if !inner.is_empty() && inner.chars().all(|c| c.is_ascii_digit()) {
                    Some((open, close))
                } else {
                    None
                }
            })
        });
        match cut {
            Some((open, close)) => result.replace_range(open..=close, ""),
            None => break,
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Turn one search attempt into the words Discogs should receive: every punctuation character
/// becomes a space. Kept: letters, digits, the dot and the apostrophe. Dropped: a word left with
/// no letter or digit, and the boolean keywords AND / OR / NOT (whole words only).
///
/// MEASURED on the public API, 2026-09-23 (issue #66) — this replaced a deliberately conservative
/// version that only neutralized `:`, `"` and the booleans, and kept hyphens and parens "on an
/// unconfirmed API behavior". The behavior is now confirmed:
///   - a word PREFIXED with `-` is IGNORED by Discogs, neither required nor excluded. A query that
///     finds release 31838 still finds it with `-Eclipse` (a word it contains) and with
///     `-Zzyzxqq` (a word nothing contains); `-Elastic` alone returns the whole database. That is
///     how « Cherry-Bomb---Elastic-(Original-Mix) » lost its only distinctive word ;
///   - flattening costs nothing: `Cherry-Bomb Elastic` and `Cherry Bomb Elastic` return the same
///     3 results; `AC/DC Back In Black` 2 954 against `AC DC Back In Black` 4 556, same #1;
///     parens, `&`, a comma: identical counts ;
///   - the DOT is the exception, and why it stays: `D.J. Koze Amygdala` → 15 results, right #1;
///     `D J Koze Amygdala` → 1 result, wrong #1. An acronym split into letters is lost ;
///   - the apostrophe stays for the same reason (`Eric's` is one word, not `Eric` + `s`).
///
/// Outside ASCII, only KNOWN punctuation flattens (`is_query_punctuation`): a first version
/// flattened every non-alphanumeric character, and a combining mark is not alphanumeric — an NFD
/// « Kölsch » (filename from a Mac volume) became « Ko lsch », a Hindi virama or a Thai tone mark
/// split the word (relecture #66). A non-ASCII character is kept unless it is listed.
fn sanitize_discogs_query(s: &str) -> String {
    let flat: String = s
        .chars()
        .map(|c| if is_query_punctuation(c) { ' ' } else { c })
        .collect();
    flat.split_whitespace()
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .filter(|w| !matches!(w.to_uppercase().as_str(), "AND" | "OR" | "NOT"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Punctuation for `sanitize_discogs_query`. ASCII: anything but a letter, a digit, whitespace, the
/// dot and the apostrophe. Beyond: Latin-1 punctuation and symbols (not `ª` `µ` `º`), `×` `÷`, the
/// General Punctuation block except `’` (U+2019, an apostrophe), CJK and full-width punctuation.
fn is_query_punctuation(c: char) -> bool {
    if c.is_ascii() {
        return !(c.is_ascii_alphanumeric() || c.is_ascii_whitespace() || matches!(c, '.' | '\''));
    }
    matches!(
        c,
        '\u{00A0}'..='\u{00A9}'
            | '\u{00AB}'..='\u{00B4}'
            | '\u{00B6}'..='\u{00B9}'
            | '\u{00BB}'..='\u{00BF}'
            | '\u{00D7}'
            | '\u{00F7}'
            | '\u{2000}'..='\u{2018}'
            | '\u{201A}'..='\u{206F}'
            | '\u{3000}'..='\u{3004}'
            | '\u{3008}'..='\u{3011}'
            | '\u{3014}'..='\u{301F}'
            | '\u{FF01}'..='\u{FF0F}'
            | '\u{FF1A}'..='\u{FF20}'
            | '\u{FF3B}'..='\u{FF40}'
            | '\u{FF5B}'..='\u{FF65}'
    )
}

fn first_string(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .and_then(|a| a.first())
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn string_array(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Map a Discogs search response into ranked Candidates. Pure: no I/O. Results with an empty
/// title are dropped; provider order is preserved.
pub fn parse_search(v: &Value) -> Vec<Candidate> {
    let Some(results) = v.get("results").and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for r in results {
        let raw_title = r.get("title").and_then(|x| x.as_str()).unwrap_or("").trim();
        if raw_title.is_empty() {
            continue;
        }
        let (artist, title) = split_title(raw_title);
        let format = {
            let parts = string_array(r, "format");
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(", "))
            }
        };
        let year = r
            .get("year")
            .and_then(|x| x.as_str())
            .and_then(|s| s.parse::<i64>().ok());
        out.push(Candidate {
            artist,
            title,
            label: first_string(r, "label"),
            year,
            styles: string_array(r, "style"),
            country: r
                .get("country")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
            format,
            cover_url: r
                .get("cover_image")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
            release_id: r.get("id").map(|x| x.to_string()).unwrap_or_default(),
            source: "discogs".into(),
        });
    }
    // Prefer the original release over compilations / DJ-mixes: Discogs' own ranking sometimes
    // puts a "Mixed"/"Compilation" CD above the actual single/12". Stable sort by a format-based
    // relevance keeps Discogs order within ties, so the best match is the real release; the rest
    // stay available under "autres".
    out.sort_by_key(|b| std::cmp::Reverse(format_relevance(b)));
    out
}

/// Heuristic relevance from the Discogs `format` descriptors: penalize compilations / mixes,
/// reward singles/EPs and physical vinyl. Higher is more likely the original release.
fn format_relevance(c: &Candidate) -> i32 {
    let mut score = 0;
    let fmt = c.format.as_deref().unwrap_or("");
    for tok in fmt.split(',').map(|t| t.trim().to_lowercase()) {
        match tok.as_str() {
            "compilation" | "mixed" | "dj mix" => score -= 3,
            "single" | "ep" | "maxi-single" => score += 2,
            "vinyl" | "12\"" | "7\"" | "10\"" => score += 1,
            _ => {}
        }
    }
    score
}

/// Lowercased alphanumeric tokens of `s` (punctuation/parens become separators). Used to
/// compare a Discogs tracklist title against the track we're identifying.
fn norm_tokens(s: &str) -> Vec<String> {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(|t| t.to_string())
        .collect()
}

/// Une entrée de tracklist Discogs : le titre, et la durée quand la release la donne.
#[derive(Debug, Clone, PartialEq)]
struct TracklistEntry {
    title: String,
    duration_s: Option<f64>,
}

/// Durée d'une piste Discogs, `"6:12"` ou `"1:02:30"`, en secondes. Discogs rend `""` quand la
/// durée n'est pas saisie — fréquent sur les vinyles : `None`, jamais `0`, sinon une piste sans
/// durée serait pénalisée comme une piste de durée nulle.
fn parse_discogs_duration(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let mut total: u64 = 0;
    for part in s.split(':') {
        let n: u64 = part.trim().parse().ok()?;
        total = total.checked_mul(60)?.checked_add(n)?;
    }
    if total == 0 {
        return None;
    }
    Some(total as f64)
}

/// Le `tracklist` d'un corps `/releases/{id}`, titre et durée. Partie PURE de `fetch_tracklist`.
fn parse_tracklist(v: &Value) -> Vec<TracklistEntry> {
    v.get("tracklist")
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|t| {
                    let title = t.get("title").and_then(|x| x.as_str())?;
                    let duration_s = t
                        .get("duration")
                        .and_then(|x| x.as_str())
                        .and_then(parse_discogs_duration);
                    Some(TracklistEntry {
                        title: title.to_string(),
                        duration_s,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Écart en deçà duquel deux durées désignent le même enregistrement : un rip de vinyle ou un
/// encodage décale de quelques secondes (silence de tête, fin de sillon), pas davantage.
const DURATION_SAME_S: f64 = 3.0;
/// Bonus de la durée au score de tracklist. Valeur du design T5 (§ 7).
const DURATION_WEIGHT: i32 = 3;

/// Contribution de la durée au score d'une entrée de tracklist. Nulle dès qu'une des deux durées
/// manque : l'absence ne départage rien, elle ne doit ni aider ni nuire.
///
/// **Un bonus, jamais une pénalité.** Le design prévoyait aussi −3 au-delà de 15 s d'écart.
/// Mesuré le 2026-11-03 sur 75 pistes identifiées dont Discogs donne la durée : 64 % à ≤ 3 s, mais
/// 18,7 % de BONNES pistes à plus de 15 s (fichier tronqué, autre edit, durée Discogs fausse).
/// Sur un titre nu court, −3 passait le score sous zéro et effaçait le match juste — six sur 75.
/// Aucun autre mix de la même release ne tombait à ≤ 3 s du fichier (0 sur 31) : le bonus seul
/// garde la séparation sans rien coûter par rapport à avant T5.
fn duration_score(track_s: Option<f64>, target_s: Option<f64>) -> i32 {
    let (Some(a), Some(b)) = (track_s, target_s) else {
        return 0;
    };
    if !(a.is_finite() && b.is_finite() && a > 0.0 && b > 0.0) {
        return 0;
    }
    let gap = (a - b).abs();
    if gap <= DURATION_SAME_S {
        DURATION_WEIGHT
    } else {
        0
    }
}

/// How well a Discogs tracklist title matches the track we want. The version (remix/dub)
/// tokens are weighted heavily — they're what distinguishes one mix from another, so a
/// tracklist entry that actually contains the mix name wins decisively over a plain title.
///
/// La durée (T5) départage deux mixes que les mots confondent, mais seulement APRÈS le portail
/// des mots distinctifs : une durée égale ne fait jamais d'une piste sans rapport un candidat.
fn track_match_score(
    track_title: &str,
    track_duration_s: Option<f64>,
    target_title: &str,
    target_version: Option<&str>,
    target_duration_s: Option<f64>,
) -> i32 {
    let track: HashSet<String> = norm_tokens(track_title).into_iter().collect();

    // Everything the caller actually asked for (title + version) — used to tell wanted version
    // keywords from unwanted ones.
    let mut requested: HashSet<String> = norm_tokens(target_title).into_iter().collect();
    if let Some(v) = target_version {
        requested.extend(norm_tokens(v));
    }

    // A tracklist entry must share at least one DISTINCTIVE title word — one that is not also a
    // version word — before its version words count. Without this, a search for « Elastic
    // (Original Mix) » scored « Cherry Bomb (Original Mix) » at 8 on « original » + « mix » alone,
    // stopped the cascade, and offered the wrong track (issue #66, measured on the live API).
    let version_tokens: HashSet<String> = target_version
        .map(norm_tokens)
        .unwrap_or_default()
        .into_iter()
        .collect();
    let title_tokens = norm_tokens(target_title);
    let distinctive: Vec<&String> = title_tokens
        .iter()
        .filter(|t| !version_tokens.contains(*t))
        .collect();
    let distinctive = if distinctive.is_empty() {
        title_tokens.iter().collect()
    } else {
        distinctive
    };
    if !distinctive.iter().any(|t| track.contains(*t)) {
        return 0;
    }

    let mut score = 0;
    for t in &title_tokens {
        if track.contains(t) {
            score += 1;
        }
    }
    if let Some(v) = target_version {
        for t in norm_tokens(v) {
            if track.contains(&t) {
                score += 3;
            }
        }
    }
    // Penalize a tracklist entry that carries a version keyword the caller did NOT ask for: a
    // remix/dub/edit when we wanted the original should lose to the plain title, which otherwise
    // ties on title tokens (this is the "remix picked instead of original" bug).
    for t in &track {
        if is_version_keyword(t) && !requested.contains(t) {
            score -= 2;
        }
    }
    score + duration_score(track_duration_s, target_duration_s)
}

/// Tokens that mark an alternate take (remix, dub, edit…) or a stripped DJ tool (beats, tool,
/// instrumental, acapella). A bare "mix"/"original" is NOT here: "Original Mix" is the canonical
/// version and must not be penalized. Tools like "(Beats)" must be, so they never get forced as
/// the default pick when the local file asked for no particular version.
fn is_version_keyword(t: &str) -> bool {
    matches!(
        t,
        "remix"
            | "rmx"
            | "dub"
            | "redub"
            | "edit"
            | "reedit"
            | "rework"
            | "vip"
            | "bootleg"
            | "instrumental"
            | "acapella"
            | "acappella"
            | "version"
            | "reprise"
            | "remaster"
            | "remastered"
            | "beats"
            | "tool"
    )
}

/// Best tracklist match for the target: the highest `track_match_score`, plus the matching
/// track title when the score is positive. Used to (a) rank the release and (b) replace the
/// release/EP title Discogs returns in search results with the actual TRACK title.
fn best_track_match(
    tracks: &[TracklistEntry],
    target_title: &str,
    target_version: Option<&str>,
    target_duration_s: Option<f64>,
) -> (i32, Option<String>) {
    // Keep the FIRST maximum on ties (replace only on a strictly higher score). Discogs lists the
    // original/main mix first, so when several mixes tie this prefers it over a later alternate —
    // far better than max_by_key's last-wins, which forced an arbitrary mix.
    let mut best: Option<(i32, &String)> = None;
    for t in tracks {
        let s = track_match_score(
            &t.title,
            t.duration_s,
            target_title,
            target_version,
            target_duration_s,
        );
        if best.map_or(true, |(bs, _)| s > bs) {
            best = Some((s, &t.title));
        }
    }
    match best {
        Some((score, t)) if score > 0 => (score, Some(t.clone())),
        Some((score, _)) => (score, None),
        None => (0, None),
    }
}

/// Re-rank candidates by their tracklist match score (primary), falling back to format
/// relevance (secondary) and the original order (stable). `scores[i]` is the best tracklist
/// match for `cands[i]` (0 when no tracklist was fetched or nothing matched).
fn rank_by_match(cands: Vec<Candidate>, scores: &[i32]) -> Vec<Candidate> {
    let mut idx: Vec<usize> = (0..cands.len()).collect();
    idx.sort_by(|&a, &b| {
        scores[b]
            .cmp(&scores[a])
            .then_with(|| format_relevance(&cands[b]).cmp(&format_relevance(&cands[a])))
    });
    idx.into_iter().map(|i| cands[i].clone()).collect()
}

impl Discogs {
    /// Demande à Discogs si ce jeton est accepté, sans rien chercher d'utile.
    ///
    /// Impasse A11 de l'issue #15 : jusqu'ici, enregistrer un jeton disait « Jeton enregistré. »,
    /// ce qui est exact et ne dit rien de sa validité — un jeton faux ne se découvrait qu'au
    /// premier Identifier, plus tard et dans un autre écran.
    ///
    /// **Pourquoi la recherche et pas `/oauth/identity`**, qui serait l'endpoint attendu : celui-ci
    /// n'a jamais été appelé par ce code, et sa forme de réponse comme son comportement sur un
    /// jeton personnel ne sont pas vérifiés ici. La recherche est le chemin déjà éprouvé en
    /// production, avec la MÊME en-tête d'autorisation et le MÊME mappage d'erreurs — dont le
    /// 401/403 vers `BadToken`, qui est toute la question posée. Le coût est une requête comptée
    /// dans le quota, sur un bouton actionné à la main.
    ///
    /// `per_page=1` parce que le corps ne sert à rien : seul le code HTTP est lu.
    pub fn verify_token(&self) -> Result<(), ProviderError> {
        if self.token.trim().is_empty() {
            // Fail fast, et la garde est porteuse — MESURÉE le 2026-08-18 en la retirant : l'appel
            // rend alors `Ok(())` sur un jeton vide, parce que la recherche Discogs répond 200
            // sans en-tête d'autorisation. Sans cette ligne, un champ vide s'annoncerait « accepté ».
            return Err(ProviderError::BadToken("jeton vide".into()));
        }
        ureq::get("https://api.discogs.com/database/search")
            .config()
            .timeout_global(Some(HTTP_TIMEOUT))
            .build()
            .header("User-Agent", USER_AGENT)
            .header("Authorization", &format!("Discogs token={}", self.token))
            .query("type", "release")
            .query("q", "a")
            .query("per_page", "1")
            .call()
            .map_err(map_ureq_err)?;
        Ok(())
    }

    /// One Discogs full-text release search for `q_str`, mapped to ranked Candidates. The HTTP
    /// call is factored out so `search` can issue one query per rung of the `attempts_for`
    /// ladder, each scored the same way.
    fn search_query(&self, q_str: &str) -> Result<Vec<Candidate>, ProviderError> {
        let mut resp = ureq::get("https://api.discogs.com/database/search")
            .config()
            .timeout_global(Some(HTTP_TIMEOUT))
            .build()
            .header("User-Agent", USER_AGENT)
            .header("Authorization", &format!("Discogs token={}", self.token))
            .query("type", "release")
            .query("q", q_str)
            .query("per_page", "6")
            .call()
            .map_err(map_ureq_err)?;
        let v: Value = resp
            .body_mut()
            .with_config()
            .limit(JSON_BODY_LIMIT)
            .read_json()
            .map_err(|e| ProviderError::Parse(e.to_string()))?;
        Ok(parse_search(&v))
    }

    /// Construit la liste des requêtes à tenter, plafonnée à `LADDER_MAX_ATTEMPTS`.
    ///
    /// Rétro-compatible : un `Query` sans cascade (tests, appelants historiques) retombe sur
    /// l'unique `"{artist} {title}"` d'origine, de sorte que brancher la cascade ne change rien
    /// pour qui ne la fournit pas.
    pub(crate) fn attempts_for(&self, q: &Query) -> Vec<String> {
        let source: Vec<String> = if q.attempts.is_empty() {
            vec![format!("{} {}", q.artist, q.title)]
        } else {
            q.attempts.clone()
        };
        // Two attempts carrying the same WORDS are the same search, whatever their punctuation or
        // order: « Cherry Bomb Elastic » and « Cherry-Bomb Elastic » used to take two of the three
        // places (issue #66). Compare the sorted word lists, not the strings.
        let words = |s: &str| {
            let mut w = norm_tokens(s);
            w.sort();
            w
        };
        let mut out: Vec<String> = Vec::new();
        for a in source {
            let s = sanitize_discogs_query(a.trim());
            if s.trim().is_empty() || out.iter().any(|p| words(p) == words(&s)) {
                continue;
            }
            out.push(s);
            if out.len() == LADDER_MAX_ATTEMPTS {
                break;
            }
        }
        out
    }

    /// Fetch tracklists for the top `max_probe` candidates and score how well each contains the
    /// exact mix (title + version) we want, mutating each candidate's `.title` to the actual
    /// matching track title when found. `search` passes `TRACKLIST_PROBE` on the first rung of the
    /// ladder and `TRACKLIST_PROBE_DEGRADED` on the later ones. Detail calls are best-effort — a
    /// failed or rate-limited one just leaves that candidate unscored (falls back to format
    /// relevance). Factored out of `search` so every rung is scored the same way and the rungs
    /// stay comparable.
    fn probe_and_score(&self, cands: &mut [Candidate], q: &Query, max_probe: usize) -> Vec<i32> {
        let mut scores = vec![0i32; cands.len()];
        let probe = cands.len().min(max_probe);
        for i in 0..probe {
            if cands[i].release_id.is_empty() {
                continue;
            }
            match self.fetch_tracklist(&cands[i].release_id) {
                Ok(tracks) => {
                    let (score, matched) =
                        best_track_match(&tracks, &q.title, q.version.as_deref(), q.duration_s);
                    scores[i] = score;
                    // Discogs search returns the RELEASE title ("Artist - Space EP"); replace it
                    // with the actual matching track title so we identify the track, not the EP.
                    if let Some(track_title) = matched {
                        cands[i].title = track_title;
                    }
                }
                Err(ProviderError::RateLimited { .. }) => {
                    log::warn!(
                        "Discogs tracklist rate-limited; ranking falls back to format relevance"
                    );
                }
                Err(_) => {}
            }
        }
        scores
    }

    /// Fetch a release's tracklist (titles and durations). Best-effort: the caller treats Err as
    /// "no tracklist" and simply doesn't refine that candidate (so a rate-limit on a detail call is
    /// non-fatal).
    fn fetch_tracklist(&self, release_id: &str) -> Result<Vec<TracklistEntry>, ProviderError> {
        let url = format!("https://api.discogs.com/releases/{release_id}");
        let mut resp = ureq::get(&url)
            .config()
            .timeout_global(Some(HTTP_TIMEOUT))
            .build()
            .header("User-Agent", USER_AGENT)
            .header("Authorization", &format!("Discogs token={}", self.token))
            .call()
            .map_err(map_ureq_err)?;
        let v: Value = resp
            .body_mut()
            .with_config()
            .limit(JSON_BODY_LIMIT)
            .read_json()
            .map_err(|e| ProviderError::Parse(e.to_string()))?;
        Ok(parse_tracklist(&v))
    }
}

impl MetadataProvider for Discogs {
    fn search(&self, q: &Query) -> Result<Vec<Candidate>, ProviderError> {
        if self.token.trim().is_empty() {
            return Err(ProviderError::NoToken);
        }
        // Use the general full-text query ("artist title") rather than the strict
        // artist+track filters: Discogs' `track` filter matches a release's tracklist and is
        // unreliable (combined with `artist` it often returns nothing even on an exact title).
        // `q` makes the title actually count and is far more forgiving.
        // La cascade remplace l'ancien couple « requête principale + un repli titre-seul gardé sur
        // un artiste non vide ». Cette garde excluait EXACTEMENT la population qui en avait le plus
        // besoin : les noms les plus sales sont ceux dont l'artiste ne peut pas être extrait, et ce
        // sont eux qui n'avaient droit à aucune seconde chance. Mesuré le 2026-07-28 : ~1 100 pistes
        // sur 2 714 dans ce cas. Voir docs/superpowers/changes/2026-07-28-discogs-dirty-names/.
        let attempts = self.attempts_for(q);
        if attempts.is_empty() {
            return Ok(Vec::new());
        }

        let mut best: Option<(Vec<Candidate>, Vec<i32>, i32)> = None;
        for (rank, attempt) in attempts.iter().enumerate() {
            // Budget réseau : seul le premier essai sonde `TRACKLIST_PROBE` tracklists. Les essais
            // dégradés en sondent `TRACKLIST_PROBE_DEGRADED`, sinon une cascade à trois marches
            // triplerait le trafic. Pire cas total : 1+6 puis 2×(1+2) = 13 requêtes, soit moins que
            // les 14 de l'ancien schéma principal+repli.
            let probe = if rank == 0 {
                TRACKLIST_PROBE
            } else {
                TRACKLIST_PROBE_DEGRADED
            };
            log::info!("Discogs search [{rank}] q={attempt:?}");
            // Le `?` d'origine jetait TOUT le meilleur essai déjà accumulé dès qu'une marche de la
            // cascade échouait sur le réseau. Or les marches sont indépendantes : si le premier
            // essai a ramené des candidats et que le deuxième tombe sur un timeout, rendre les
            // premiers vaut infiniment mieux que rendre une erreur. On sort de la cascade et on
            // laisse le `match best` final répondre — l'échec n'est pas avalé, il est loggé.
            let mut cands = match self.search_query(attempt) {
                Ok(c) => c,
                Err(e) => {
                    // On ne quitte la cascade que si un essai précédent a réellement ramené des
                    // candidats. `best.is_some()` ne suffit PAS : un rang 0 qui réussit sans rien
                    // trouver pose `Some((vec![], …))`, et c'est le cas DOMINANT — toute la raison
                    // d'être des essais dégradés. Sortir là convertirait une panne réseau en
                    // « aucune correspondance », deux états que le front distingue vraiment
                    // (`filing-identify.ts` : « Discogs injoignable » / « limite le débit »,
                    // à réessayer, contre « Aucune correspondance », terminal).
                    let have_candidates = best.as_ref().is_some_and(|(c, _, _)| !c.is_empty());
                    if !have_candidates {
                        return Err(e);
                    }
                    log::warn!(
                        "Discogs search [{rank}] q={attempt:?} a échoué, arrêt de la cascade sur les candidats déjà trouvés: {e:?}"
                    );
                    break;
                }
            };
            let scores = self.probe_and_score(&mut cands, q, probe);
            let best_score = scores.iter().copied().max().unwrap_or(0);

            // Un score de tracklist > 0 signifie qu'un candidat contient RÉELLEMENT le morceau
            // cherché : inutile de dégrader plus loin.
            if best_score > 0 {
                return Ok(rank_by_match(cands, &scores));
            }
            // Sinon on garde le meilleur essai vu jusqu'ici — jamais un essai vide au lieu d'un
            // essai qui avait au moins ramené des candidats.
            let keep = match &best {
                None => true,
                Some((prev_cands, _, prev_best)) => {
                    best_score > *prev_best || (prev_cands.is_empty() && !cands.is_empty())
                }
            };
            if keep {
                best = Some((cands, scores, best_score));
            }
        }

        match best {
            Some((cands, scores, _)) => Ok(rank_by_match(cands, &scores)),
            None => Ok(Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider() -> Discogs {
        // `attempts_for` est pur : il ne touche jamais le réseau, le jeton n'est pas lu.
        Discogs {
            token: "test".into(),
        }
    }

    fn q(artist: &str, title: &str, attempts: &[&str]) -> Query {
        Query {
            artist: artist.into(),
            title: title.into(),
            version: None,
            duration_s: None,
            attempts: attempts.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// Un appelant qui ne fournit pas de cascade doit obtenir EXACTEMENT le comportement d'avant :
    /// une requête `"{artist} {title}"`. Sans quoi brancher la cascade changerait le sens de tous
    /// les appels existants au passage.
    #[test]
    fn attempts_falls_back_to_artist_title_when_no_ladder_given() {
        let a = provider().attempts_for(&q("Larry Heard", "Mystery of Love", &[]));
        assert_eq!(a, vec!["Larry Heard Mystery of Love".to_string()]);
    }

    /// Le plafond est une contrainte de DÉBIT face aux 60 requêtes/minute de Discogs, pas un avis
    /// sur la qualité des essais suivants.
    #[test]
    fn attempts_are_capped() {
        let a = provider().attempts_for(&q("A", "B", &["un", "deux", "trois", "quatre", "cinq"]));
        assert_eq!(a.len(), LADDER_MAX_ATTEMPTS);
        assert_eq!(a, vec!["un", "deux", "trois"]);
    }

    /// Un doublon consomme une marche de la cascade pour rien — et la cascade n'en a que trois.
    #[test]
    fn attempts_drop_duplicates_and_blanks() {
        let a = provider().attempts_for(&q(
            "A",
            "B",
            &[
                "Slam Stepback",
                "",
                "   ",
                "slam stepback",
                "Slam Snapshots",
            ],
        ));
        assert_eq!(a, vec!["Slam Stepback", "Slam Snapshots"]);
    }

    /// Les essais viennent d'un nom de fichier arbitraire : la syntaxe de champ Discogs doit être
    /// neutralisée sur CHAQUE marche, pas seulement sur la première.
    #[test]
    fn attempts_are_sanitized_individually() {
        let a = provider().attempts_for(&q("A", "B", &["Artist: X", "Y AND Z"]));
        assert_eq!(a, vec!["Artist X", "Y Z"]);
    }

    /// Garde-fou de débit chiffré. L'ancien schéma (principal + repli) coûtait au pire
    /// 2 × (1 recherche + `TRACKLIST_PROBE` tracklists) = 14 requêtes par clic. La cascade ne doit
    /// pas dépasser ça, sinon on aurait échangé un taux de réussite contre des 429.
    #[test]
    fn ladder_network_budget_is_not_worse_than_the_old_scheme() {
        let old_worst = 2 * (1 + TRACKLIST_PROBE);
        let new_worst =
            (1 + TRACKLIST_PROBE) + (LADDER_MAX_ATTEMPTS - 1) * (1 + TRACKLIST_PROBE_DEGRADED);
        assert!(
            new_worst <= old_worst,
            "budget réseau dégradé : {new_worst} requêtes au pire contre {old_worst} avant"
        );
    }

    #[test]
    fn sanitize_discogs_query_neutralizes_field_syntax() {
        assert_eq!(
            sanitize_discogs_query("Artist: Presents Something"),
            "Artist Presents Something"
        );
        assert_eq!(
            sanitize_discogs_query(r#"track:"she said""#),
            "track she said"
        );
        assert_eq!(sanitize_discogs_query("Space AND Time"), "Space Time");
        assert_eq!(
            sanitize_discogs_query("Command OR Control"),
            "Command Control"
        );
    }

    /// Issue #66, mesures sur l'API publique du 2026-09-23 (voir le doc-comment de la fonction).
    /// Jusque-là ce test gelait l'inverse — tirets et parenthèses gardés « faute de comportement
    /// d'API confirmé ». Le tiret de tête faisait IGNORER le mot par Discogs.
    #[test]
    fn sanitize_discogs_query_flattens_punctuation_but_keeps_dots_and_apostrophes() {
        assert_eq!(
            sanitize_discogs_query("Cherry-Bomb -Elastic Original-Mix"),
            "Cherry Bomb Elastic Original Mix"
        );
        assert_eq!(sanitize_discogs_query("-ism"), "ism");
        assert_eq!(
            sanitize_discogs_query("Falling Up (Club Mix)"),
            "Falling Up Club Mix"
        );
        assert_eq!(
            sanitize_discogs_query("AC/DC Back In Black"),
            "AC DC Back In Black"
        );
        assert_eq!(
            sanitize_discogs_query("Simon & Garfunkel + [Live] {x} *"),
            "Simon Garfunkel Live x"
        );
        // Le point d'un acronyme et l'apostrophe restent : les aplatir perd la bonne release.
        assert_eq!(
            sanitize_discogs_query("D.J. Koze Amygdala"),
            "D.J. Koze Amygdala"
        );
        assert_eq!(
            sanitize_discogs_query("Can't Stop - Reprise"),
            "Can't Stop Reprise"
        );
        assert_eq!(
            sanitize_discogs_query("Eric\u{2019}s Dub"),
            "Eric\u{2019}s Dub"
        );
        // Relecture #66 : une marque combinante n'est pas de la ponctuation. NFD (nom venu d'un
        // Mac), virama hindi, marque de ton thaïe : le mot reste entier.
        assert_eq!(
            sanitize_discogs_query("Ko\u{0308}lsch Grey"),
            "Ko\u{0308}lsch Grey"
        );
        let hindi = "\u{092A}\u{094D}\u{092F}\u{093E}\u{0930}";
        assert_eq!(sanitize_discogs_query(hindi), hindi);
        let thai = "\u{0E44}\u{0E21}\u{0E48}";
        assert_eq!(sanitize_discogs_query(thai), thai);
        // …mais la ponctuation Unicode connue s'aplatit, et « µ » reste une lettre.
        assert_eq!(
            sanitize_discogs_query("\u{00B5}-Ziq \u{00AB}Hasty\u{00BB} \u{2010}x\u{2014}y"),
            "\u{00B5} Ziq Hasty x y"
        );
        // "AND"/"OR"/"NOT" are only stripped as whole words, not substrings.
        assert_eq!(
            sanitize_discogs_query("Andromeda Organism"),
            "Andromeda Organism"
        );
    }

    /// Deux marches qui portent les MÊMES mots sont la même recherche : une seule part.
    #[test]
    fn attempts_with_the_same_words_are_sent_once() {
        let a = provider().attempts_for(&q(
            "A",
            "B",
            &[
                "Cherry Bomb Elastic",
                "Cherry-Bomb Elastic",
                "Elastic Cherry Bomb",
                "Elastic",
            ],
        ));
        assert_eq!(a, vec!["Cherry Bomb Elastic", "Elastic"]);
    }

    /// Issue #66 : les mots de version seuls ne font pas un match. « Cherry Bomb (Original Mix) »
    /// marquait 8 pour une recherche « Elastic » + version « Original-Mix », arrêtait la cascade et
    /// proposait la mauvaise piste.
    #[test]
    fn version_words_alone_never_make_a_match() {
        let (score, title) = best_track_match(
            &tl(&["Cherry Bomb (Original Mix)".into()]),
            "Elastic",
            Some("Original-Mix"),
            None,
        );
        assert!(score <= 0, "score {score}");
        assert_eq!(title, None);
        let (score, title) = best_track_match(
            &tl(&["Elastic".into()]),
            "Elastic",
            Some("Original-Mix"),
            None,
        );
        assert!(score > 0);
        assert_eq!(title.as_deref(), Some("Elastic"));
    }

    const FIXTURE: &str = r#"{
      "results": [
        {
          "id": 12345,
          "title": "Larry Heard - Mystery Of Love",
          "year": "1986",
          "country": "US",
          "label": ["Alleviated Records", "Alleviated"],
          "genre": ["Electronic"],
          "style": ["Deep House", "House"],
          "format": ["Vinyl", "12\""],
          "cover_image": "https://img.discogs.com/x.jpg"
        },
        {
          "id": 999,
          "title": "Larry Heard - Mystery Of Love (Remix)",
          "label": ["Alleviated"],
          "style": ["House"],
          "cover_image": "https://img.discogs.com/y.jpg"
        },
        { "id": 7, "title": "" }
      ]
    }"#;

    #[test]
    fn parse_maps_style_to_styles_and_ignores_broad_genre() {
        let v: Value = serde_json::from_str(FIXTURE).unwrap();
        let cands = parse_search(&v);
        assert_eq!(cands.len(), 2, "title-less result is filtered out");
        let first = &cands[0];
        assert_eq!(first.artist, "Larry Heard");
        assert_eq!(first.title, "Mystery Of Love");
        assert_eq!(
            first.styles,
            vec!["Deep House".to_string(), "House".to_string()]
        );
        assert_eq!(first.year, Some(1986));
        assert_eq!(first.label.as_deref(), Some("Alleviated Records"));
        assert_eq!(first.country.as_deref(), Some("US"));
        assert_eq!(first.format.as_deref(), Some("Vinyl, 12\""));
        assert_eq!(first.release_id, "12345");
        assert_eq!(first.source, "discogs");
    }

    #[test]
    fn parse_keeps_provider_order_and_handles_missing_optionals() {
        let v: Value = serde_json::from_str(FIXTURE).unwrap();
        let cands = parse_search(&v);
        assert_eq!(cands[1].release_id, "999");
        assert_eq!(cands[1].year, None);
        assert_eq!(cands[1].country, None);
    }

    #[test]
    fn original_release_ranks_above_compilation_and_mix() {
        // Discogs returns the compilation/DJ-mix FIRST, but the real vinyl single should win.
        const F: &str = r#"{
          "results": [
            { "id": 1, "title": "Various - Summer Mix 2001", "format": ["CD", "Compilation", "Mixed"], "style": ["House"] },
            { "id": 2, "title": "VA - DJ Mix Vol. 3", "format": ["CD", "Mixed", "DJ Mix"], "style": ["House"] },
            { "id": 3, "title": "Aya - Sean", "format": ["Vinyl", "12\"", "Single"], "style": ["House"] }
          ]
        }"#;
        let v: Value = serde_json::from_str(F).unwrap();
        let cands = parse_search(&v);
        assert_eq!(
            cands[0].release_id, "3",
            "the vinyl single outranks comp/mix"
        );
        // the compilation and DJ-mix are still present, just lower
        assert!(cands.iter().any(|c| c.release_id == "1"));
        assert!(cands.iter().any(|c| c.release_id == "2"));
    }

    #[test]
    fn track_score_prefers_the_matching_mix() {
        let target_t = "Sean";
        let ver = Some("Eric's 2WFU Dub");
        let dub = track_match_score("Sean (Eric's 2WFU Dub)", None, target_t, ver, None);
        let plain = track_match_score("Sean", None, target_t, ver, None);
        let other = track_match_score("Sean (Radio Edit)", None, target_t, ver, None);
        assert!(
            dub > plain,
            "the exact dub ({dub}) beats the plain title ({plain})"
        );
        assert!(
            dub > other,
            "the exact dub ({dub}) beats a different mix ({other})"
        );
    }

    fn cand(id: &str, format: Option<&str>) -> Candidate {
        Candidate {
            artist: "Aya".into(),
            title: "Sean".into(),
            label: None,
            year: None,
            styles: vec![],
            country: None,
            format: format.map(|s| s.to_string()),
            cover_url: None,
            release_id: id.into(),
            source: "discogs".into(),
        }
    }

    #[test]
    fn rank_promotes_release_whose_tracklist_holds_the_mix() {
        // candidate 1 has the better format, but candidate 2's tracklist actually contains the
        // mix (higher match score) → the match must win over format relevance.
        let cands = vec![
            cand("1", Some("Vinyl, 12\", Single")),
            cand("2", Some("CD, Album")),
        ];
        let scores = [1, 9];
        let ranked = rank_by_match(cands, &scores);
        assert_eq!(ranked[0].release_id, "2");
        assert_eq!(ranked[1].release_id, "1");
    }

    #[test]
    fn rank_falls_back_to_format_when_scores_tie() {
        // no tracklist matched (all zero) → format relevance breaks the tie (single > album).
        let cands = vec![
            cand("album", Some("CD, Album")),
            cand("single", Some("Vinyl, 12\", Single")),
        ];
        let scores = [0, 0];
        let ranked = rank_by_match(cands, &scores);
        assert_eq!(ranked[0].release_id, "single");
    }

    #[test]
    fn clean_artist_strips_discogs_artifacts_but_keeps_real_parens() {
        assert_eq!(clean_artist("Larry Heard*"), "Larry Heard");
        assert_eq!(clean_artist("Aya (2)"), "Aya");
        assert_eq!(clean_artist("A* B (3)"), "A B");
        // a non-numeric parenthetical (e.g. a real suffix) is left intact
        assert_eq!(
            clean_artist("Cabaret Voltaire (Live)"),
            "Cabaret Voltaire (Live)"
        );
        // multi-artist credit kept as-is, only the artifacts removed
        assert_eq!(
            clean_artist("Larry Heard* / Mr Fingers"),
            "Larry Heard / Mr Fingers"
        );
    }

    #[test]
    fn best_track_match_picks_the_track_not_the_ep() {
        let titles = vec!["Intro".to_string(), "Sean".to_string(), "Outro".to_string()];
        let (score, title) = best_track_match(&tl(&titles), "Sean", None, None);
        assert!(score > 0);
        assert_eq!(title.as_deref(), Some("Sean"));
    }

    #[test]
    fn best_track_match_keeps_version_track_over_plain() {
        let titles = vec![
            "Love Foolosophy".to_string(),
            "Love Foolosophy (Knee Deep Remix)".to_string(),
        ];
        let (_score, title) = best_track_match(
            &tl(&titles),
            "Love Foolosophy",
            Some("Knee Deep Remix"),
            None,
        );
        assert_eq!(title.as_deref(), Some("Love Foolosophy (Knee Deep Remix)"));
    }

    #[test]
    fn best_track_match_disambiguates_via_title_tokens_when_version_is_embedded_not_split() {
        // A tag Title that embeds its own mix name ("Falling Up (Club Mix)") with no separate
        // target_version (F4 audit finding, verified empirically): plain per-token overlap
        // (+1 each) still correctly picks the exact matching tracklist entry over a sibling
        // mix, because every word of the mix name is itself a target-title token — the missing
        // x3 version bonus doesn't end up mattering here. No fix needed; kept as a regression
        // guard for this reasoning.
        let titles = vec![
            "Falling Up".to_string(),
            "Falling Up (Extended Mix)".to_string(),
            "Falling Up (Club Mix)".to_string(),
        ];
        let (_score, title) = best_track_match(&tl(&titles), "Falling Up (Club Mix)", None, None);
        assert_eq!(title.as_deref(), Some("Falling Up (Club Mix)"));
    }

    #[test]
    fn best_track_match_prefers_original_over_remix_when_no_version() {
        // Local file has no version → the plain original must win over a remix that ties on title.
        let titles = vec![
            "Love Foolosophy (Knee Deep Remix)".to_string(),
            "Love Foolosophy".to_string(),
        ];
        let (_score, title) = best_track_match(&tl(&titles), "Love Foolosophy", None, None);
        assert_eq!(title.as_deref(), Some("Love Foolosophy"));
    }

    #[test]
    fn best_track_match_avoids_dj_tool_and_keeps_first_on_tie() {
        // "Fool For Love" master: with no requested version, a (Beats) DJ tool must not be forced.
        // The vocal/main mix (not a version keyword) outscores the penalized Beats/Dub tools.
        let titles = vec![
            "Fool For Love (Vocal Mix)".to_string(),
            "Fool For Love (Beats)".to_string(),
            "Fool For Love (Dub)".to_string(),
        ];
        let (_score, title) = best_track_match(&tl(&titles), "Fool For Love", None, None);
        assert_eq!(title.as_deref(), Some("Fool For Love (Vocal Mix)"));
    }

    #[test]
    fn best_track_match_keeps_first_when_scores_tie() {
        // Two equal-scoring mixes → the first listed wins (original is usually first), not the last.
        let titles = vec![
            "Track (Club Mix)".to_string(),
            "Track (Extended Mix)".to_string(),
        ];
        let (_score, title) = best_track_match(&tl(&titles), "Track", None, None);
        assert_eq!(title.as_deref(), Some("Track (Club Mix)"));
    }

    #[test]
    fn best_track_match_none_when_nothing_matches() {
        let titles = vec!["Completely".to_string(), "Unrelated".to_string()];
        let (_score, title) = best_track_match(&tl(&titles), "Sean", Some("Dub"), None);
        assert_eq!(title, None);
    }

    /// Tracklist sans durées, comme rendue par `fetch_tracklist` avant T5.
    fn tl(titles: &[String]) -> Vec<TracklistEntry> {
        titles
            .iter()
            .map(|t| TracklistEntry {
                title: t.clone(),
                duration_s: None,
            })
            .collect()
    }

    /// Tracklist à durées Discogs (`"m:ss"`, `""` = non saisie), passée par le VRAI analyseur.
    fn tl_timed(tracks: &[(&str, &str)]) -> Vec<TracklistEntry> {
        let body = serde_json::json!({
            "tracklist": tracks
                .iter()
                .map(|(t, d)| serde_json::json!({ "type_": "track", "title": t, "duration": d }))
                .collect::<Vec<_>>()
        });
        parse_tracklist(&body)
    }

    #[test]
    fn discogs_durations_parse_to_seconds_and_blank_is_unknown() {
        assert_eq!(parse_discogs_duration("6:12"), Some(372.0));
        assert_eq!(parse_discogs_duration("1:02:30"), Some(3750.0));
        assert_eq!(parse_discogs_duration(" 0:45 "), Some(45.0));
        // Discogs rend "" quand la durée n'est pas saisie : inconnue, pas nulle.
        assert_eq!(parse_discogs_duration(""), None);
        assert_eq!(parse_discogs_duration("0:00"), None);
        assert_eq!(parse_discogs_duration("6'12"), None);
        assert_eq!(parse_discogs_duration("6:xx"), None);
    }

    #[test]
    fn parse_tracklist_keeps_titles_and_reads_durations() {
        let t = tl_timed(&[("Falling Up (Club Mix)", "7:41"), ("Falling Up (Dub)", "")]);
        assert_eq!(
            t,
            vec![
                TracklistEntry {
                    title: "Falling Up (Club Mix)".into(),
                    duration_s: Some(461.0),
                },
                TracklistEntry {
                    title: "Falling Up (Dub)".into(),
                    duration_s: None,
                },
            ]
        );
    }

    /// T5, le cas que les mots ne savent pas trancher : deux mixes sans version demandée et sans
    /// mot pénalisé, à égalité — avant T5 le PREMIER gagnait toujours
    /// (`best_track_match_keeps_first_when_scores_tie`). La durée de la piste locale désigne le
    /// second.
    #[test]
    fn duration_picks_the_mix_the_words_tie_on() {
        let tracks = tl_timed(&[
            ("Track (Club Mix)", "7:41"),
            ("Track (Extended Mix)", "9:02"),
        ]);
        let (_s, title) = best_track_match(&tracks, "Track", None, Some(541.4));
        assert_eq!(title.as_deref(), Some("Track (Extended Mix)"));
        // Témoin : sans durée locale, le comportement d'avant T5 tient — le premier.
        let (_s, title) = best_track_match(&tracks, "Track", None, None);
        assert_eq!(title.as_deref(), Some("Track (Club Mix)"));
    }

    /// Un fichier sans version dans le nom, sur un 12" qui porte l'original ET un remix : la
    /// pénalité du remix (−2) gagnait déjà. Quand la durée locale est celle du remix, elle doit
    /// renverser ce choix — c'est le fichier qui dit quel enregistrement il est.
    #[test]
    fn duration_overrides_the_original_preference_when_it_points_at_the_remix() {
        let tracks = tl_timed(&[
            ("Love Foolosophy", "3:47"),
            ("Love Foolosophy (Knee Deep Remix)", "8:23"),
        ]);
        let (_s, title) = best_track_match(&tracks, "Love Foolosophy", None, Some(503.0));
        assert_eq!(title.as_deref(), Some("Love Foolosophy (Knee Deep Remix)"));
        let (_s, title) = best_track_match(&tracks, "Love Foolosophy", None, Some(227.5));
        assert_eq!(title.as_deref(), Some("Love Foolosophy"));
    }

    /// La durée ne passe qu'APRÈS le portail des mots distinctifs : une piste sans rapport de
    /// durée identique reste hors jeu (même raisonnement que l'issue #66 pour les mots de version).
    #[test]
    fn equal_duration_alone_never_makes_a_match() {
        let tracks = tl_timed(&[("Completely Unrelated", "6:12")]);
        let (score, title) = best_track_match(&tracks, "Sean", None, Some(372.0));
        assert!(score <= 0, "score {score}");
        assert_eq!(title, None);
    }

    /// Cas réel mesuré le 2026-11-03 sur la base d'Antoine : « Commute », identifiée, fichier de
    /// 363 s quand Discogs donne 3:38. Une durée qui ne colle pas ne doit pas effacer la SEULE
    /// piste dont les mots correspondent : avec la pénalité −3 du design, 1 − 3 = −2, et le match
    /// juste disparaissait. 14 bonnes pistes sur 75 mesurées sont à plus de 15 s de Discogs.
    #[test]
    fn a_far_duration_never_erases_the_only_word_match() {
        let tracks = tl_timed(&[("Commute", "3:38"), ("Departure", "6:02")]);
        let (score, title) = best_track_match(&tracks, "Commute", None, Some(363.0));
        assert!(score > 0, "score {score}");
        assert_eq!(title.as_deref(), Some("Commute"));
    }

    /// Les deux paliers, bornes comprises, et la neutralité d'une durée absente.
    #[test]
    fn duration_score_bands() {
        assert_eq!(
            duration_score(Some(372.0), Some(375.0)),
            3,
            "3 s : même piste"
        );
        assert_eq!(
            duration_score(Some(372.0), Some(375.1)),
            0,
            "au-delà de 3 s"
        );
        assert_eq!(
            duration_score(Some(372.0), Some(735.0)),
            0,
            "écart lointain : neutre, pas pénalisé"
        );
        assert_eq!(duration_score(None, Some(372.0)), 0);
        assert_eq!(duration_score(Some(372.0), None), 0);
        assert_eq!(
            duration_score(Some(372.0), Some(0.0)),
            0,
            "durée locale nulle"
        );
        assert_eq!(duration_score(Some(372.0), Some(f64::NAN)), 0);
    }

    /// Un jeton vide se refuse SANS toucher au réseau.
    ///
    /// Ce n'est pas une micro-optimisation : la recherche Discogs répond 200 sans autorisation,
    /// donc un aller-retour sur un champ vide conclurait « jeton accepté ». Le test tient ce
    /// raisonnement-là, et il tourne hors ligne parce que le chemin qu'il couvre n'appelle rien.
    #[test]
    fn verify_token_refuse_un_jeton_vide_sans_reseau() {
        for vide in ["", "   ", "\t"] {
            let d = Discogs {
                token: vide.to_string(),
            };
            match d.verify_token() {
                Err(ProviderError::BadToken(_)) => {}
                other => panic!("attendu BadToken sur {vide:?}, obtenu {other:?}"),
            }
        }
    }

    #[test]
    fn map_ureq_err_429_is_rate_limited() {
        match map_ureq_err(ureq::Error::StatusCode(429)) {
            ProviderError::RateLimited { retry_after_s } => assert_eq!(retry_after_s, 60),
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[test]
    fn map_ureq_err_other_status_is_network_with_code() {
        match map_ureq_err(ureq::Error::StatusCode(503)) {
            ProviderError::Network(msg) => assert!(
                msg.contains("503"),
                "message should mention the status code: {msg}"
            ),
            other => panic!("expected Network, got {other:?}"),
        }
    }

    #[test]
    fn map_ureq_err_transport_failure_is_network() {
        match map_ureq_err(ureq::Error::HostNotFound) {
            ProviderError::Network(_) => {}
            other => panic!("expected Network, got {other:?}"),
        }
    }
}
