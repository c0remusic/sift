//! Transcoding to the CDJ rails (MP3 CBR / AIFF / WAV PCM) via the bundled ffmpeg, plus the
//! rail-based target choice, a conformance test (skip re-encoding files already in target
//! shape), and a hard no-upscale guard. The caller passes the source rail (it already has it
//! from the analysis report), so this module is independent of the analysis pipeline. ffmpeg
//! is driven exactly like `analysis/decode.rs`.
//!
//! Depuis #71 (2026-09-28), le débit et la fréquence de chaque famille de sortie sont RÉGLÉS
//! ([`EncodeProfile`], catégorie Conversion de Réglages) : `Target` ne nomme plus qu'une famille
//! (MP3, AIFF, WAV), et le profil en donne les valeurs. Le profil par défaut rend les arguments
//! ffmpeg d'avant #71 à l'identique — rien ne change tant qu'on ne règle rien.

use crate::analysis::Rail;
use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::event::{FfmpegEvent, LogLevel};
use lofty::file::AudioFile;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom, Write};

/// La FAMILLE de sortie : MP3 (rail lossy), AIFF ou WAV (rail lossless).
///
/// ⚠️ Depuis #71, les noms des variantes et leurs `db_value` (« mp3_320 », « aiff_16_44 »,
/// « wav_16_44 ») sont des IDENTIFIANTS OPAQUES, figés parce qu'ils sont stockés dans
/// `tracks.target_format` et relus par des listes SQL. Ils ne garantissent plus rien : un
/// « mp3_320 » peut être un MP3 256 kbps, un « aiff_16_44 » un AIFF 24 bits / 96 kHz — les
/// valeurs réelles viennent de l'[`EncodeProfile`] lu au rangement. Un MP3 SOURCE est de plus
/// déplacé tel quel, à son débit d'origine. Ne jamais déduire un débit ni une profondeur d'une
/// de ces chaînes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Target {
    #[serde(rename = "mp3_320")]
    Mp3320,
    #[serde(rename = "aiff_16_44")]
    Aiff1644,
    #[serde(rename = "wav_16_44")]
    Wav1644,
}

impl Target {
    /// Output file extension for this target.
    pub fn ext(self) -> &'static str {
        match self {
            Target::Mp3320 => "mp3",
            Target::Aiff1644 => "aiff",
            Target::Wav1644 => "wav",
        }
    }

    /// The rail this target belongs to (used by the no-upscale guard).
    pub fn rail(self) -> Rail {
        match self {
            Target::Mp3320 => Rail::Lossy,
            Target::Aiff1644 | Target::Wav1644 => Rail::Lossless,
        }
    }

    /// La chaîne que `tracks.target_format` stocke pour cette cible — un identifiant opaque de
    /// FAMILLE depuis #71, pas une promesse de débit ni de profondeur (voir le doc de [`Target`]).
    ///
    /// `match` EXHAUSTIF, et c'est tout l'intérêt : une variante neuve ne compile pas tant
    /// qu'elle n'a pas sa valeur de colonne. Une recherche dans une table de constantes rendrait
    /// un `Option` au site d'écriture et perdrait cette garantie. Vivait dans `filing` sous le
    /// nom `target_str` jusqu'au 2026-09-15 — une fonction libre, un seul appelant, loin du type
    /// qu'elle décrit.
    pub const fn db_value(self) -> &'static str {
        match self {
            Target::Mp3320 => "mp3_320",
            Target::Aiff1644 => "aiff_16_44",
            Target::Wav1644 => "wav_16_44",
        }
    }

    /// Chaque variante avec la chaîne que `tracks.target_format` stocke. Dérivée de
    /// [`Target::db_value`] plutôt que réécrite : les deux ne peuvent plus diverger. Sert aux
    /// appelants qui doivent relire cette colonne — et aux tests qui interdisent aux listes SQL
    /// ci-dessous de diverger de l'enum.
    pub const ALL_WITH_DB_VALUE: &'static [(Target, &'static str)] = &[
        (Target::Mp3320, Target::Mp3320.db_value()),
        (Target::Aiff1644, Target::Aiff1644.db_value()),
        (Target::Wav1644, Target::Wav1644.db_value()),
    ];

    /// Le `Target` derrière une valeur de `tracks.target_format`. `None` sur une ligne rangée
    /// avant l'ajout de la colonne, ou sur une valeur inconnue.
    pub fn from_db_value(s: &str) -> Option<Target> {
        Self::ALL_WITH_DB_VALUE
            .iter()
            .find(|(_, v)| *v == s)
            .map(|(t, _)| *t)
    }
}

/// Les valeurs de `tracks.target_format` du rail lossless, prêtes à coller derrière un `IN` SQL.
/// SQLite ne peut pas appeler `Target::rail()` : `target_sql_lists_match_the_enum` est ce qui
/// remplace l'appel. Littéraux de compilation uniquement.
pub const TARGET_LOSSLESS_SQL_IN: &str = "('aiff_16_44','wav_16_44')";

/// Idem pour le rail lossy — une seule valeur aujourd'hui, même garde.
pub const TARGET_LOSSY_SQL_IN: &str = "('mp3_320')";

/// Préfixe du refus d'un profil hors liste. Le message complet est
/// `ENCODE_PROFILE_INVALID: <champ>=<valeur>` (voir [`invalid_profile_field`]) : un protocole que
/// le front peut reconnaître, pas de la prose — il ne passe donc pas par `tr!`.
pub const ENCODE_PROFILE_INVALID: &str = "ENCODE_PROFILE_INVALID";

/// Débits MP3 CBR proposés, en kbps. Spec `docs/ui-specs/reglages.md` § Conversion.
pub const MP3_KBPS_ALLOWED: &[u32] = &[256, 320];
/// Fréquences MP3 proposées. Pas de 96 kHz : libmp3lame le refuse (mesuré, issue #71).
pub const MP3_RATE_ALLOWED: &[u32] = &[44_100, 48_000];
/// Profondeurs PCM proposées (AIFF et WAV).
pub const PCM_BITS_ALLOWED: &[u8] = &[16, 24];
/// Fréquences PCM proposées (AIFF et WAV).
pub const PCM_RATE_ALLOWED: &[u32] = &[44_100, 48_000, 96_000];

/// Le message de refus d'un champ de profil hors liste — un seul format pour la validation du
/// profil ET pour la relecture d'une valeur stockée illisible (`settings::encode_profile`).
pub fn invalid_profile_field(champ: &str, valeur: impl std::fmt::Display) -> String {
    format!("{ENCODE_PROFILE_INVALID}: {champ}={valeur}")
}

/// Les valeurs d'encodage réglées par l'utilisateur, une paire par famille de sortie (#71).
///
/// Conversion EXACTE : chaque conversion vise ces valeurs, même au-dessus de la source (un
/// 16/44,1 converti en AIFF 24/48 est suréchantillonné). Seul le lossy → lossless reste refusé,
/// par [`guard_no_upscale`]. Lu UNE fois par rangement et porté par le plan : un réglage changé
/// pendant un lot ne mélange pas deux profils.
///
/// Miroir manuel de `EncodeProfile` dans `shared/contracts.ts`, tenu par
/// `encode_profile_shape_matches_contracts_ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EncodeProfile {
    pub mp3_kbps: u32,
    pub mp3_rate: u32,
    pub aiff_bits: u8,
    pub aiff_rate: u32,
    pub wav_bits: u8,
    pub wav_rate: u32,
}

