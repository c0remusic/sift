//! Acoustic fingerprint (Chromaprint) — the "sound" confirmation behind the name pre-filter.
//! `compute_for_path` decodes the file (reusing the analysis decoder) and produces a compact
//! fingerprint; `similarity` defers alignment to the crate's segment matcher
//! (`match_fingerprints`, with the same `Configuration` as `compute_for_path`) and returns the
//! fraction of the shorter fingerprint's items covered by segments scoring under
//! `SEGMENT_SCORE_MAX` — 0.0 when either fingerprint is empty or the matcher errors.
//! `MATCH_THRESHOLD` is not applied here: it is the callers' decision on that fraction
//! (`dedup.rs`). Reused later by the library scan.

use rusty_chromaprint::{match_fingerprints, Configuration, Fingerprinter};

/// A segment counts as "matching" when its score (0..32 bit-diffs, smaller = closer) is below
/// this. Conservative so unrelated tracks don't accumulate coverage.
const SEGMENT_SCORE_MAX: f64 = 8.0;
/// Match when matching segments cover at least this fraction of the shorter fingerprint.
pub const MATCH_THRESHOLD: f32 = 0.6;

/// Version du PRODUCTEUR d'empreinte, stampée dans `tracks.fingerprint_ver` à chaque écriture du
/// cache (migration v22). Rien ne l'expose au frontend : elle ne sert qu'à rendre bruyant le
/// désaccord entre l'algorithme courant et une empreinte déjà en base (issue #39).
///
/// **À incrémenter dès que deux empreintes produites de part et d'autre du changement cessent
/// d'être comparables entre elles**, c'est-à-dire :
///
/// - bump de `rusty-chromaprint` (épinglé `"0.3"`, `Cargo.toml:39`) — une 0.4 peut changer la
///   représentation d'une empreinte OU la sémantique de `match_fingerprints` ;
/// - changement de `config()` (`preset_test1`), du taux ou du nombre de canaux passés à `start`,
///   ou de la conversion f32 → i16 de `compute_for_path`.
///
/// Ce qu'elle ne couvre PAS : `MATCH_THRESHOLD` et `SEGMENT_SCORE_MAX` ne changent pas la valeur
/// stockée, ils changent la DÉCISION prise dessus. Ce qu'un tel changement périme, ce sont les
/// arêtes de `dup_edges` (v19), pas cette colonne.
///
/// Sans elle rien ne tombe : le dédoublonnage compare simplement des empreintes anciennes à des
/// neuves — des choses incomparables — et le taux de doublons change sans raison affichable, sur
/// une fonction dont l'utilisateur ne peut pas vérifier le résultat à la main.
///
/// **2 depuis le 2026-10-05** : `start` reçoit le taux NATIF du fichier, et non plus 44 100 Hz en
/// dur (voir `compute_for_path`). Les empreintes de fichiers à 44,1 kHz n'ont pas changé ; la
/// migration v26 (`db.rs`) les restampe en 2 et efface les autres.
pub const FINGERPRINT_CACHE_VERSION: i64 = 2;

/// Lit le cache `(tracks.fingerprint, tracks.fingerprint_ver)`. Une version absente (NULL — une
/// ligne écrite avant la v22 que son backfill n'a pas stampée) ou différente rend `None` : un
/// DÉFAUT DE CACHE, jamais une erreur. L'appelant recalcule, exactement comme `ipc::analyze_path`
/// le fait pour `report_cache_ver`.
///
/// Passer par cette fonction plutôt que de comparer la version en SQL garde la constante en un
/// seul endroit — un littéral écrit en dur dans une requête serait précisément la seconde
/// déclaration dont le désaccord ne fait tomber personne.
pub fn cached(raw: Option<String>, ver: Option<i64>) -> Option<String> {
    match ver {
        Some(v) if v == FINGERPRINT_CACHE_VERSION => raw,
        _ => None,
    }
}

fn config() -> Configuration {
    Configuration::preset_test1()
}

