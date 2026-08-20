//! Pure verdict logic, keyed on the detected cutoff + DECLARED rail/bitrate.
//!
//! Two frauds are flagged as `Fake`:
//! 1. **Fake lossless** — declared FLAC/WAV/AIFF but the spectrum shows a lossy lowpass cliff.
//! 2. **Over-encoded lossy** — declared e.g. 320 kbps MP3 but the cutoff is far below what
//!    that bitrate produces → it was re-encoded UP from a lower-quality source.
//!
//! An honestly-labelled low-bitrate MP3 (cutoff matches its bitrate) stays `Ok` here — its
//! "below the user's quality threshold" handling is a separate axis (M4 rules).

use crate::analysis::{Rail, Verdict};

/// Version du PRODUCTEUR de verdict, stampée dans `tracks.verdict_ver` par
/// `worker::persist_report` (migration v22). Rien ne l'expose au frontend.
///
/// **À incrémenter dès que `verdict()` ne rend plus le MÊME verdict pour les mêmes entrées** :
/// les bandes de décision (`LOSSLESS_OK_HZ`, `LOSSY_CLIFF_HZ`, `NO_MEASUREMENT_HZ`), le barème de
/// `min_cutoff_hz_for_bitrate`, les planchers de platitude (`HF_FIXED_FLOOR_DB`,
/// `HF_TOP_FLOOR_DB`, tous deux annoncés provisoires ci-dessous), ou l'arrivée d'une entrée
/// nouvelle dans l'arbitrage.
///
/// ⚠️ **Elle n'est PAS redondante avec `analysis::REPORT_CACHE_VERSION`** — établi en lisant qui
/// écrit la colonne `verdict`, pas supposé (issue #39, « ce qui n'est pas tranché ici ») :
///
/// - `worker::persist_report` écrit `verdict` et `report_cache_ver` dans le MÊME `UPDATE`, donc
///   les deux sont d'accord à l'écriture ;
/// - mais `ipc::analyze_path` répare le cache sur désaccord de version en réécrivant
///   `report_json` + `report_cache_ver` **sans jamais toucher `verdict`** ;
/// - et `worker::select_pending` ne re-sélectionne que sur `report_json` absent, jamais sur une
///   version périmée (constaté et payé par la migration v16).
///
/// Après un bump de `REPORT_CACHE_VERSION`, une piste rangée retrouve donc un rapport courant en
/// gardant dans sa colonne le verdict calculé par l'ANCIEN moteur — et c'est cette colonne, pas le
/// rapport, que lisent la Bibliothèque, les Écartés et le compte « à re-sourcer ». Le dépôt le
/// note déjà noir sur blanc dans le commentaire de la migration v21 (`db.rs`) : « `verdict` et
/// `cutoff_hz` ne sont couverts par AUCUNE version de cache ».
pub const VERDICT_CACHE_VERSION: i64 = 1;

/// Lit le cache `(tracks.verdict, tracks.verdict_ver)`. Version absente (NULL — ligne d'avant la
/// v22 que son backfill n'a pas stampée) ou différente = **pas de verdict courant**, rendu comme
/// `None`. C'est exactement l'état qu'un `verdict` NULL décrit déjà et que toute l'app sait
/// afficher : file d'attente qui propose « Réanalyser », badge absent en Bibliothèque, ligne hors
/// du compte « à re-sourcer ». Jamais une erreur.
///
/// Même raison qu'`fingerprint::cached` de passer par une fonction plutôt que par un littéral en
/// SQL : la constante reste déclarée une seule fois.
pub fn cached(raw: Option<String>, ver: Option<i64>) -> Option<String> {
    match ver {
        Some(v) if v == VERDICT_CACHE_VERSION => raw,
        _ => None,
    }
}

/// Decision bands (Hz) for a file DECLARED lossless. `cutoff_hz` is stored raw upstream so
/// these thresholds stay reconfigurable without re-analysis (Réglages, M2b+).
pub const LOSSLESS_OK_HZ: f32 = 20000.0; // ≥ → authentic lossless
pub const LOSSY_CLIFF_HZ: f32 = 19500.0; // ≤ → lossy lowpass cliff → fake
                                         // (LOSSY_CLIFF_HZ, LOSSLESS_OK_HZ) → grey zone