impl Default for EncodeProfile {
    /// Les valeurs d'avant #71 : MP3 320 kbps / 44,1 kHz, AIFF et WAV 16 bits / 44,1 kHz.
    fn default() -> Self {
        EncodeProfile {
            mp3_kbps: 320,
            mp3_rate: 44_100,
            aiff_bits: 16,
            aiff_rate: 44_100,
            wav_bits: 16,
            wav_rate: 44_100,
        }
    }
}

/// Refuse `valeur` si elle n'est pas dans `permises`. Jamais de correction vers la valeur la
/// plus proche : un profil hors liste est une erreur, pas une approximation.
fn check_in<T: PartialEq + std::fmt::Display>(
    champ: &str,
    valeur: T,
    permises: &[T],
) -> Result<(), String> {
    if permises.contains(&valeur) {
        Ok(())
    } else {
        Err(invalid_profile_field(champ, valeur))
    }
}

impl EncodeProfile {
    /// `Ok` si chaque champ est dans sa liste (spec § Conversion), sinon le premier champ fautif,
    /// dans l'ordre de déclaration, sous la forme `ENCODE_PROFILE_INVALID: <champ>=<valeur>`.
    pub fn validate(&self) -> Result<(), String> {
        check_in("mp3_kbps", self.mp3_kbps, MP3_KBPS_ALLOWED)?;
        check_in("mp3_rate", self.mp3_rate, MP3_RATE_ALLOWED)?;
        check_in("aiff_bits", self.aiff_bits, PCM_BITS_ALLOWED)?;
        check_in("aiff_rate", self.aiff_rate, PCM_RATE_ALLOWED)?;
        check_in("wav_bits", self.wav_bits, PCM_BITS_ALLOWED)?;
        check_in("wav_rate", self.wav_rate, PCM_RATE_ALLOWED)?;
        Ok(())
    }
}

/// Why an encode could not proceed.
#[derive(Debug, Clone, PartialEq)]
pub enum EncodeError {
    /// Refused: would fabricate lossless from a lossy source.
    Upscale,
    /// ffmpeg failed (spawn, terminal log error, or empty output).
    Ffmpeg(String),
    /// Le profil demandé sort des listes de la spec. Porte le message
    /// `ENCODE_PROFILE_INVALID: <champ>=<valeur>` tel quel.
    InvalidProfile(String),
    /// ffmpeg a écrit le WAV, mais sa réécriture en WAVE_FORMAT_PCM a échoué. Le fichier produit
    /// est supprimé : un WAV EXTENSIBLE rangé serait refusé par les anciennes platines.
    WavHeader(String),
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncodeError::Upscale => write!(f, "refused: cannot upscale lossy to lossless"),
            EncodeError::Ffmpeg(m) => write!(f, "ffmpeg: {m}"),
            EncodeError::InvalidProfile(m) => f.write_str(m),
            EncodeError::WavHeader(m) => write!(f, "wav header: {m}"),
        }
    }
}

/// Rail-based default target. Lossless → AIFF; everything else (lossy/unknown) → MP3 (never
/// crosses up into lossless on its own).
pub fn target_for(rail: Rail) -> Target {
    match rail {
        Rail::Lossless => Target::Aiff1644,
        _ => Target::Mp3320,
    }
}

/// Reject a target that would upscale a lossy source into a lossless container.
pub fn guard_no_upscale(source_rail: Rail, target: Target) -> Result<(), EncodeError> {
    if source_rail == Rail::Lossy && target.rail() == Rail::Lossless {
        return Err(EncodeError::Upscale);
    }
    Ok(())
}

/// Lowercased file extension (no dot), or "" when absent.
fn ext_of(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// True when `path` is already in `target` shape FOR THIS PROFILE, so filing can tag+move
/// without re-encoding.
///
/// - MP3 : toujours conforme dès que la source est un MP3, quel que soit son débit ou sa
///   fréquence — un MP3 source est déplacé tel quel, jamais réencodé (spec #71 : le réencoder vers
///   320 fabriquerait un fichier que le verdict classe FAUX). Un AAC / OGG / Opus n'est PAS
///   conforme : il est converti en MP3 aux valeurs du profil.
/// - AIFF / WAV : conforme seulement si le conteneur est le bon ET que profondeur ET fréquence
///   égalent celles du profil. Un AIFF 16/44,1 face à un profil AIFF 24/48 est donc converti.
pub fn is_conformant(path: &str, target: Target, profile: &EncodeProfile) -> bool {
    let ext = ext_of(path);
    let pcm_matches = |containers: &[&str], bits: u8, rate: u32| -> bool {
        if !containers.contains(&ext.as_str()) {
            return false;
        }
        match Probe::open(path).and_then(|p| p.read()) {
            Ok(t) => {
                let props = t.properties();
                props.sample_rate() == Some(rate) && props.bit_depth() == Some(bits)
            }
            Err(_) => false,
        }
    };
    match target {
        Target::Mp3320 => ext == "mp3",
        Target::Aiff1644 => pcm_matches(&["aif", "aiff"], profile.aiff_bits, profile.aiff_rate),
        // Un WAV n'est conforme QU'EN WAVE_FORMAT_PCM. Un EXTENSIBLE à la bonne profondeur et à la
        // bonne fréquence était déplacé tel quel, avec l'en-tête que les anciennes CDJ refusent —
        // celui que #71 réécrit après encodage (relecture). Il est désormais réencodé : de PCM à
        // PCM, c'est sans perte, et la sortie passe par la réécriture.
        Target::Wav1644 => {
            pcm_matches(&["wav"], profile.wav_bits, profile.wav_rate)
                && wav_format_tag(path) == Ok(WAVE_FORMAT_PCM)
        }
    }
}

/// Le `wFormatTag` du chunk fmt d'un WAV, sans rien réécrire.
fn wav_format_tag(path: &str) -> Result<u16, String> {
    let mut f = std::fs::File::open(path).map_err(|e| format!("ouverture: {e}"))?;
    let file_len = f.metadata().map_err(|e| format!("stat: {e}"))?.len();
    let mut riff = [0u8; 12];
    f.read_exact(&mut riff)
        .map_err(|e| format!("en-tête RIFF: {e}"))?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err("pas un fichier RIFF/WAVE".into());
    }
    let mut pos = 12u64;
    while pos + 8 <= file_len {
        f.seek(SeekFrom::Start(pos))
            .map_err(|e| format!("seek: {e}"))?;
        let mut hdr = [0u8; 8];
        f.read_exact(&mut hdr)
            .map_err(|e| format!("en-tête de chunk: {e}"))?;
        let size = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        if &hdr[0..4] == b"fmt " {
            let mut tag = [0u8; 2];
            f.read_exact(&mut tag)
                .map_err(|e| format!("lecture fmt: {e}"))?;
            return Ok(u16::from_le_bytes(tag));
        }
        pos += 8 + u64::from(size) + u64::from(size & 1);
    }
    Err("aucun chunk fmt".into())
}