/// Taux au-dessus duquel le signal est décimé avant le fingerprinter (voir `Decimation`).
const MAX_FINGERPRINT_RATE: u32 = 48_000;

/// Décimation entière, par moyenne de `facteur` échantillons, AVANT le fingerprinter.
///
/// Le rééchantillonneur interne du crate (`rubato::SincFixedIn`, `sinc_len` 16) descend vers
/// 11 025 Hz. Mesuré le 2026-10-05 sur un balayage qui monte à 20 kHz : depuis 48 kHz (rapport 4,35)
/// il rend la même empreinte (similarité 0,98) ; depuis 96 kHz (rapport 8,7) non (0,24) — un même
/// morceau en 96 kHz ne se reconnaissait pas, même au bon taux. Ramené d'abord à 48 kHz par une
/// décimation par 2, il retombe sur le cas qui marche. La moyenne de deux échantillons suffit : elle
/// coupe près de 48 kHz, là où se replierait la bande que l'empreinte lit (sous 5,5 kHz).
///
/// À 48 kHz ou moins, `facteur` vaut 1 et la conversion est IDENTIQUE à l'ancienne, à l'octet : les
/// empreintes déjà en base pour ces fichiers restent justes (migration v26).
struct Decimation {
    facteur: usize,
    somme: f32,
    n: usize,
}

impl Decimation {
    /// Le facteur (une puissance de 2) qui ramène `rate` à `MAX_FINGERPRINT_RATE` ou moins, et le
    /// taux qui en résulte : 96 000 → 48 000, 88 200 → 44 100, 192 000 → 48 000.
    fn pour(rate: u32) -> (Self, u32) {
        let mut facteur = 1u32;
        while rate / facteur > MAX_FINGERPRINT_RATE {
            facteur *= 2;
        }
        let d = Decimation {
            facteur: facteur as usize,
            somme: 0.0,
            n: 0,
        };
        (d, rate / facteur)
    }

    /// Pousse un bloc décodé (mono, f32) et rend ses échantillons i16 décimés. Le reste d'un bloc dont
    /// la taille n'est pas un multiple du facteur attend le bloc suivant.
    fn pousser(&mut self, bloc: &[f32], sortie: &mut Vec<i16>) {
        for &s in bloc {
            self.somme += s;
            self.n += 1;
            if self.n == self.facteur {
                let m = self.somme / self.facteur as f32;
                sortie.push((m * 32767.0).clamp(-32768.0, 32767.0) as i16);
                self.somme = 0.0;
                self.n = 0;
            }
        }
    }
}

/// Decode `path` to mono at its NATIVE sample rate (decimated above 48 kHz) and compute its
/// Chromaprint fingerprint (the fingerprinter resamples internally). Streams the PCM through the
/// fingerprinter (no full buffer). Errors on decode/codec failure.
pub fn compute_for_path(path: &str) -> Result<Vec<u32>, String> {
    let cfg = config();
    let mut printer = Fingerprinter::new(&cfg);
    // Le taux RÉEL du fichier : `decode_pcm` décode au taux natif sans rééchantillonner
    // (`analysis/decode.rs`), et le rééchantillonneur du crate règle son ratio sur le taux annoncé
    // ICI. Jusqu'au 2026-10-05 on annonçait 44 100 Hz pour tout : un fichier à 96 kHz donnait une
    // empreinte 2,18 fois trop longue (mesuré : 6 394 contre 2 926 items), et un même morceau à deux
    // taux ne se reconnaissait jamais au son — 19 groupes de la vraie bibliothèque, 142 pistes en 48
    // ou 96 kHz. Sur une mélodie de test, 44,1 contre 48 et 96 kHz : similarité 0 avant, 1,0 après.
    let natif = crate::analysis::decode::probe(path)?.sample_rate;
    let (mut decimation, rate) = Decimation::pour(natif);
    printer
        .start(rate, 1)
        .map_err(|e| format!("fingerprint start: {e}"))?;
    let mut tmp: Vec<i16> = Vec::with_capacity(8192);
    let info = crate::analysis::decode::decode_pcm(path, 1, |block| {
        tmp.clear();
        decimation.pousser(block, &mut tmp);
        printer.consume(&tmp);
    })?;
    if let Some(err) = info.codec_error {
        return Err(err);
    }
    printer.finish();
    let fp = printer.fingerprint().to_vec();
    if fp.is_empty() {
        return Err("empty fingerprint (audio too short?)".into());
    }
    Ok(fp)
}