/// Ce que rend `spectrum::detect_cutoff` quand il n'avait **rien à mesurer** — aucune trame
/// décodée. Ce n'est pas une coupure à 0 Hz : c'est l'absence de mesure.
///
/// La valeur est un sentinel sans ambiguïté, et pas par convention : les deux seules autres
/// sorties de `detect_cutoff` sont `k * hz_per_bin` avec `k` au-dessus de son plancher de
/// balayage (donc > 2 kHz) et `nyq_hz`. Zéro n'est atteignable que par le retour anticipé.
///
/// Mesuré le 2026-08-17 sur la bibliothèque réelle : **deux MP3** de plus de six minutes,
/// déclarés 320 kbps, `codec_error` NULL — donc aucune erreur remontée nulle part — rendaient
/// `cutoff_hz = 0`, que `verdict()` lisait comme « coupe à 0 Hz, très en dessous du plancher de
/// 19 000 pour du 320 » et marquait FAKE. Un échec de décodage se présentait comme une preuve
/// de fraude.
pub const NO_MEASUREMENT_HZ: f32 = 0.0;

/// Minimum cutoff a *genuine* MP3 of the given bitrate should reach (≈ encoder lowpass minus
/// a margin for genre/encoder spread). A declared bitrate whose real cutoff is below this is
/// over-encoded (transcoded up from a worse source).
pub fn min_cutoff_hz_for_bitrate(kbps: u32) -> f32 {
    match kbps {
        b if b >= 320 => 19000.0,
        b if b >= 256 => 18000.0,
        b if b >= 192 => 16500.0,
        b if b >= 160 => 15500.0,
        b if b >= 128 => 14500.0,
        _ => 12000.0,
    }
}

/// Equivalent lossy bitrate for a measured cutoff, read off the SAME tiers `verdict()` uses to
/// call a bitrate over-encoded (FIX-11: this used to be duplicated in report-view.ts with a
/// shifted table — e.g. a cutoff the verdict logic scored against the 192kbps band showed as
/// "≈256 kbps" in the UI). Rust is the single source of truth; the front just displays this.
pub fn estimate_kbps(cutoff_hz: f32) -> u32 {
    const TIERS: [u32; 5] = [320, 256, 192, 160, 128];
    for b in TIERS {
        if cutoff_hz >= min_cutoff_hz_for_bitrate(b) {
            return b;
        }
    }
    128
}

/// Les deux bandes de platitude de l'aigu, passées ENSEMBLE et NOMMÉES.
///
/// Deux `Option<f32>` positionnels côte à côte s'inverseraient sans que rien ne le dise — et les
/// inverser change le sens : la bande fixe (16-20 kHz) et la bande relative (0,80-0,98 × Nyquist)
/// n'ont ni la même plage de valeurs ni les mêmes angles morts. Voir `spectrum.rs`.
///
/// `Default` = aucune mesure, et c'est un état réel : la bande n'existe pas à tous les taux
/// d'échantillonnage, et un fichier trop court ne rend aucune trame.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct HfFlatness {
    /// Bande FIXE 16-20 kHz, médiane sur les trames, en dB.
    pub fixed_db: Option<f32>,
    /// Bande RELATIVE au Nyquist, médiane sur les trames, en dB.
    pub top_db: Option<f32>,
}