/// Les arguments ffmpeg de sortie pour `target` au `profile` donné. PURE : aucune validation
/// (c'est le rôle de [`EncodeProfile::validate`], appelée par [`encode_with`]).
///
/// Le profil par défaut rend EXACTEMENT les arguments d'avant #71 (gelé par
/// `codec_args_du_profil_par_defaut_sont_ceux_d_avant_71`). Profondeur 24 → `pcm_s24be` (AIFF,
/// qui sort bien en `AIFF` et pas en `AIFC`) ou `pcm_s24le` (WAV, dont l'en-tête est ensuite
/// réécrit par [`wav_extensible_to_pcm`]).
pub fn codec_args(target: Target, profile: &EncodeProfile) -> Vec<String> {
    let (codec, rate, bitrate) = match target {
        Target::Mp3320 => (
            "libmp3lame".to_string(),
            profile.mp3_rate,
            Some(profile.mp3_kbps),
        ),
        Target::Aiff1644 => (
            format!("pcm_s{}be", profile.aiff_bits),
            profile.aiff_rate,
            None,
        ),
        Target::Wav1644 => (
            format!("pcm_s{}le", profile.wav_bits),
            profile.wav_rate,
            None,
        ),
    };
    let mut args = vec!["-vn".to_string(), "-c:a".to_string(), codec];
    if let Some(kbps) = bitrate {
        args.push("-b:a".to_string());
        args.push(format!("{kbps}k"));
    }
    args.push("-ar".to_string());
    args.push(rate.to_string());
    args
}

/// Transcode `src` into `dst` for `target` at the DEFAULT profile — l'enveloppe d'avant #71,
/// gardée pour l'aperçu de lecture (`ipc.rs`) et les bancs, qui ne dépendent pas des réglages.
/// Le rangement passe par [`encode_with`] avec le profil lu dans les réglages.
pub fn encode(src: &str, dst: &str, target: Target) -> Result<(), EncodeError> {
    encode_with(src, dst, target, &EncodeProfile::default())
}

/// Transcode `src` into `dst` for `target` at `profile`, overwriting `dst`. Refuses a profile
/// out of the spec lists before spawning anything, surfaces any terminal ffmpeg error and
/// refuses to report success on an empty/missing output. Does NOT apply the no-upscale guard —
/// callers guard before choosing a lossless target.
///
/// WAV : ffmpeg écrit un en-tête WAVE_FORMAT_EXTENSIBLE dès que la profondeur dépasse 16 bits OU
/// que la fréquence dépasse 48 kHz (mesuré sur le ffmpeg embarqué : 24/44,1, 16/96 et 24/96 sortent
/// `FE FF`, 16/44,1 et 16/48 sortent `01 00`), et son muxer n'a aucune option pour l'éviter. Les
/// anciennes CDJ refusent ce format (`docs/cdj-metadata-formats.md`) : il est réécrit en
/// WAVE_FORMAT_PCM ici, avant que quiconque ne voie le fichier. Échec de réécriture = fichier
/// supprimé et erreur, jamais un WAV EXTENSIBLE rendu comme un succès.
pub fn encode_with(
    src: &str,
    dst: &str,
    target: Target,
    profile: &EncodeProfile,
) -> Result<(), EncodeError> {
    profile.validate().map_err(EncodeError::InvalidProfile)?;
    let codec_args = codec_args(target, profile);
    // Un échec de ffmpeg peut survenir APRÈS l'écriture de la sortie : un FLAC abîmé au milieu fait
    // journaliser `[error] invalid residual` à ffmpeg, qui sort pourtant en 0 avec un fichier complet
    // (mesuré sur le binaire embarqué, relecture de #71). `run_ffmpeg` rend alors Err, et le fichier
    // restait orphelin dans le dossier de destination, hors base — le rangement suivant posait
    // « … (2).aiff » à côté. Toute sortie d'un encodage raté est retirée.
    if let Err(e) = run_ffmpeg(src, dst, &codec_args) {
        remove_failed_output(dst);
        return Err(e);
    }
    if target == Target::Wav1644 {
        if let Err(e) = wav_extensible_to_pcm(dst) {
            remove_failed_output(dst);
            return Err(EncodeError::WavHeader(e));
        }
    }
    Ok(())
}

/// Retire la sortie d'un encodage raté. Absente = rien à faire ; impossible à retirer = journalisé,
/// et l'erreur d'encodage reste celle que l'appelant reçoit.
fn remove_failed_output(dst: &str) {
    match std::fs::remove_file(dst) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => log::error!(
            "encode_with: suppression de la sortie ratée {dst} impossible, elle reste sur le disque: {e}"
        ),
    }
}

/// Lance ffmpeg `src` → `dst` avec `codec_args`, sans aucun post-traitement.
fn run_ffmpeg(src: &str, dst: &str, codec_args: &[String]) -> Result<(), EncodeError> {
    // `new_with_path` et pas `new()` : `new()` résout par adjacence à `current_exe()`, ce qui
    // est correct en release mais retombe sur le PATH système sous `cargo test`, où l'exécutable
    // courant vit dans `deps/`. Voir le doc de tête de `crate::ffmpeg`.
    let mut child = FfmpegCommand::new_with_path(crate::ffmpeg::chemin())
        .input(src)
        .args(codec_args)
        .arg("-y")
        .output(dst)
        .spawn()
        .map_err(|e| EncodeError::Ffmpeg(format!("spawn failed: {e}")))?;

    let iter = child
        .iter()
        .map_err(|e| EncodeError::Ffmpeg(format!("iter failed: {e}")))?;

    let mut err: Option<String> = None;
    for ev in iter {
        match ev {
            FfmpegEvent::Log(LogLevel::Error, msg) => {
                err.get_or_insert(msg); // keep the FIRST error (usually the most informative)
            }
            // ffmpeg-sidecar emits this synthetic event whenever no output stream is routed
            // to stdout — always the case for file output. Not a real failure; the
            // output-file check below is the source of truth.
            FfmpegEvent::Error(msg) if msg != "No streams found" => {
                err.get_or_insert(msg);
            }
            _ => {}
        }
    }
    let _ = child.wait();

    if let Some(e) = err {
        return Err(EncodeError::Ffmpeg(e));
    }
    match std::fs::metadata(dst) {
        Ok(m) if m.len() > 0 => Ok(()),
        _ => Err(EncodeError::Ffmpeg("no output produced".into())),
    }
}

/// `wFormatTag` d'un fmt WAVE_FORMAT_PCM.
const WAVE_FORMAT_PCM: u16 = 0x0001;
/// `wFormatTag` d'un fmt WAVE_FORMAT_EXTENSIBLE.
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
/// Le GUID du sous-format PCM d'un fmt EXTENSIBLE (`KSDATAFORMAT_SUBTYPE_PCM`,
/// 00000001-0000-0010-8000-00AA00389B71), tel qu'il est rangé sur le disque.
const KSDATAFORMAT_SUBTYPE_PCM: [u8; 16] = [
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71,
];

/// Un chunk RIFF repéré dans le fichier : son identifiant, l'offset de son corps, sa taille
/// déclarée (sans l'octet de bourrage).
struct RiffChunk {
    id: [u8; 4],
    body: u64,
    size: u32,
}