/// Serialize/deserialize the fingerprint for the `tracks.fingerprint` cache column.
pub fn encode(fp: &[u32]) -> String {
    fp.iter()
        .map(|x| x.to_string())
        .collect::<Vec<_>>()
        .join(",")
}
pub fn decode(s: &str) -> Vec<u32> {
    s.split(',').filter_map(|t| t.parse::<u32>().ok()).collect()
}

/// Similarity 0..1 = fraction of the shorter fingerprint covered by well-aligned, low-score
/// segments (the crate's matcher handles offset alignment). Unrelated tracks yield little
/// covered duration; two encodes of the same recording align over most of their length.
pub fn similarity(a: &[u32], b: &[u32]) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let cfg = config();
    let segments = match match_fingerprints(a, b, &cfg) {
        Ok(s) => s,
        Err(_) => return 0.0,
    };
    let n = a.len().min(b.len()).max(1);
    let matched: usize = segments
        .iter()
        .filter(|s| s.score < SEGMENT_SCORE_MAX)
        .map(|s| s.items_count)
        .sum();
    (matched as f32 / n as f32).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Option<String> {
        let p = format!("fixtures/{name}");
        if std::path::Path::new(&p).exists() {
            Some(p)
        } else {
            None
        }
    }

    #[test]
    fn fingerprint_is_deterministic_and_self_identical() {
        let Some(p) = fixture("real_320.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let a = compute_for_path(&p).expect("fingerprint");
        let b = compute_for_path(&p).expect("fingerprint");
        assert_eq!(a, b, "same file → same fingerprint");
        assert!(similarity(&a, &b) > 0.99, "self-similarity ≈ 1");
    }

    #[test]
    fn same_source_different_encode_matches() {
        // real_320.mp3 is the 320k MP3 of real_lossless.flac — same recording, two encodings.
        // This is the core M5 promise: detect the dupe across format/name.
        let (Some(p1), Some(p2)) = (fixture("real_320.mp3"), fixture("real_lossless.flac")) else {
            eprintln!("skip: no fixtures");
            return;
        };
        let a = compute_for_path(&p1).expect("fp1");
        let b = compute_for_path(&p2).expect("fp2");
        let sim = similarity(&a, &b);
        assert!(
            sim >= MATCH_THRESHOLD,
            "same recording, different encode must match (got {sim})"
        );
    }

    /// Le même son à un autre taux d'échantillonnage DOIT se reconnaître : 19 groupes de la vraie
    /// bibliothèque opposent une copie à 44,1 kHz à une à 48 ou 96. Tant que `compute_for_path`
    /// annonçait 44 100 Hz en dur, l'empreinte sortait étirée dans le temps.
    ///
    /// Une MÉLODIE et pas le balayage des autres fixtures, et c'est mesuré : un balayage se ressemble
    /// assez à lui-même pour que l'étirement de 9 % d'un 48 kHz matche quand même (1,0 sous le bug).
    /// La mélodie, non périodique, tombe à 0 sous le bug, à 48 comme à 96 kHz.
    #[test]
    fn meme_son_a_un_autre_taux_matche() {
        for autre in ["melodie_48k.flac", "melodie_96k.flac"] {
            let (Some(p1), Some(p2)) = (fixture("melodie.flac"), fixture(autre)) else {
                eprintln!("skip: no fixtures");
                return;
            };
            let a = compute_for_path(&p1).expect("fp 44.1");
            let b = compute_for_path(&p2).expect("fp autre taux");
            let sim = similarity(&a, &b);
            assert!(
                sim >= MATCH_THRESHOLD,
                "même mélodie, {autre} contre 44,1 kHz : doit matcher (got {sim})"
            );
        }
    }

    /// Au-delà de 48 kHz, le signal est décimé avant le fingerprinter (`Decimation`) : le
    /// rééchantillonneur du crate, depuis 96 kHz, rendait une autre empreinte pour un son riche en
    /// aigus — le balayage, qui monte à 20 kHz, tombait à 0,24 au BON taux, et remonte à 1,0 décimé.
    #[test]
    fn haut_taux_decime_avant_l_empreinte() {
        let (Some(p1), Some(p2)) = (
            fixture("real_lossless.flac"),
            fixture("real_lossless_96k.flac"),
        ) else {
            eprintln!("skip: no fixtures");
            return;
        };
        let a = compute_for_path(&p1).expect("fp 44.1");
        let b = compute_for_path(&p2).expect("fp 96");
        let sim = similarity(&a, &b);
        assert!(
            sim >= MATCH_THRESHOLD,
            "même balayage à 44,1 et 96 kHz : doit matcher (got {sim})"
        );
    }

    /// Le facteur de décimation et le taux qui en résulte : rien sous 48 kHz (les empreintes en base
    /// pour ces fichiers restent justes, migration v26), une puissance de 2 au-delà.
    #[test]
    fn decimation_ramene_a_48k_ou_moins() {
        for (natif, facteur, taux) in [
            (44_100, 1, 44_100),
            (48_000, 1, 48_000),
            (88_200, 2, 44_100),
            (96_000, 2, 48_000),
            (176_400, 4, 44_100),
            (192_000, 4, 48_000),
        ] {
            let (d, r) = Decimation::pour(natif);
            assert_eq!((d.facteur, r), (facteur, taux), "taux natif {natif}");
        }
        // Facteur 1 : la conversion est celle d'avant, à l'octet.
        let (mut d, _) = Decimation::pour(44_100);
        let mut out = Vec::new();
        d.pousser(&[0.5, -0.25, 1.5], &mut out);
        assert_eq!(out, vec![16383, -8191, 32767]);
    }

    #[test]
    fn different_audio_below_threshold() {
        // sweep (real) vs a steady dual-mono tone — clearly different audio.
        let (Some(p1), Some(p2)) = (fixture("real_320.mp3"), fixture("dual_mono.wav")) else {
            eprintln!("skip: no fixtures");
            return;
        };
        let a = compute_for_path(&p1).expect("fp1");
        let b = compute_for_path(&p2).expect("fp2");
        let sim = similarity(&a, &b);
        assert!(
            sim < MATCH_THRESHOLD,
            "different audio must not match (got {sim})"
        );
    }

    #[test]
    fn encode_decode_round_trip() {
        let fp = vec![1u32, 42, 4_000_000_000];
        assert_eq!(decode(&encode(&fp)), fp);
    }

    /// Les trois états que `cached` doit distinguer, et le seul qui sert l'empreinte en base.
    /// Le cas NULL n'est pas théorique : c'est celui de toute ligne écrite avant la v22 que son
    /// backfill n'a pas stampée (empreinte vide, ou rapport lui-même périmé).
    #[test]
    fn cached_ne_sert_que_la_version_courante() {
        let fp = || Some("1,2,3".to_string());
        assert_eq!(
            cached(fp(), Some(FINGERPRINT_CACHE_VERSION)),
            fp(),
            "version courante : l'empreinte en cache doit être servie telle quelle"
        );
        assert_eq!(
            cached(fp(), None),
            None,
            "version absente (base d'avant la v22) : défaut de cache, pas une erreur"
        );
        assert_eq!(
            cached(fp(), Some(FINGERPRINT_CACHE_VERSION + 1)),
            None,
            "version différente : défaut de cache"
        );
        assert_eq!(
            cached(fp(), Some(FINGERPRINT_CACHE_VERSION - 1)),
            None,
            "une version ANCIENNE est aussi périmée — la comparaison est d'égalité, pas d'ordre"
        );
    }
}