/// Planchers de la plage des masters, une par bande. Un lossless à bande pleine qui passe SOUS
/// l'un des deux n'est plus annoncé Vrai lossless — il devient Douteux.
///
/// ⚠️ **Ce ne sont PAS les bornes d'affichage de `frontend/report-figures.ts`, et c'est délibéré.**
/// Celles-là (`HF_REF_LO = -5.4`) viennent de `scripts/hf-flatness-probe.mjs` : décodage forcé en
/// mono 44,1 kHz, DFT naïve, 200 trames échantillonnées, 150 s au plus. Le juge, lui, mesure au
/// taux natif, sur tout le fichier, par la FFT de `spectrum.rs`. **Deux chemins de mesure, deux
/// valeurs** — et un seuil n'est comparable qu'aux mesures qui l'ont produit.
///
/// Ce que le mélange coûtait, mesuré le 2026-08-18 par un scan complet du corpus : à -5,4, le
/// fichier `src09` du corpus — un ACHAT — mesure -5,79 par le chemin Rust et bascule en Douteux.
/// Un faux positif sur du matériel acheté, produit par un seuil que le code qui juge n'avait
/// jamais mesuré. La sonde le situait à -5,4 ; le review en a même tiré une « distribution
/// bimodale » avec un vide entre -6,5 et -5,4, où ce fichier tombe pourtant.
///
/// D'où vient -5,8 : minimum des 10 authentiques du corpus MESURÉS PAR CE CHEMIN (-5,79), arrondi
/// vers le bas — la valeur exacte serait une borne posée sur un fichier réel, à la merci de son
/// troisième chiffre. Coût mesuré : 98/150 au lieu de 105/150, contre 0/10 faux positifs au lieu
/// de 1/10.
///
/// ⚠️ **Provisoire, et sur DIX fichiers.** C'est le défaut que ce chantier a déjà corrigé une fois
/// (un seuil posé au plancher de 10 fichiers d'une famille musicale est une propriété de
/// l'échantillon). Ce qui le lèverait : re-mesurer les 44 authentiques de la référence élargie par
/// ce chemin-ci, pas par la sonde. Tant que ce n'est pas fait, ce plancher se lit comme une borne
/// prudente, pas comme la frontière des masters.
const HF_FIXED_FLOOR_DB: f32 = -5.8;

/// Bande relative. Toujours la valeur issue de la sonde, et gardée telle quelle parce qu'elle est
/// CONSERVATRICE ici : les 10 authentiques du corpus descendent à -10,77 par le chemin Rust, très
/// au-dessus de ce plancher, donc aucun d'eux n'en dépend. Elle vaut le même avertissement — elle
/// n'a pas non plus été mesurée par le code qui juge.
const HF_TOP_FLOOR_DB: f32 = -23.8;

/// Vrai quand au moins une des deux bandes sort par le bas de la plage des masters.
///
/// L'UNION et pas l'intersection : mesuré sur le corpus étiqueté, les deux bandes sont aveugles à
/// des endroits différents — la fixe ne voit aucun Opus, la relative ne voit aucun MP3 128, dont
/// la coupure passe sous elle. Exiger les deux ramènerait la détection à ce que chacune rate.
///
/// Une bande non mesurée n'est pas un grief : `None` ne déclenche rien.
fn below_master_range(f: HfFlatness) -> bool {
    f.fixed_db.is_some_and(|v| v < HF_FIXED_FLOOR_DB)
        || f.top_db.is_some_and(|v| v < HF_TOP_FLOOR_DB)
}