/// Réécrit un WAV WAVE_FORMAT_EXTENSIBLE à sous-format PCM en WAVE_FORMAT_PCM (fmt de 16 octets,
/// `wFormatTag` = 1). Tailles RIFF recalculées, autres chunks recopiés dans l'ordre, octet pour
/// octet — les données audio ne sont pas touchées. Passe par un fichier temporaire du MÊME
/// dossier puis un renommage : le fichier d'origine n'est jamais à moitié réécrit.
///
/// `Ok(false)` : déjà en WAVE_FORMAT_PCM, fichier inchangé. `Ok(true)` : réécrit. `Err` : tout
/// ce qui ne se réécrit pas sans perte (sous-format non PCM, `wValidBitsPerSample` différent de
/// `wBitsPerSample`, format inconnu, chunk qui déborde du fichier) — le fichier est alors laissé
/// tel quel, et c'est à l'appelant de décider (`encode_with` le supprime).
fn wav_extensible_to_pcm(path: &str) -> Result<bool, String> {
    let io = |ctx: &str, e: std::io::Error| format!("{ctx}: {e}");
    let mut f = std::fs::File::open(path).map_err(|e| io("ouverture", e))?;
    let file_len = f.metadata().map_err(|e| io("stat", e))?.len();

    let mut riff = [0u8; 12];
    f.read_exact(&mut riff).map_err(|e| io("en-tête RIFF", e))?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err("pas un fichier RIFF/WAVE".into());
    }
    let declared = u32::from_le_bytes([riff[4], riff[5], riff[6], riff[7]]);
    // La taille déclarée borne la liste des chunks ; au-delà, ce qui suit n'appartient pas au RIFF.
    let end = file_len.min(u64::from(declared) + 8);

    let mut chunks = Vec::new();
    let mut pos = 12u64;
    while pos + 8 <= end {
        f.seek(SeekFrom::Start(pos)).map_err(|e| io("seek", e))?;
        let mut hdr = [0u8; 8];
        f.read_exact(&mut hdr)
            .map_err(|e| io("en-tête de chunk", e))?;
        let id = [hdr[0], hdr[1], hdr[2], hdr[3]];
        let size = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        let body = pos + 8;
        if body + u64::from(size) > file_len {
            return Err(format!(
                "le chunk {} déclare {size} octets et déborde du fichier",
                String::from_utf8_lossy(&id)
            ));
        }
        chunks.push(RiffChunk { id, body, size });
        pos = body + u64::from(size) + u64::from(size & 1);
    }

    let fmt = chunks
        .iter()
        .find(|c| &c.id == b"fmt ")
        .ok_or("aucun chunk fmt")?;
    if fmt.size < 16 {
        return Err(format!("chunk fmt trop court ({} octets)", fmt.size));
    }
    let mut fmt_body = vec![0u8; fmt.size as usize];
    f.seek(SeekFrom::Start(fmt.body))
        .map_err(|e| io("seek fmt", e))?;
    f.read_exact(&mut fmt_body)
        .map_err(|e| io("lecture fmt", e))?;

    let tag = u16::from_le_bytes([fmt_body[0], fmt_body[1]]);
    if tag == WAVE_FORMAT_PCM {
        return Ok(false);
    }
    if tag != WAVE_FORMAT_EXTENSIBLE {
        return Err(format!("format WAV inattendu {tag:#06x}"));
    }
    if fmt_body.len() < 40 {
        return Err(format!(
            "fmt EXTENSIBLE trop court ({} octets)",
            fmt_body.len()
        ));
    }
    let bits = u16::from_le_bytes([fmt_body[14], fmt_body[15]]);
    let valid_bits = u16::from_le_bytes([fmt_body[18], fmt_body[19]]);
    if fmt_body[24..40] != KSDATAFORMAT_SUBTYPE_PCM {
        return Err("sous-format EXTENSIBLE non PCM".into());
    }
    // Un conteneur 32 bits portant 24 bits utiles ne se dit pas en WAVE_FORMAT_PCM : la
    // réécriture perdrait l'information. Jamais le cas d'un `pcm_s16le` / `pcm_s24le` ffmpeg.
    if valid_bits != 0 && valid_bits != bits {
        return Err(format!(
            "wValidBitsPerSample {valid_bits} différent de wBitsPerSample {bits}"
        ));
    }
    let mut pcm_fmt = [0u8; 16];
    pcm_fmt.copy_from_slice(&fmt_body[0..16]);
    pcm_fmt[0..2].copy_from_slice(&WAVE_FORMAT_PCM.to_le_bytes());

    // Taille RIFF du fichier réécrit : « WAVE » + chaque chunk (en-tête, corps, bourrage).
    let mut riff_size: u64 = 4;
    for c in &chunks {
        let body = if &c.id == b"fmt " {
            pcm_fmt.len() as u64
        } else {
            u64::from(c.size)
        };
        riff_size += 8 + body + (body & 1);
    }
    let riff_size =
        u32::try_from(riff_size).map_err(|_| format!("taille RIFF {riff_size} hors u32"))?;

    let dir = std::path::Path::new(path)
        .parent()
        .ok_or("le WAV n'a pas de dossier parent")?;
    let tmp = tempfile::Builder::new()
        .prefix(".sift-wav-")
        .suffix(".tmp")
        .tempfile_in(dir)
        .map_err(|e| io("fichier temporaire", e))?;
    {
        let mut w = std::io::BufWriter::new(tmp.as_file());
        let mut entete = Vec::with_capacity(12);
        entete.extend_from_slice(b"RIFF");
        entete.extend_from_slice(&riff_size.to_le_bytes());
        entete.extend_from_slice(b"WAVE");
        w.write_all(&entete).map_err(|e| io("écriture RIFF", e))?;
        for c in &chunks {
            if &c.id == b"fmt " {
                let mut chunk = Vec::with_capacity(8 + pcm_fmt.len());
                chunk.extend_from_slice(b"fmt ");
                chunk.extend_from_slice(&(pcm_fmt.len() as u32).to_le_bytes());
                chunk.extend_from_slice(&pcm_fmt);
                w.write_all(&chunk).map_err(|e| io("écriture fmt", e))?;
                continue;
            }
            let mut hdr = [0u8; 8];
            hdr[0..4].copy_from_slice(&c.id);
            hdr[4..8].copy_from_slice(&c.size.to_le_bytes());
            w.write_all(&hdr).map_err(|e| io("écriture de chunk", e))?;
            f.seek(SeekFrom::Start(c.body))
                .map_err(|e| io("seek chunk", e))?;
            let copied = std::io::copy(&mut (&mut f).take(u64::from(c.size)), &mut w)
                .map_err(|e| io("copie de chunk", e))?;
            if copied != u64::from(c.size) {
                return Err(format!(
                    "chunk {} tronqué : {copied} octets copiés sur {}",
                    String::from_utf8_lossy(&c.id),
                    c.size
                ));
            }
            if c.size & 1 == 1 {
                w.write_all(&[0]).map_err(|e| io("bourrage", e))?;
            }
        }
        w.flush().map_err(|e| io("flush", e))?;
    }
    tmp.as_file().sync_all().map_err(|e| io("sync", e))?;
    // Les permissions de l'original, pas celles du fichier temporaire : sous Unix, `tempfile` crée
    // en 0600, et un WAV rangé sur un Mac devenait illisible pour un autre compte ou un serveur
    // multimédia (relecture de #71). Sous Windows, seul l'attribut lecture seule voyage.
    let perms = f
        .metadata()
        .map_err(|e| io("permissions", e))?
        .permissions();
    tmp.as_file()
        .set_permissions(perms)
        .map_err(|e| io("permissions du temporaire", e))?;
    drop(f);
    tmp.persist(path)
        .map_err(|e| format!("remplacement du WAV: {}", e.error))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les deux listes SQL sont la seule façon pour SQLite de connaître la règle
    /// `Target::rail()`. Ce test est ce qui remplace l'appel : ajouter une variante à l'enum sans
    /// la classer ici casse ici, pas plus tard sur un compteur faux. Il vérifie les DEUX sens —
    /// toute variante doit apparaître dans exactement une des deux listes, et toute entrée d'une
    /// liste doit être du bon rail.
    #[test]
    fn target_sql_lists_match_the_enum() {
        for (t, db) in Target::ALL_WITH_DB_VALUE {
            let quoted = format!("'{db}'");
            let in_lossless = TARGET_LOSSLESS_SQL_IN.contains(&quoted);
            let in_lossy = TARGET_LOSSY_SQL_IN.contains(&quoted);
            assert!(
                in_lossless ^ in_lossy,
                "{db} doit être dans exactement une des deux listes SQL"
            );
            assert_eq!(
                in_lossless,
                t.rail() == Rail::Lossless,
                "{db} est classe a l'envers par rapport a Target::rail()"
            );
            assert_eq!(Target::from_db_value(db), Some(*t));
        }
        // Et aucune des listes ne contient de valeur qui ne soit pas une variante.
        let known: usize = Target::ALL_WITH_DB_VALUE.len();
        let listed = TARGET_LOSSLESS_SQL_IN.matches('\'').count() / 2
            + TARGET_LOSSY_SQL_IN.matches('\'').count() / 2;
        assert_eq!(listed, known, "une liste SQL contient une valeur inconnue");
        assert_eq!(Target::from_db_value("aiff_24_96"), None);
    }

    fn fixture(name: &str) -> Option<String> {
        let p = format!("fixtures/{name}");
        if std::path::Path::new(&p).exists() {
            Some(p)
        } else {
            None
        }
    }

    /// Relecture de #71 : un FLAC abîmé au milieu fait écrire la sortie PUIS journaliser `[error]`
    /// à ffmpeg (mesuré : sortie de 1,76 Mo, trois lignes d'erreur, code 0). L'encodage rend Err ET
    /// ne laisse aucun fichier derrière lui.
    #[test]
    fn un_encodage_rate_ne_laisse_pas_d_orphelin() {
        let Some(src) = fixture("real_lossless.flac") else {
            eprintln!("skip: no fixture");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let abime = dir.path().join("abime.flac");
        let mut data = std::fs::read(&src).unwrap();
        let mid = data.len() / 2;
        for i in 0..600usize {
            data[mid + i] = ((i * 37 + 11) & 0xFF) as u8;
        }
        std::fs::write(&abime, &data).unwrap();
        let dst = dir.path().join("sortie.aiff");
        let r = encode_with(
            abime.to_str().unwrap(),
            dst.to_str().unwrap(),
            Target::Aiff1644,
            &EncodeProfile::default(),
        );
        assert!(
            r.is_err(),
            "ffmpeg a journalisé une erreur : l'encodage doit échouer"
        );
        assert!(
            !dst.exists(),
            "la sortie d'un encodage raté ne doit pas rester sur le disque"
        );
    }

    /// Relecture de #71 : un WAV EXTENSIBLE à la bonne profondeur et à la bonne fréquence n'est PAS
    /// conforme — déplacé tel quel, il garderait l'en-tête que les anciennes CDJ refusent. Réécrit en
    /// WAVE_FORMAT_PCM, il le devient.
    #[test]
    fn un_wav_extensible_n_est_pas_conforme_meme_au_bon_profil() {
        let Some(src) = fixture("real_lossless.flac") else {
            eprintln!("skip: no fixture");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("hi-res.wav");
        let profile = EncodeProfile {
            wav_bits: 24,
            ..EncodeProfile::default()
        };
        // `run_ffmpeg` seul : la sortie garde l'en-tête EXTENSIBLE que ffmpeg pose en 24 bits.
        run_ffmpeg(
            &src,
            wav.to_str().unwrap(),
            &codec_args(Target::Wav1644, &profile),
        )
        .unwrap();
        let p = wav.to_str().unwrap();
        assert_eq!(wav_format_tag(p), Ok(WAVE_FORMAT_EXTENSIBLE));
        assert!(!is_conformant(p, Target::Wav1644, &profile));
        assert!(wav_extensible_to_pcm(p).unwrap());
        assert!(is_conformant(p, Target::Wav1644, &profile));
    }

    /// A missing fixture quietly `return`s a "passing" test on a dev machine without
    /// `fixtures/` checked out — but in CI a missing fixture means the checkout is broken, not
    /// a supported skip, and must fail loudly instead of reporting a false green (FIX-16).
    fn skip_if_no_fixture(name: &str) {
        eprintln!("skip: no fixture ({name})");
        if std::env::var("CI").is_ok() {
            panic!(
                "fixture missing in CI: fixtures/{name} — checkout is broken, not a supported skip"
            );
        }
    }

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    /// Le profil par défaut doit rendre, à l'octet, les arguments figés d'avant #71 — c'est la
    /// promesse « rien ne change tant qu'on ne règle rien ». Littéraux recopiés de l'ancien
    /// `encode()`, pas recalculés.
    #[test]
    fn codec_args_du_profil_par_defaut_sont_ceux_d_avant_71() {
        let d = EncodeProfile::default();
        assert_eq!(
            codec_args(Target::Mp3320, &d),
            strings(&["-vn", "-c:a", "libmp3lame", "-b:a", "320k", "-ar", "44100"])
        );
        assert_eq!(
            codec_args(Target::Aiff1644, &d),
            strings(&["-vn", "-c:a", "pcm_s16be", "-ar", "44100"])
        );
        assert_eq!(
            codec_args(Target::Wav1644, &d),
            strings(&["-vn", "-c:a", "pcm_s16le", "-ar", "44100"])
        );
    }

    /// Chaque champ du profil atteint l'argument ffmpeg de SA famille, et d'elle seule.
    #[test]
    fn codec_args_suivent_le_profil() {
        let p = EncodeProfile {
            mp3_kbps: 256,
            mp3_rate: 48_000,
            aiff_bits: 24,
            aiff_rate: 96_000,
            wav_bits: 24,
            wav_rate: 48_000,
        };
        assert_eq!(
            codec_args(Target::Mp3320, &p),
            strings(&["-vn", "-c:a", "libmp3lame", "-b:a", "256k", "-ar", "48000"])
        );
        assert_eq!(
            codec_args(Target::Aiff1644, &p),
            strings(&["-vn", "-c:a", "pcm_s24be", "-ar", "96000"])
        );
        assert_eq!(
            codec_args(Target::Wav1644, &p),
            strings(&["-vn", "-c:a", "pcm_s24le", "-ar", "48000"])
        );
        // Les familles ne se lisent pas l'une l'autre : un WAV 16/44,1 à côté d'un AIFF 24/96 et
        // d'un MP3 à 48 kHz — chaque famille garde SES valeurs.
        let q = EncodeProfile {
            wav_bits: 16,
            wav_rate: 44_100,
            ..p
        };
        assert_eq!(
            codec_args(Target::Wav1644, &q),
            strings(&["-vn", "-c:a", "pcm_s16le", "-ar", "44100"])
        );
        assert_eq!(
            codec_args(Target::Aiff1644, &q),
            strings(&["-vn", "-c:a", "pcm_s24be", "-ar", "96000"])
        );
        assert_eq!(
            codec_args(Target::Mp3320, &q),
            strings(&["-vn", "-c:a", "libmp3lame", "-b:a", "256k", "-ar", "48000"])
        );
    }

    #[test]
    fn le_profil_par_defaut_est_celui_de_la_spec() {
        let EncodeProfile {
            mp3_kbps,
            mp3_rate,
            aiff_bits,
            aiff_rate,
            wav_bits,
            wav_rate,
        } = EncodeProfile::default();
        assert_eq!(
            (mp3_kbps, mp3_rate, aiff_bits, aiff_rate, wav_bits, wav_rate),
            (320, 44_100, 16, 44_100, 16, 44_100)
        );
        assert_eq!(EncodeProfile::default().validate(), Ok(()));
    }

    /// Chaque valeur de chaque liste passe ; chaque valeur hors liste est refusée avec le nom de
    /// SON champ et la valeur telle quelle — jamais corrigée vers une voisine.
    #[test]
    fn validate_refuse_chaque_valeur_hors_liste() {
        let d = EncodeProfile::default();
        for &v in MP3_KBPS_ALLOWED {
            assert_eq!(EncodeProfile { mp3_kbps: v, ..d }.validate(), Ok(()));
        }
        for &v in MP3_RATE_ALLOWED {
            assert_eq!(EncodeProfile { mp3_rate: v, ..d }.validate(), Ok(()));
        }
        for &v in PCM_BITS_ALLOWED {
            assert_eq!(EncodeProfile { aiff_bits: v, ..d }.validate(), Ok(()));
            assert_eq!(EncodeProfile { wav_bits: v, ..d }.validate(), Ok(()));
        }
        for &v in PCM_RATE_ALLOWED {
            assert_eq!(EncodeProfile { aiff_rate: v, ..d }.validate(), Ok(()));
            assert_eq!(EncodeProfile { wav_rate: v, ..d }.validate(), Ok(()));
        }

        let refus = |p: EncodeProfile, attendu: &str| {
            assert_eq!(p.validate(), Err(attendu.to_string()));
        };
        refus(
            EncodeProfile { mp3_kbps: 128, ..d },
            "ENCODE_PROFILE_INVALID: mp3_kbps=128",
        );
        refus(
            EncodeProfile { mp3_kbps: 0, ..d },
            "ENCODE_PROFILE_INVALID: mp3_kbps=0",
        );
        refus(
            EncodeProfile {
                mp3_rate: 96_000,
                ..d
            },
            "ENCODE_PROFILE_INVALID: mp3_rate=96000",
        );
        refus(
            EncodeProfile {
                mp3_rate: 32_000,
                ..d
            },
            "ENCODE_PROFILE_INVALID: mp3_rate=32000",
        );
        refus(
            EncodeProfile { aiff_bits: 20, ..d },
            "ENCODE_PROFILE_INVALID: aiff_bits=20",
        );
        refus(
            EncodeProfile { aiff_bits: 32, ..d },
            "ENCODE_PROFILE_INVALID: aiff_bits=32",
        );
        refus(
            EncodeProfile {
                aiff_rate: 88_200,
                ..d
            },
            "ENCODE_PROFILE_INVALID: aiff_rate=88200",
        );
        refus(
            EncodeProfile { wav_bits: 8, ..d },
            "ENCODE_PROFILE_INVALID: wav_bits=8",
        );
        refus(
            EncodeProfile {
                wav_rate: 22_050,
                ..d
            },
            "ENCODE_PROFILE_INVALID: wav_rate=22050",
        );
    }

    /// `encode_with` refuse un profil hors liste AVANT de lancer ffmpeg : sans cette garde, un
    /// `mp3_kbps` de 128 produirait un MP3 128 kbps sans un mot, puisque libmp3lame l'accepte.
    #[test]
    fn encode_with_refuse_un_profil_hors_liste_sans_rien_ecrire() {
        let dir = tempfile::tempdir().unwrap();
        let dst = dir.path().join("out.mp3");
        let dst = dst.to_str().unwrap();
        let p = EncodeProfile {
            mp3_kbps: 128,
            ..EncodeProfile::default()
        };
        assert_eq!(
            encode_with("n/importe/quoi.flac", dst, Target::Mp3320, &p),
            Err(EncodeError::InvalidProfile(
                "ENCODE_PROFILE_INVALID: mp3_kbps=128".into()
            ))
        );
        assert!(!std::path::Path::new(dst).exists());
    }

    /// Mirrors shared/contracts.ts's `EncodeProfile`. Exhaustive destructure (no `..`): fails to
    /// compile if a field is added/removed/renamed on the Rust struct — the forcing function to
    /// also update contracts.ts. Comme les autres tests de forme, il ne voit PAS un désaccord de
    /// type avec le miroir TS, seulement un champ manquant.
    #[test]
    fn encode_profile_shape_matches_contracts_ts() {
        let v = EncodeProfile::default();
        let EncodeProfile {
            mp3_kbps,
            mp3_rate,
            aiff_bits,
            aiff_rate,
            wav_bits,
            wav_rate,
        } = v;
        let _ = (mp3_kbps, mp3_rate, aiff_bits, aiff_rate, wav_bits, wav_rate);
    }

    /// Le profil traverse l'IPC en JSON aux noms de champ Rust tels quels (snake_case) : c'est ce
    /// que `invoke("set_encode_profile", { profile })` envoie et ce que le front relit.
    #[test]
    fn encode_profile_voyage_en_snake_case() {
        let json = serde_json::to_value(EncodeProfile::default()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "mp3_kbps": 320, "mp3_rate": 44100,
                "aiff_bits": 16, "aiff_rate": 44100,
                "wav_bits": 16, "wav_rate": 44100
            })
        );
        let back: EncodeProfile = serde_json::from_value(json).unwrap();
        assert_eq!(back, EncodeProfile::default());
    }

    #[test]
    fn target_follows_rail() {
        assert_eq!(target_for(Rail::Lossless), Target::Aiff1644);
        assert_eq!(target_for(Rail::Lossy), Target::Mp3320);
        assert_eq!(target_for(Rail::Unknown), Target::Mp3320);
    }

    #[test]
    fn target_ext_matches() {
        assert_eq!(Target::Mp3320.ext(), "mp3");
        assert_eq!(Target::Aiff1644.ext(), "aiff");
        assert_eq!(Target::Wav1644.ext(), "wav");
        assert_eq!(Target::Wav1644.rail(), Rail::Lossless);
    }

    #[test]
    fn encodes_flac_to_conformant_wav() {
        let Some(src) = fixture("real_lossless.flac") else {
            skip_if_no_fixture("real_lossless.flac");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let dst = dir.path().join("out.wav");
        let dst = dst.to_str().unwrap();
        encode(&src, dst, Target::Wav1644).expect("encode wav");
        assert!(
            is_conformant(dst, Target::Wav1644, &EncodeProfile::default()),
            "encoded WAV must be 16-bit/44.1"
        );
    }

    #[test]
    fn guard_blocks_lossy_to_lossless_only() {
        assert_eq!(
            guard_no_upscale(Rail::Lossy, Target::Aiff1644),
            Err(EncodeError::Upscale)
        );
        assert!(guard_no_upscale(Rail::Lossy, Target::Mp3320).is_ok());
        assert!(guard_no_upscale(Rail::Lossless, Target::Aiff1644).is_ok());
        assert!(guard_no_upscale(Rail::Lossless, Target::Mp3320).is_ok()); // downscale allowed
    }

    #[test]
    fn mp3_is_conformant_to_mp3_target() {
        let Some(p) = fixture("real_320.mp3") else {
            skip_if_no_fixture("real_320.mp3");
            return;
        };
        assert!(is_conformant(&p, Target::Mp3320, &EncodeProfile::default()));
    }

    /// Un MP3 source est déplacé tel quel QUEL QUE SOIT le profil MP3 (spec #71) : le réencoder
    /// vers 256 ou 48 kHz fabriquerait un fichier que le verdict classe FAUX. Un AAC / OGG / Opus
    /// n'est jamais conforme à la cible MP3 : il est converti aux valeurs du profil.
    #[test]
    fn un_mp3_reste_conforme_a_tout_profil_mp3_et_un_autre_lossy_jamais() {
        let autre = EncodeProfile {
            mp3_kbps: 256,
            mp3_rate: 48_000,
            ..EncodeProfile::default()
        };
        for lossy in ["x.m4a", "x.aac", "x.ogg", "x.opus"] {
            assert!(!is_conformant(lossy, Target::Mp3320, &autre), "{lossy}");
            assert!(
                !is_conformant(lossy, Target::Mp3320, &EncodeProfile::default()),
                "{lossy}"
            );
        }
        let Some(p) = fixture("real_320.mp3") else {
            skip_if_no_fixture("real_320.mp3");
            return;
        };
        assert!(is_conformant(&p, Target::Mp3320, &autre));
    }

    #[test]
    fn flac_is_not_conformant_to_either_target() {
        let Some(p) = fixture("real_lossless.flac") else {
            skip_if_no_fixture("real_lossless.flac");
            return;
        };
        let d = EncodeProfile::default();
        assert!(!is_conformant(&p, Target::Mp3320, &d)); // wrong codec
        assert!(!is_conformant(&p, Target::Aiff1644, &d)); // wrong container
    }

    /// AIFF et WAV ne sont conformes que si profondeur ET fréquence égalent celles du profil —
    /// chacune des deux seule suffit à forcer la conversion. Témoin : le même fichier est conforme
    /// au profil qui l'a produit.
    #[test]
    fn la_conformite_pcm_suit_la_profondeur_et_la_frequence_du_profil() {
        let Some(src) = fixture("real_lossless.flac") else {
            skip_if_no_fixture("real_lossless.flac");
            return;
        };
        let d = EncodeProfile::default();
        let dir = tempfile::tempdir().unwrap();

        let aiff = dir.path().join("d.aiff");
        let aiff = aiff.to_str().unwrap();
        encode(&src, aiff, Target::Aiff1644).expect("encode aiff");
        assert!(is_conformant(aiff, Target::Aiff1644, &d));
        assert!(!is_conformant(
            aiff,
            Target::Aiff1644,
            &EncodeProfile { aiff_bits: 24, ..d }
        ));
        assert!(!is_conformant(
            aiff,
            Target::Aiff1644,
            &EncodeProfile {
                aiff_rate: 48_000,
                ..d
            }
        ));
        // Le profil WAV ne décide pas d'un AIFF.
        assert!(is_conformant(
            aiff,
            Target::Aiff1644,
            &EncodeProfile {
                wav_bits: 24,
                wav_rate: 96_000,
                ..d
            }
        ));

        let hi = EncodeProfile {
            wav_bits: 24,
            wav_rate: 48_000,
            ..d
        };
        let wav = dir.path().join("hi.wav");
        let wav = wav.to_str().unwrap();
        encode_with(&src, wav, Target::Wav1644, &hi).expect("encode wav 24/48");
        assert!(is_conformant(wav, Target::Wav1644, &hi));
        assert!(!is_conformant(wav, Target::Wav1644, &d));
        assert!(!is_conformant(
            wav,
            Target::Wav1644,
            &EncodeProfile {
                wav_rate: 44_100,
                ..hi
            }
        ));
        assert!(!is_conformant(
            wav,
            Target::Wav1644,
            &EncodeProfile { wav_bits: 16, ..hi }
        ));
    }

    #[test]
    fn encodes_flac_to_conformant_aiff() {
        let Some(src) = fixture("real_lossless.flac") else {
            skip_if_no_fixture("real_lossless.flac");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let dst = dir.path().join("out.aiff");
        let dst = dst.to_str().unwrap();
        encode(&src, dst, Target::Aiff1644).expect("encode aiff");
        // equivalence: the output is exactly the target shape
        assert!(
            is_conformant(dst, Target::Aiff1644, &EncodeProfile::default()),
            "encoded AIFF must be 16-bit/44.1"
        );
    }

    #[test]
    fn encodes_flac_to_mp3_320() {
        let Some(src) = fixture("real_lossless.flac") else {
            skip_if_no_fixture("real_lossless.flac");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let dst = dir.path().join("out.mp3");
        let dst = dst.to_str().unwrap();
        encode(&src, dst, Target::Mp3320).expect("encode mp3");
        assert!(is_conformant(
            dst,
            Target::Mp3320,
            &EncodeProfile::default()
        ));
        assert!(std::fs::metadata(dst).unwrap().len() > 0);
    }

    /// Un profil MP3 256 / 48 kHz produit bien un MP3 à ces valeurs.
    #[test]
    fn encodes_flac_to_mp3_au_profil() {
        let Some(src) = fixture("real_lossless.flac") else {
            skip_if_no_fixture("real_lossless.flac");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let dst = dir.path().join("out.mp3");
        let dst = dst.to_str().unwrap();
        let p = EncodeProfile {
            mp3_kbps: 256,
            mp3_rate: 48_000,
            ..EncodeProfile::default()
        };
        encode_with(&src, dst, Target::Mp3320, &p).expect("encode mp3 256/48");
        let t = Probe::open(dst).and_then(|p| p.read()).expect("lofty mp3");
        assert_eq!(t.properties().sample_rate(), Some(48_000));
        assert_eq!(t.properties().audio_bitrate(), Some(256));
    }

    // ---- Réécriture WAVE_FORMAT_EXTENSIBLE → WAVE_FORMAT_PCM ----

    /// Les octets 20-21 d'un WAV dont le fmt est le premier chunk : son `wFormatTag`.
    fn format_tag(path: &str) -> [u8; 2] {
        let b = std::fs::read(path).unwrap();
        [b[20], b[21]]
    }

    /// Le corps du chunk `data` d'un WAV (parcours RIFF minimal, pour comparer les échantillons
    /// octet pour octet).
    fn data_chunk(path: &str) -> Vec<u8> {
        let b = std::fs::read(path).unwrap();
        let mut pos = 12usize;
        while pos + 8 <= b.len() {
            let size =
                u32::from_le_bytes([b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]]) as usize;
            if &b[pos..pos + 4] == b"data" {
                return b[pos + 8..pos + 8 + size].to_vec();
            }
            pos += 8 + size + (size & 1);
        }
        panic!("pas de chunk data dans {path}");
    }

    /// Décode tout le fichier par Symphonia (le décodeur de l'analyse) en échantillons entrelacés.
    fn decode_all(path: &str) -> (u32, Vec<f32>) {
        let mut all = Vec::new();
        let info = crate::analysis::decode::decode_pcm(path, 2, |b| all.extend_from_slice(b))
            .expect("decode_pcm");
        assert_eq!(info.codec_error, None, "{path}");
        (info.sample_rate, all)
    }

    /// La décision d'Antoine (spec § Conversion, WAV 24 bits) mesurée sur le ffmpeg embarqué.
    /// TÉMOIN d'abord : sans réécriture, ffmpeg écrit bien `FE FF` — sinon ce test passerait sans
    /// que la réécriture ait jamais servi. Puis : `01 00`, fmt de 16 octets, 24 bits / 44,1 kHz
    /// relus par lofty, chunk `data` identique à l'octet, et un décodage Symphonia qui rend
    /// exactement les mêmes échantillons que le fichier non réécrit.
    #[test]
    fn un_wav_24_bits_sort_en_wave_format_pcm_et_se_decode_a_l_identique() {
        let Some(src) = fixture("real_lossless.flac") else {
            skip_if_no_fixture("real_lossless.flac");
            return;
        };
        let p = EncodeProfile {
            wav_bits: 24,
            ..EncodeProfile::default()
        };
        let dir = tempfile::tempdir().unwrap();
        let brut = dir.path().join("brut.wav");
        let brut = brut.to_str().unwrap();
        run_ffmpeg(&src, brut, &codec_args(Target::Wav1644, &p)).expect("ffmpeg brut");
        assert_eq!(
            format_tag(brut),
            [0xFE, 0xFF],
            "témoin : ffmpeg écrit EXTENSIBLE"
        );

        let dst = dir.path().join("out.wav");
        let dst = dst.to_str().unwrap();
        encode_with(&src, dst, Target::Wav1644, &p).expect("encode wav 24");
        assert_eq!(format_tag(dst), [0x01, 0x00]);
        let b = std::fs::read(dst).unwrap();
        assert_eq!(&b[12..16], b"fmt ");
        assert_eq!(u32::from_le_bytes([b[16], b[17], b[18], b[19]]), 16);
        assert_eq!(
            u64::from(u32::from_le_bytes([b[4], b[5], b[6], b[7]])) + 8,
            b.len() as u64,
            "taille RIFF recalculée"
        );

        let t = Probe::open(dst).and_then(|p| p.read()).expect("lofty wav");
        assert_eq!(t.properties().bit_depth(), Some(24));
        assert_eq!(t.properties().sample_rate(), Some(44_100));
        assert!(is_conformant(dst, Target::Wav1644, &p));

        assert_eq!(data_chunk(dst), data_chunk(brut), "données audio intactes");
        let (sr_brut, ech_brut) = decode_all(brut);
        let (sr, ech) = decode_all(dst);
        assert_eq!(sr, sr_brut);
        assert!(!ech.is_empty());
        assert_eq!(ech.len(), ech_brut.len(), "même nombre d'échantillons");
        assert!(ech == ech_brut, "mêmes échantillons décodés");
        // Et la durée est celle de la source.
        let (_, ech_src) = decode_all(&src);
        assert_eq!(ech.len(), ech_src.len());
    }

    /// Mesuré le 2026-09-28 : ffmpeg écrit AUSSI un EXTENSIBLE en 16 bits dès que la fréquence
    /// dépasse 48 kHz. La réécriture vaut donc pour tout WAV, pas seulement le 24 bits.
    #[test]
    fn un_wav_16_bits_a_96_khz_sort_aussi_en_wave_format_pcm() {
        let Some(src) = fixture("real_lossless.flac") else {
            skip_if_no_fixture("real_lossless.flac");
            return;
        };
        let p = EncodeProfile {
            wav_rate: 96_000,
            ..EncodeProfile::default()
        };
        let dir = tempfile::tempdir().unwrap();
        let brut = dir.path().join("brut.wav");
        let brut = brut.to_str().unwrap();
        run_ffmpeg(&src, brut, &codec_args(Target::Wav1644, &p)).expect("ffmpeg brut");
        assert_eq!(
            format_tag(brut),
            [0xFE, 0xFF],
            "témoin : ffmpeg écrit EXTENSIBLE"
        );

        let dst = dir.path().join("out.wav");
        let dst = dst.to_str().unwrap();
        encode_with(&src, dst, Target::Wav1644, &p).expect("encode wav 16/96");
        assert_eq!(format_tag(dst), [0x01, 0x00]);
        assert!(is_conformant(dst, Target::Wav1644, &p));
        assert_eq!(data_chunk(dst), data_chunk(brut));
    }

    /// Un WAV EXTENSIBLE synthétique, stéréo 24 bits : fmt de 40 octets, puis un chunk `LIST` de
    /// taille IMPAIRE (donc suivi d'un octet de bourrage), puis `data`. Chaque piège de la
    /// réécriture y est : bourrage, ordre des chunks, taille RIFF.
    fn wav_extensible(subformat: [u8; 16], valid_bits: u16) -> Vec<u8> {
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&0xFFFEu16.to_le_bytes());
        fmt.extend_from_slice(&2u16.to_le_bytes()); // canaux
        fmt.extend_from_slice(&44_100u32.to_le_bytes());
        fmt.extend_from_slice(&(44_100u32 * 6).to_le_bytes());
        fmt.extend_from_slice(&6u16.to_le_bytes()); // alignement de bloc
        fmt.extend_from_slice(&24u16.to_le_bytes()); // bits par échantillon
        fmt.extend_from_slice(&22u16.to_le_bytes()); // cbSize
        fmt.extend_from_slice(&valid_bits.to_le_bytes());
        fmt.extend_from_slice(&3u32.to_le_bytes()); // masque de canaux
        fmt.extend_from_slice(&subformat);
        assert_eq!(fmt.len(), 40);
        let list = b"INFOISFT\x05\x00\x00\x00Lavf\x00"; // 17 octets : impair
        let data: Vec<u8> = (0u8..=239).collect(); // 40 trames stéréo 24 bits

        let mut body = b"WAVE".to_vec();
        for (id, c) in [
            (b"fmt ", fmt.as_slice()),
            (b"LIST", list.as_slice()),
            (b"data", data.as_slice()),
        ] {
            body.extend_from_slice(id);
            body.extend_from_slice(&(c.len() as u32).to_le_bytes());
            body.extend_from_slice(c);
            if c.len() % 2 == 1 {
                body.push(0);
            }
        }
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn la_reecriture_rend_un_riff_pcm_exact_et_recopie_les_autres_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.wav");
        let path = path.to_str().unwrap();
        let avant = wav_extensible(KSDATAFORMAT_SUBTYPE_PCM, 24);
        std::fs::write(path, &avant).unwrap();

        assert_eq!(wav_extensible_to_pcm(path), Ok(true));
        let apres = std::fs::read(path).unwrap();

        // Attendu construit à la main : même fichier, fmt ramené à ses 16 premiers octets, tag 1.
        let mut attendu = b"RIFF".to_vec();
        attendu.extend_from_slice(&((avant.len() - 24 - 8) as u32).to_le_bytes());
        attendu.extend_from_slice(b"WAVE");
        attendu.extend_from_slice(b"fmt ");
        attendu.extend_from_slice(&16u32.to_le_bytes());
        attendu.extend_from_slice(&1u16.to_le_bytes());
        attendu.extend_from_slice(&avant[22..36]); // canaux → bits par échantillon, intacts
        attendu.extend_from_slice(&avant[60..]); // LIST (+ bourrage) puis data, à l'octet
        assert_eq!(apres, attendu);

        // Idempotente : un WAV déjà PCM n'est pas touché.
        assert_eq!(wav_extensible_to_pcm(path), Ok(false));
        assert_eq!(std::fs::read(path).unwrap(), attendu);
        // Et le dossier ne garde aucun fichier temporaire.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    /// Ce qui ne se réécrit pas sans perte est refusé, et le fichier reste tel quel.
    #[test]
    fn la_reecriture_refuse_ce_qu_elle_ne_sait_pas_traduire_sans_perte() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.wav");
        let path = path.to_str().unwrap();

        let mut float = KSDATAFORMAT_SUBTYPE_PCM;
        float[0] = 0x03; // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
        for (octets, motif) in [
            (wav_extensible(float, 24), "non PCM"),
            (
                wav_extensible(KSDATAFORMAT_SUBTYPE_PCM, 20),
                "wValidBitsPerSample",
            ),
        ] {
            std::fs::write(path, &octets).unwrap();
            let err = wav_extensible_to_pcm(path).expect_err(motif);
            assert!(err.contains(motif), "{err}");
            assert_eq!(std::fs::read(path).unwrap(), octets, "fichier intact");
        }

        // Un chunk qui déclare plus d'octets que le fichier n'en contient.
        let mut tronque = wav_extensible(KSDATAFORMAT_SUBTYPE_PCM, 24);
        tronque.truncate(tronque.len() - 10);
        std::fs::write(path, &tronque).unwrap();
        let err = wav_extensible_to_pcm(path).expect_err("tronqué");
        assert!(err.contains("déborde"), "{err}");
        assert_eq!(std::fs::read(path).unwrap(), tronque);
    }
}