/// Maps cutoff + declared rail + declared bitrate to a verdict.
///
/// `content_rail` is the rail sniffed from the actual container/codec (independent of the
/// declared extension/tag) — when it disagrees with `declared` on the lossless side (declared
/// FLAC/WAV/AIFF but the container is actually a lossy codec, e.g. an MP3 renamed to `.flac`),
/// that mismatch alone is fraud, before even looking at the spectral cutoff: a renamed lossy
/// source can coincidentally have a cutoff high enough to pass the cutoff-only check below.
/// `Rail::Unknown` (sniffing failed/inconclusive) never triggers this short-circuit — it falls
/// through to the existing cutoff-based logic unchanged.
pub fn verdict(
    cutoff_hz: f32,
    declared: Rail,
    declared_bitrate: Option<u32>,
    content_rail: Rail,
    flatness: HfFlatness,
) -> Verdict {
    match declared {
        Rail::Lossless => {
            if content_rail == Rail::Lossy {
                // Le désaccord de conteneur reste EN PREMIER : c'est une fraude établie sans le
                // spectre, donc l'absence de mesure ne doit pas l'effacer.
                Verdict::Fake
            } else if cutoff_hz <= NO_MEASUREMENT_HZ {
                Verdict::Grey
            } else if cutoff_hz >= LOSSLESS_OK_HZ {
                // Bande pleine : la coupure n'a plus rien à dire. C'est ici, et seulement ici, que
                // la platitude de l'aigu tranche — elle ne DÉGRADE jamais un verdict déjà négatif,
                // elle rattrape ce que la falaise ne peut pas voir.
                if below_master_range(flatness) {
                    Verdict::Grey
                } else {
                    Verdict::Ok
                }
            } else if cutoff_hz <= LOSSY_CLIFF_HZ {
                Verdict::Fake
            } else {
                Verdict::Grey
            }
        }
        Rail::Lossy => match declared_bitrate {
            // Rien mesuré → on ne sait pas. Ce bras passe AVANT celui du débit : sans lui, un
            // cutoff de 0 est inférieur à tous les planchers de `min_cutoff_hz_for_bitrate` et
            // accuse le fichier de sur-encodage sur la foi d'un décodage qui n'a pas eu lieu.
            _ if cutoff_hz <= NO_MEASUREMENT_HZ => Verdict::Grey,
            // declared bitrate the real spectrum can't support → over-encoded fraud
            Some(b) if cutoff_hz < min_cutoff_hz_for_bitrate(b) => Verdict::Fake,
            _ => Verdict::Ok,
        },
        Rail::Unknown => Verdict::Grey,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les trois états que `cached` doit distinguer. Le cas NULL est celui de toute ligne d'avant
    /// la v22 que son backfill n'a pas stampée — un rapport lui-même périmé, typiquement.
    #[test]
    fn cached_ne_sert_que_la_version_courante() {
        let v = || Some("fake".to_string());
        assert_eq!(
            cached(v(), Some(VERDICT_CACHE_VERSION)),
            v(),
            "version courante : le verdict en cache doit être servi tel quel"
        );
        assert_eq!(
            cached(v(), None),
            None,
            "version absente (base d'avant la v22) : pas de verdict courant"
        );
        assert_eq!(
            cached(v(), Some(VERDICT_CACHE_VERSION + 1)),
            None,
            "version différente : pas de verdict courant"
        );
    }

    #[test]
    fn lossless_with_full_band_is_ok() {
        assert_eq!(
            verdict(
                21000.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness::default()
            ),
            Verdict::Ok
        );
    }

    #[test]
    fn lossless_with_lossy_cliff_is_fake() {
        assert_eq!(
            verdict(
                16000.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
        assert_eq!(
            verdict(
                19000.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
    }

    #[test]
    fn lossless_in_grey_band_is_grey() {
        assert_eq!(
            verdict(
                19800.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness::default()
            ),
            Verdict::Grey
        );
    }

    /// Un lossless à bande PLEINE dont l'aigu est creux devient **Douteux**, pas Vrai lossless.
    ///
    /// C'est le cas que la coupure ne peut pas voir : le fichier va jusqu'au bout du spectre, donc
    /// il n'y a aucune falaise à seuiller — et pourtant l'aigu est clairsemé au point de sortir de
    /// la plage des masters mesurés. Mesuré sur le corpus étiqueté : c'est la forme de tout l'AAC
    /// haut débit, du LAME 320 et du V0 (voir `docs/superpowers/changes/2026-08-17-detecteur-corpus/`).
    ///
    /// **Douteux et pas Faux, délibérément.** La plage de référence repose sur 32 authentiques,
    /// et deux morceaux ambient s'en approchent légitimement : le haut du spectre d'un master
    /// sombre EST clairsemé. Accuser sur cette seule base produirait des faux positifs sur du
    /// matériel acheté. Douteux dit ce qu'on sait — « cet aigu ne ressemble pas à un master » —
    /// sans dire ce qu'on ne sait pas.
    #[test]
    fn lossless_a_bande_pleine_mais_aigu_creux_est_douteux() {
        assert_eq!(
            verdict(
                21000.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness {
                    fixed_db: Some(-40.0),
                    top_db: Some(-4.0),
                },
            ),
            Verdict::Grey
        );
    }

    /// L'AUTRE moitié de l'union : la bande relative seule suffit, la fixe étant normale.
    ///
    /// C'est la forme d'un Opus — 48 kHz, du contenu jusqu'à 20 kHz, donc la bande fixe 16-20 kHz
    /// tombe en pleine bande passante et ne voit rien. Sans ce cas, retirer la clause relative de
    /// `below_master_range` laisserait toute la suite verte.
    ///
    /// ⚠️ Ce test n'a jamais été rouge : l'union était déjà écrite quand il est arrivé. Il pinne,
    /// il n'a rien piloté — et c'est un écart à la boucle, pas une propriété du code.
    #[test]
    fn lossless_dont_seul_le_tout_haut_est_creux_est_douteux() {
        assert_eq!(
            verdict(
                21000.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness {
                    fixed_db: Some(-3.0),
                    top_db: Some(-30.0),
                },
            ),
            Verdict::Grey
        );
    }

    /// Le plancher est une borne INCLUSE : à la valeur exacte, on est encore dans la plage.
    ///
    /// Ce que ça protège : les deux morceaux ambient qui ont fait descendre la borne relative à
    /// -23,8 sont EXACTEMENT à cette valeur. Un `<=` au lieu d'un `<` les annoncerait douteux —
    /// c'est-à-dire le faux positif que ce seuil existe pour éviter.
    #[test]
    fn un_authentique_pile_sur_le_plancher_reste_vrai_lossless() {
        assert_eq!(
            verdict(
                21000.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness {
                    fixed_db: Some(HF_FIXED_FLOOR_DB),
                    top_db: Some(HF_TOP_FLOOR_DB),
                },
            ),
            Verdict::Ok
        );
    }

    /// Une bande NON MESURÉE n'est pas un grief. `None` ne doit jamais valoir « creux ».
    ///
    /// Le cas réel : la bande fixe 16-20 kHz n'existe pas sous 40 kHz d'échantillonnage, et un
    /// fichier trop court ne rend aucune trame. Traiter cette absence comme une mesure basse
    /// accuserait un fichier pour n'avoir pas pu être mesuré — le défaut exact que
    /// `NO_MEASUREMENT_HZ` corrige sur la coupure.
    #[test]
    fn une_bande_non_mesuree_ne_declenche_rien() {
        assert_eq!(
            verdict(
                21000.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness {
                    fixed_db: None,
                    top_db: None,
                },
            ),
            Verdict::Ok
        );
    }

    #[test]
    fn honest_mp3_matching_its_bitrate_is_ok() {
        // genuine 320 (~20.5k), genuine 128 (~16k)
        assert_eq!(
            verdict(
                20500.0,
                Rail::Lossy,
                Some(320),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Ok
        );
        assert_eq!(
            verdict(
                16000.0,
                Rail::Lossy,
                Some(128),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Ok
        );
    }

    #[test]
    fn over_encoded_mp3_is_fake() {
        // declared 320 but cuts at 16k (transcoded up from ~128) → fraud
        assert_eq!(
            verdict(
                16000.0,
                Rail::Lossy,
                Some(320),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
        // declared 256 but cuts at 15k
        assert_eq!(
            verdict(
                15000.0,
                Rail::Lossy,
                Some(256),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
    }

    // FIX-18: 192/160 kbps were the only two of the six min_cutoff_hz_for_bitrate tiers never
    // exercised by a direct test (only 320/256/128 were covered above).
    #[test]
    fn honest_192_and_160_mp3_is_ok() {
        assert_eq!(
            verdict(
                17000.0,
                Rail::Lossy,
                Some(192),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Ok
        );
        assert_eq!(
            verdict(
                16000.0,
                Rail::Lossy,
                Some(160),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Ok
        );
    }

    #[test]
    fn over_encoded_192_and_160_mp3_is_fake() {
        // declared 192 but cuts at 15k (below the 16500Hz floor for 192) → fraud
        assert_eq!(
            verdict(
                15000.0,
                Rail::Lossy,
                Some(192),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
        // declared 160 but cuts at 14k (below the 15500Hz floor for 160) → fraud
        assert_eq!(
            verdict(
                14000.0,
                Rail::Lossy,
                Some(160),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
    }

    #[test]
    fn lossy_without_known_bitrate_is_ok() {
        // can't judge over-encoding without a declared bitrate → don't false-flag
        assert_eq!(
            verdict(
                13000.0,
                Rail::Lossy,
                None,
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Ok
        );
    }

    /// Un décodage qui n'a produit aucune trame ne doit accuser personne.
    ///
    /// Mesuré sur la bibliothèque réelle le 2026-08-17 : deux MP3 320 kbps de plus de six minutes,
    /// sans `codec_error`, portaient `cutoff_hz = 0` et sortaient FAKE. Sur les deux rails, parce
    /// que le défaut est le même des deux côtés — un zéro qui se fait lire comme une mesure.
    ///
    /// Le contrôle positif est dans le même corps : la MÊME entrée avec un cutoff réellement bas
    /// doit toujours sortir Fake. Sans lui, on ne saurait pas si le correctif distingue l'absence
    /// de mesure ou s'il a simplement désarmé la détection de sur-encodage.
    #[test]
    fn no_measurement_is_grey_not_fake() {
        assert_eq!(
            verdict(
                NO_MEASUREMENT_HZ,
                Rail::Lossy,
                Some(320),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Grey
        );
        assert_eq!(
            verdict(
                NO_MEASUREMENT_HZ,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness::default()
            ),
            Verdict::Grey
        );
        // Contrôle positif : une vraie mesure basse reste une fraude.
        assert_eq!(
            verdict(
                16000.0,
                Rail::Lossy,
                Some(320),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
        assert_eq!(
            verdict(
                16000.0,
                Rail::Lossless,
                None,
                Rail::Lossless,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
    }

    /// L'absence de mesure n'efface pas une fraude déjà établie SANS le spectre : un MP3 renommé
    /// en `.flac` est un faux même si rien n'a pu être décodé.
    #[test]
    fn no_measurement_does_not_erase_a_container_mismatch() {
        assert_eq!(
            verdict(
                NO_MEASUREMENT_HZ,
                Rail::Lossless,
                None,
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
    }

    #[test]
    fn unknown_rail_is_grey() {
        assert_eq!(
            verdict(
                16000.0,
                Rail::Unknown,
                None,
                Rail::Unknown,
                HfFlatness::default()
            ),
            Verdict::Grey
        );
    }

    // Bug case: an MP3 renamed to `.flac` declares Lossless but its container is actually
    // lossy — the mismatch alone is fraud, regardless of how high the cutoff happens to be
    // (a 256-320kbps source can cut near/above the lossless-OK threshold).
    #[test]
    fn declared_lossless_but_content_lossy_is_fake() {
        assert_eq!(
            verdict(
                20500.0,
                Rail::Lossless,
                None,
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
    }

    // Content-rail sniffing failed/inconclusive → must not false-positive off the mismatch
    // short-circuit; falls back to the existing cutoff-only logic (Ok here).
    #[test]
    fn declared_lossless_content_unknown_falls_back_to_cutoff() {
        assert_eq!(
            verdict(
                21000.0,
                Rail::Lossless,
                None,
                Rail::Unknown,
                HfFlatness::default()
            ),
            Verdict::Ok
        );
    }

    // Declared lossy stays on the existing cutoff/bitrate logic when content_rail agrees —
    // the mismatch short-circuit is Lossless-branch-only.
    #[test]
    fn declared_lossy_content_lossy_unchanged_behavior() {
        assert_eq!(
            verdict(
                20500.0,
                Rail::Lossy,
                Some(320),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Ok
        );
        assert_eq!(
            verdict(
                16000.0,
                Rail::Lossy,
                Some(320),
                Rail::Lossy,
                HfFlatness::default()
            ),
            Verdict::Fake
        );
    }
}
