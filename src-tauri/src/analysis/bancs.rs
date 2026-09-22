//! Le REGISTRE des bancs de détection de grille de codec : une table, et le peu de code qui la
//! parcourt.
//!
//! **Le pari.** Un banc n'est pas un objet, c'est une VALEUR : une ligne de [`BANCS_PRODUCTION`]
//! qui porte son nom, son coût annoncé, les deux clauses qui décident de le payer, et un pointeur
//! vers la fonction qui mesure. Aucun trait, aucun dispatch dynamique, aucun enregistrement à
//! l'exécution — la table est une donnée, on la lit.
//!
//! **Ce que la table absorbe.** Avant elle, `analysis::analyze` portait 83 lignes qui appelaient
//! chaque banc, le journalisaient dans un format à lui, divisaient par un seuil lu chez `verdict`
//! puis prenaient le maximum. Chaque banc neuf y ajoutait sa copie. Pire, la décision de DÉPENSER
//! vivait à deux endroits : `verdict::needs_quant_probe` (quatre clauses, testée) et le
//! `quant_pregate` de `analyze` (deux des mêmes clauses recopiées à la main, non testées, qui
//! commandent la rétention du PCM). Élargir la première au rail LOSSY déclaré l'aurait rendue
//! vraie sans qu'un octet de PCM ait été retenu.
//!
//! **Où passe la couture.** Quatre valeurs la traversent, et rien d'autre : [`Amont`] (ce qu'on
//! sait avant le décodage), [`Aval`] (ce que le décodage ajoute), [`Signal`] (le PCM retenu), et
//! en sortie un [`Sondage`] dont [`Sondage::rapport`] rend l'`Option<f32>` que
//! `AnalysisReport::quant_likelihood` stocke déjà. Ni le type de trace d'un banc, ni son échelle,
//! ni son nom ne franchissent la couture.
//!
//! **Ce que la table ne prend PAS.** Elle est un site d'appel de production, jamais un passage
//! obligé. Chaque banc garde ses entrées publiques entièrement paramétrées
//! (`quant_trace::likelihood_reglee`, `mp3_bank::likelihood`, `framing::balayer`), que les
//! harnais `#[ignore]` appellent en direct : la table n'a aucun pouvoir de leur retirer un
//! réglage. La profondeur est du côté de la production, pas du côté de la mesure.
//!
//! ⚠️ Cette phrase nommait `likelihood_fenetres` et « cinq harnais » le jour où elle a été
//! écrite, et les deux étaient faux : aucun harnais n'appelait cette entrée — c'était un étage de
//! passe-plat, retiré depuis — et `quant_trace` en porte quatre. Un doc d'architecture se vérifie
//! par `grep`, comme le reste.
//!
//! **Modes d'absence : jamais un zéro.** Un banc qui n'a rien mesuré le DIT ([`Issue`]). Accuser
//! un fichier de n'avoir pas pu être mesuré est l'erreur que ce module passe son temps à
//! corriger, et jusqu'ici les trois absences d'`analyze()` se confondaient dans un `log::info!`
//! doublé d'un même `None` — inassertables, puisque le dépôt n'a aucune capture de log en test.

use std::time::Instant;

use crate::analysis::aac_sfb::BlockKind;
use crate::analysis::framing::{self, Jeu};
use crate::analysis::mp3_bank;
use crate::analysis::quant_trace;
use crate::analysis::verdict;
use crate::analysis::Rail;

// -------------------------------------------------------------------------------------------------
// Les deux moitiés de la décision de dépense, coupées là où l'INFORMATION se coupe.
// -------------------------------------------------------------------------------------------------

/// Ce qu'on sait d'un fichier **avant de le décoder** — donc tout ce qui peut commander la
/// RÉTENTION du PCM pendant le décodage.
///
/// Cette valeur existe pour une raison précise, et datée : jusqu'au 2026-09-15, deux des quatre
/// clauses de `verdict::needs_quant_probe` étaient recopiées à la main dans `analysis::analyze`
/// sans test, pour décider de garder ou non jusqu'à `QUANT_MAX_PCM_SAMPLES` échantillons de PCM.
/// Élargir la condition d'origine — le chantier du rail LOSSY déclaré, un MP3 qui annonce
/// 320 kbps en étant un 192 ré-encodé — l'aurait rendue vraie sans qu'aucun PCM n'ait été retenu :
/// mesure absente, silencieusement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Amont {
    /// Rail annoncé par l'extension et les tags (`tags::read`).
    pub declare: Rail,
    /// Rail reniflé du conteneur réel, indépendant de l'extension.
    pub conteneur: Rail,
}

/// Ce que le décodage AJOUTE à [`Amont`].
///
/// Les clauses qui vivent ici ne peuvent que RESSERRER la dépense, jamais l'élargir :
/// [`peut_trancher`] évalue la CONJONCTION des deux, donc une condition élargie ici sans l'être
/// dans [`Banc::avant`] ne rend pas la sonde vraie — elle est inopérante. Le décalage d'hier
/// devient irreprésentable.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Aval {
    /// Coupure spectrale mesurée, en Hz. `verdict::NO_MEASUREMENT_HZ` = rien décodé.
    pub coupure_hz: f32,
}

/// Le PCM retenu, emprunté. Une vue, pas un tampon : `analyze()` reste propriétaire et le libère.
pub struct Signal<'a> {
    /// PCM ENTRELACÉ, tel que `decode::decode_pcm` le rend.
    pub pcm: &'a [f32],
    pub canaux: u16,
    pub taux: u32,
}

/// Ce que l'appelant règle pour TOUS les bancs d'un sondage.
///
/// Il n'y a ici que ce qui est réellement transverse. Les réglages internes d'un banc (fenêtres et
/// bandes pour l'AAC, jeux et blocs pour le cadrage) sont des constantes des fonctions `mesure_*`
/// ci-dessous, pas des cases de cette structure : une case que deux bancs sur trois ignorent
/// serait exactement l'interface superficielle qu'on cherche à éviter.
#[derive(Debug, Clone, Copy)]
pub struct Reglage {
    /// Plafond de parallélisation INTERNE d'un banc, passé tel quel. `analyze()` passe
    /// `Some(QUANT_PROBE_THREADS)` parce que le sondage tourne DÉJÀ dans un fil du pool
    /// d'analyse ; `None` = prendre la machine, ce que veulent les harnais.
    pub fils_max: Option<usize>,
}

// -------------------------------------------------------------------------------------------------
// Ce qu'un banc rend
// -------------------------------------------------------------------------------------------------

/// UNE mesure, celle d'un BRAS d'un banc : une statistique, et le seuil sur l'échelle duquel elle
/// se lit.
///
/// **Le grain est la mesure, pas le banc, et c'est le choix structurant.** Le banc AAC a DEUX
/// bras — blocs longs sur 28 bandes (224 cellules, λ = 0,085) et blocs courts sur 8 bandes
/// (64 cellules, λ = 0,18) — parce que ce sont deux échelles. Le banc MP3 en a un. `Vec<Mesure>`
/// couvre 0, 1 et N ; l'`Option` de `mp3_bank::likelihood` est le cas dégénéré, pas un cas à part.
///
/// Ce n'est PAS un prétexte à éclater l'AAC en deux lignes de table : la calibration du
/// 2026-09-02 a été mesurée avec les DEUX résolutions balayées ensemble, et n'en retirer une
/// reviendrait à appliquer un seuil calibré sur une autre mesure. Une ligne, un appel, deux
/// mesures.
#[derive(Debug, Clone)]
pub struct Mesure {
    /// Étiquette stable du bras, telle qu'elle sort déjà des `label()`/`vise` existants
    /// (`"long"`, `"court"`, `"vorbis"`, `"wma"`). Jamais traduite : elle part au journal.
    pub bras: &'static str,
    /// La statistique BRUTE du bras, dans son échelle à lui. Voyage pour le journal, jamais pour
    /// être comparée à celle d'un autre bras.
    pub statistique: f64,
    /// Le seuil de calibration de CE bras.
    ///
    /// **Il est NOMMÉ ici, il n'est pas hébergé ici** : chaque λ reste déclaré dans `verdict.rs`
    /// avec son bloc de calibration daté, parce que les tests de `verdict.rs` gardent les marges
    /// (`ambigu(Some(0.076 / QUANT_LAMBDA_AAC_LONG)) == Grey`, « le MAXIMUM de la référence doit
    /// rester Douteux ») et qu'ils ont besoin du λ ET de `verdict()` dans la même portée.
    pub lambda: f32,
    /// Tout ce qui est PREUVE DE MÉCANISME et non décision : décalage, canal, forme de fenêtre.
    ///
    /// ⚠️ **Contrat** : cette chaîne part au journal, et rien d'autre. Elle n'est ni analysée, ni
    /// comparée, ni stockée en base. **Tout fait sur lequel du code doit DÉCIDER devient un champ
    /// typé de `Mesure`, jamais un morceau de ce texte.**
    pub detail: String,
}

impl Mesure {
    /// La statistique ramenée sur l'échelle commune : `> 1` = grille retrouvée.
    ///
    /// ⚠️ **`statistique as f32 / lambda`, et surtout pas `(statistique / lambda as f64) as f32`.**
    /// C'est l'arithmétique exacte que `analyze()` appliquait avant ce module, au bit près : les
    /// deux routes divergent d'un ulp sur des valeurs réelles, et la comparaison de `verdict()`
    /// est STRICTE. Figé par `le_rapport_garde_larithmetique_de_lancien_calcul`.
    pub fn rapport(&self) -> f32 {
        self.statistique as f32 / self.lambda
    }
}

/// Ce qu'un banc a produit sur ce fichier — y compris quand il n'a rien produit, et POURQUOI.
///
/// L'absence est une valeur de premier rang ici, et c'est la greffe la plus rentable de ce
/// chantier : avant lui, « aucun PCM retenu », « banc AAC non mesuré » et « banc MP3 non mesuré »
/// étaient trois `log::info!` suivis du même `None`. Le dépôt n'a aucune capture de log en test :
/// ces trois états étaient strictement inassertables, et « la sonde n'a jamais été atteinte » était
/// indiscernable de « la mesure n'a rien trouvé ».
#[derive(Debug, Clone, PartialEq)]
pub enum Issue {
    /// Le banc a tourné et rendu au moins une mesure.
    Mesures(Vec<Mesure>),
    /// Une des deux clauses a dit non : ce fichier n'est pas dans le domaine de ce banc.
    HorsDomaine,
    /// Recevable, mais aucun PCM n'a été retenu (décodage vide).
    SignalVide,
    /// Le banc a tourné et n'a rien rendu : taux hors de ses tables, signal trop court pour un
    /// groupe, pas assez de blocs concordants.
    NonMesurable,
}

impl PartialEq for Mesure {
    /// Compare tout SAUF `detail`, qui est du texte de journal — le comparer figerait un format
    /// d'affichage dans des tests qui parlent de mesure.
    fn eq(&self, autre: &Self) -> bool {
        self.bras == autre.bras
            && self.statistique == autre.statistique
            && self.lambda == autre.lambda
    }
}

/// Le passage d'UN banc.
#[derive(Debug, Clone)]
pub struct Passage<'a> {
    pub banc: &'a Banc,
    pub issue: Issue,
    /// Durée MESURÉE. La comparer à [`Banc::cout_ms`] est la façon de voir une annonce dériver.
    pub duree_ms: u128,
}

/// Le résultat complet d'un sondage : un passage par banc de la table, dans l'ordre de la table.
#[derive(Debug, Clone)]
pub struct Sondage<'a> {
    pub passages: Vec<Passage<'a>>,
}

impl Sondage<'_> {
    /// Toutes les mesures de tous les bancs, à plat, dans l'ordre de la table.
    pub fn mesures(&self) -> impl Iterator<Item = &Mesure> {
        self.passages.iter().flat_map(|p| match &p.issue {
            Issue::Mesures(m) => m.as_slice(),
            Issue::HorsDomaine | Issue::SignalVide | Issue::NonMesurable => &[],
        })
    }

    /// Le rapport que `verdict()` lira : le maximum des rapports MESURÉS.
    ///
    /// `None` = **aucun banc n'a mesuré**, et c'est un état réel et fréquent — pas un zéro. Le pli
    /// est celui qu'`analyze()` appliquait mot pour mot (`map_or(r, |m| m.max(r))`), donc la
    /// valeur produite est identique à celle d'avant ce module pour la table de production.
    pub fn rapport(&self) -> Option<f32> {
        self.mesures()
            .map(|m| m.rapport())
            .fold(None, |acc: Option<f32>, r| {
                Some(acc.map_or(r, |m| m.max(r)))
            })
    }

    /// Le journal, UNE fois pour tous les bancs, au lieu d'un bloc recopié par banc.
    ///
    /// Une ligne par mesure, une ligne par banc qui n'a rien rendu. Un banc muet au journal serait
    /// indistinguable d'un banc absent de la table : c'est précisément ce qu'on refuse.
    pub fn journaliser(&self, chemin: &str) {
        for p in &self.passages {
            match &p.issue {
                Issue::Mesures(mesures) => {
                    for m in mesures {
                        log::info!(
                            "sonde {} : banc={} bras={} L={:.5} lambda={:.3} rapport={:.2} {} en {} ms",
                            chemin,
                            p.banc.nom,
                            m.bras,
                            m.statistique,
                            m.lambda,
                            m.rapport(),
                            m.detail,
                            p.duree_ms
                        );
                    }
                }
                Issue::HorsDomaine => log::info!(
                    "sonde {} : banc={} non mesuré (hors de son domaine)",
                    chemin,
                    p.banc.nom
                ),
                Issue::SignalVide => log::info!(
                    "sonde {} : banc={} non mesuré (aucun PCM retenu)",
                    chemin,
                    p.banc.nom
                ),
                Issue::NonMesurable => log::info!(
                    "sonde {} : banc={} non mesuré (taux non tabulé, signal court ou blocs insuffisants) en {} ms",
                    chemin,
                    p.banc.nom,
                    p.duree_ms
                ),
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// LA LIGNE
// -------------------------------------------------------------------------------------------------

/// Une ligne de la table, c'est-à-dire un banc.
///
/// Rien de ce qu'un appelant doit savoir d'un banc ne vit ailleurs : son nom dans les journaux, ce
/// qu'il voit, ce qu'il coûte, quand on le paie, et la fonction qui mesure.
///
/// **Aucun `Default`, et c'est le levier.** Les six champs sont obligatoires dans un littéral de
/// struct : une ligne neuve ne peut pas oublier en silence une de ses deux clauses de dépense.
#[derive(Debug)]
pub struct Banc {
    /// Nom stable, en minuscules sans espace — il apparaît tel quel au journal. Jamais traduit,
    /// jamais affiché à l'utilisateur.
    pub nom: &'static str,
    /// Ce que ce banc voit, pour le lecteur de la table. Jamais lu par le code.
    pub voit: &'static str,
    /// Coût MESURÉ d'un passage sur un fichier, en millisecondes. **Pas « par minute d'audio » :
    /// par FICHIER.**
    ///
    /// ⚠️ **Il ne DÉCIDE rien.** Il n'y a ni cascade ni budget ici — voir [`sonder`]. Il sert à
    /// ORDONNER la table (du moins cher au plus cher, figé par
    /// `la_table_est_triee_par_cout_croissant`) et à chiffrer au journal.
    ///
    /// RECALIBRÉ le 2026-09-22, et les valeurs d'avant étaient des ordres de grandeur faux :
    /// `mp3` annonçait 100 ms pour 1 090 mesurées, `aac` 200 pour 4 900, `cadrage` 2 900 pour
    /// 5 750. Les deux premières étaient une RÉPARTITION d'une mesure jointe, jamais reprise
    /// depuis. La dérive avait été relevée par `ec45c18` sans être corrigée — ce commit-là
    /// mesurait, il ne recalibrait pas.
    ///
    /// CONDITIONS, parce qu'un nombre sans ses conditions n'est pas une calibration : 8 pistes
    /// authentiques pleine bande (coupure 22 050 Hz, donc les trois bancs ouverts sur les huit),
    /// 2 708 s d'audio, `--release`, un fil, `bench_sqlite::bench_ou_part_le_temps`. Dispersion
    /// serrée — `aac` tient dans 4,65-5,03 s sur les huit.
    ///
    /// **La durée du fichier n'y change rien**, et cette mesure-ci le montre mieux qu'aucune
    /// autre : 411 s d'audio coûtent 11,68 s de bancs, 244 s en coûtent 11,51. 68 % d'audio en
    /// plus pour 1,5 % de coût en plus. Les bancs balaient un nombre FIXE de groupes × décalages,
    /// ~1,16 million de MDCT de 2048 par fichier.
    ///
    /// ⚠️ **L'ABSOLU DÉRIVE D'UN TIERS ENTRE SESSIONS SUR CETTE MACHINE, LES RATIOS NON.** La
    /// même mesure donnait 19,7 s de bancs par fichier le 2026-09-18 contre 11,7 aujourd'hui,
    /// −41 %, dont ~5,7 % seulement s'expliquent par du code (`18eb3db`). Or la répartition est
    /// inchangée : cadrage 47,3 % les deux fois, aac 40,7 → 40,3, mp3 8,4 → 9,0. Un facteur
    /// uniforme, donc l'état de la machine. **Ne pas « corriger » un écart d'un tiers sur ces
    /// valeurs : c'est du bruit de mesure.** Ce qui doit rester vrai, c'est le RANG et l'ordre de
    /// grandeur. Même piège que l'étage MDCT non touché qui avait bougé de 7,2 % pendant qu'on
    /// mesurait autre chose.
    pub cout_ms: u32,
    /// Vrai quand ce banc peut servir sur ce qu'on sait AVANT le décodage.
    ///
    /// **C'est la clause qui commande la rétention du PCM**, via [`retention_utile`].
    pub avant: fn(Amont) -> bool,
    /// Vrai quand ce que le décodage a révélé laisse encore ce banc utile. Ne peut que RESSERRER.
    pub apres: fn(Aval) -> bool,
    /// Mesure, et rien d'autre. Rend un vecteur VIDE quand la mesure n'existe pas — jamais une
    /// valeur par défaut, jamais un zéro.
    ///
    /// **Ordre d'appel** : appelée seulement quand les deux clauses sont vraies et que le signal
    /// n'est pas vide. Un banc n'a donc pas à re-tester son domaine.
    ///
    /// **Modes d'erreur** : aucun `Result`. Un banc ne peut pas échouer, il peut seulement ne pas
    /// mesurer, et les deux ne se confondent pas dans ce détecteur. Un `panic` éventuel sur un
    /// fichier utilisateur arbitraire est déjà attrapé par le `catch_unwind` de `worker_loop`.
    pub mesurer: fn(&Signal<'_>, &Reglage) -> Vec<Mesure>,
}

// -------------------------------------------------------------------------------------------------
// LA TABLE
// -------------------------------------------------------------------------------------------------

/// **Tous les bancs de PRODUCTION, tous les coûts, toutes les clauses.** Lire cette table, c'est
/// connaître la dépense du détecteur en entier.
///
/// Ordonnée par coût croissant (figé par un test). `static` et pas `OnceLock` : la table est
/// entièrement `const`-constructible — pointeurs de fonction et `&'static str`, tous `Sync`. C'est
/// un bénéfice direct du choix « valeur plutôt qu'objet », et il écarte d'emblée la question de
/// MSRV que `LazyLock` (1.80) a déjà posée à ce dépôt le 2026-09-12.
///
/// Le banc de CADRAGE y est entré le 2026-09-15, une fois son coût dérivé : il est le SEUL à voir
/// Vorbis et WMA, aveugles aux deux autres lignes — voir [`CADRAGE_BLOCS`] pour le balayage qui a
/// ramené sa dépense sans perdre la séparation. ⚠️ Il n'est PLUS « le seul à coûter des
/// secondes » : la recalibration du 2026-09-22 montre que `aac` coûte 4,9 s et `mp3` 1,1 s, donc
/// les trois se comptent en secondes et l'écart cadrage/aac n'est que de 1,17.
pub static BANCS_PRODUCTION: [Banc; 3] = [
    Banc {
        nom: "mp3",
        voit: "MPEG-1 couche III (8 bandes × 8 trames)",
        cout_ms: 1_090,
        avant: amont_lossless_non_dementi,
        apres: aval_au_dessus_de_la_falaise,
        mesurer: mesure_mp3,
    },
    Banc {
        nom: "aac",
        voit: "AAC, deux résolutions MDCT — blocs longs (224 cellules) et courts (64)",
        cout_ms: 4_900,
        avant: amont_lossless_non_dementi,
        apres: aval_au_dessus_de_la_falaise,
        mesurer: mesure_aac,
    },
    Banc {
        nom: "cadrage",
        voit: "tout codec MDCT — dont Vorbis et WMA, aveugles aux deux lignes ci-dessus",
        cout_ms: 5_750,
        avant: amont_lossless_non_dementi,
        apres: aval_au_dessus_de_la_falaise,
        mesurer: mesure_cadrage,
    },
];

// -------------------------------------------------------------------------------------------------
// Les clauses de dépense, nommées UNE fois et partagées par les lignes qui les ont en commun
// -------------------------------------------------------------------------------------------------

// ⚠️ CE QUI SUIT EST LE DOC-COMMENT DE `verdict::needs_quant_probe`, DÉPLACÉ VERBATIM le
// 2026-09-15 quand cette fonction a été remplacée par `peut_trancher`. Il porte la mesure de
// corpus qui justifie le domaine, et il n'appartient à aucune des deux clauses en particulier :
// il décrit ce que leur CONJONCTION dépense.
//
// Vrai quand — et seulement quand — la sonde de quantification a quelque chose à trancher.
//
// **BANDE PLEINE, un point c'est tout** : rail lossless déclaré, conteneur non démenti, coupure
// réellement mesurée et à `LOSSLESS_OK_HZ` ou au-dessus. Sous la falaise, le verdict est déjà
// Faux ; sur un désaccord de conteneur, il l'est aussi et le court-circuit passe avant tout.
// Ailleurs, la sonde ne changerait rien.
//
// ⚠️ **Elle ne teste PAS la platitude, et cette clause a été retirée le 2026-09-02 après
// mesure.** La première intégration ne sondait que le bras `Grey` — bande pleine ET aigu SOUS la
// plage des masters. Or la cible même de l'issue #52 — les transcodes AAC haut débit,
// invisibles au spectre — a une platitude DANS la plage depuis la re-dérivation du plancher à
// -12 (#51) : elle sort en `Ok`, pas en `Grey`. Mesuré sur les 160 fichiers de `C:\sift-corpus` :
// avec la clause, les 40 fichiers `aac256`/`aacmf128`/`aacmf256`/`aac128` haut débit n'étaient
// **jamais** sondés (`quant_l = "-"`), et l'intégration entière valait +2 détections sur des
// familles hors cible (un `opus128`, un `wma192`). La condition qui vise la cible est donc la
// bande pleine seule.
//
// **Coût, dit et non minimisé.** La sonde tourne désormais sur ~tout lossless SAIN à l'analyse,
// pas sur une poignée d'ambigus : +0,3 s de balayage sur une analyse de 2-4 s, soit ~10 %.
// Mesuré le 2026-09-02 sur les 160 fichiers étiquetés de `C:\sift-corpus` (`corpus_scan`,
// `--release`) :
//
// | | fichiers | part |
// |---|---|---|
// | sonde DEMANDÉE (lossless + bande pleine) | 111 | **69,4 %** |
// | mesure effectivement RENDUE | 98 | 61,3 % |
// | demandée mais sans mesure (plafond PCM) | 13 | 8,1 % |
//
// ⚠️ Ces 69 % sont la part d'un corpus **saturé de faux à bande pleine** (150 transcodes pour 10
// authentiques), pas celle d'une bibliothèque réelle — sur laquelle le chiffre n'a pas été
// mesuré. Les 13 sans mesure sont les 13 variantes d'un seul morceau de 10 min 53 s, au-delà de
// `analysis::QUANT_MAX_PCM_SAMPLES` : `None`, donc verdict inchangé.
//
// Ce n'est plus « à la demande » au sens de « rare » — c'est « à la demande » au sens de
// « seulement là où elle peut trancher ».
//
// **Elle vit ici, pas chez l'appelant, pour une raison de couplage** : c'est la seule façon que
// la condition de déclenchement et le bras qu'elle sert ne dérivent pas l'un de l'autre. Un
// `analyze()` qui déciderait tout seul quand sonder aurait une copie de l'arbitrage hors du seul
// endroit qui le teste — et une copie qui dérive dépense 0,3 s pour rien, ou pire, ne les dépense
// pas là où le verdict attendait la mesure.
//
// `verdict()` reste PUR : cette fonction ne mesure rien non plus, elle ne fait que nommer la
// condition. Le calcul MDCT vit dans `analysis::analyze`, qui a le PCM.

/// Rail déclaré lossless et conteneur qui ne le dément pas.
///
/// Les deux clauses qu'`analyze()` recopiait à la main. `Rail::Lossy` en conteneur = fraude
/// établie sans le spectre, `verdict()` court-circuite avant : rien à sonder. `Rail::Unknown` ne
/// désarme pas la sonde.
///
/// **C'est ici que passera l'élargissement au rail LOSSY déclaré** — un MP3 qui annonce 320 kbps
/// en étant un 192 ré-encodé. Le jour où la ligne `mp3` recevra sa propre clause amont, la
/// rétention du PCM la suivra dans le même geste, sans qu'une deuxième ligne de code ait à être
/// écrite : c'est toute la raison d'être de ce découpage.
fn amont_lossless_non_dementi(a: Amont) -> bool {
    a.declare == Rail::Lossless && a.conteneur != Rail::Lossy
}

/// Coupure au-dessus de la falaise lossy.
///
/// Sous la falaise, `verdict()` rend déjà Faux : la mesure ne changerait rien. La fenêtre
/// LAME 320 (20 000 – 20 750 Hz) EST sondée depuis le 2026-09-11 : elle est `Grey` par la coupure,
/// et le doute ne doit pas désarmer la mesure qui peut le lever.
///
/// ⚠️ **UNE clause, là où `verdict::needs_quant_probe` en écrivait deux.** Elle y testait aussi
/// `> NO_MEASUREMENT_HZ`, la sentinelle « rien n'a été décodé ». Cette seconde clause est
/// mathématiquement absorbée par la première tant que la sentinelle reste sous la falaise —
/// clippy le refuse d'ailleurs comme `nonminimal_bool` dès que les deux sont voisines. L'absorption
/// n'est pas une coïncidence qu'on peut oublier : elle est figée par
/// `la_sentinelle_reste_sous_la_falaise`, qui tombe le jour où la falaise descendrait jusqu'à
/// elle et laisserait un fichier non décodé entrer dans un banc.
fn aval_au_dessus_de_la_falaise(d: Aval) -> bool {
    d.coupure_hz > verdict::LOSSY_CLIFF_HZ
}

/// La gate de l'absorption, **à la compilation** : la sentinelle « rien décodé » doit rester
/// strictement sous la falaise, sinon [`aval_au_dessus_de_la_falaise`] laisserait passer un
/// fichier dont aucune trame n'a été décodée. Un test aurait suffi, mais clippy refuse à raison
/// une assertion dont les deux membres sont des constantes : autant la faire tenir par le
/// compilateur.
const _: () = assert!(verdict::NO_MEASUREMENT_HZ < verdict::LOSSY_CLIFF_HZ);

// -------------------------------------------------------------------------------------------------
// Les fonctions de mesure. C'est ICI que vivent les réglages internes de production d'un banc, et
// nulle part ailleurs : un `BlockKind` ne veut rien dire pour le cadrage, un `Jeu` ne veut rien
// dire pour l'AAC. Un champ « réglages » commun dans la ligne aurait été un sac fourre-tout dont
// chaque banc ignore les trois quarts.
// -------------------------------------------------------------------------------------------------

/// Les deux résolutions balayées par le banc AAC, dans l'ordre du prototype.
///
/// Déplacée depuis `analysis::QUANT_RESOLUTIONS`. Les DEUX, et ce n'est pas de la prudence : la
/// calibration du 2026-09-02 a été mesurée avec ce réglage exact, et le tableau de détection
/// qu'elle produit dépend des blocs longs autant que des courts — les familles `aac_mf` gagnent
/// souvent en blocs LONGS, avec les plus fortes vraisemblances du corpus. N'en retirer un
/// reviendrait à appliquer un seuil calibré sur une autre mesure.
const AAC_RESOLUTIONS: [BlockKind; 2] = [BlockKind::Long, BlockKind::Short];

/// UN appel, DEUX mesures — une par résolution, chacune avec le λ de SON échelle.
fn mesure_aac(signal: &Signal<'_>, reglage: &Reglage) -> Vec<Mesure> {
    quant_trace::likelihood(
        signal.pcm,
        signal.canaux,
        signal.taux,
        &AAC_RESOLUTIONS,
        reglage.fils_max,
    )
    .iter()
    .map(|t| Mesure {
        bras: t.resolution.label(),
        statistique: t.l,
        // `quant_lambda_aac` et pas un `match` recopié : cette fonction a trois autres appelants,
        // tous dans les harnais de `quant_trace`, donc la supprimer ou la contourner ferait
        // réapparaître le même `match` à quatre endroits. Elle a été relue le 2026-09-15 comme un
        // passe-plat à retirer ; c'en est l'inverse — elle est le seul endroit qui sait quelle
        // échelle porte quel seuil.
        lambda: verdict::quant_lambda_aac(t.resolution),
        detail: format!(
            "décalage={} canal={} fenêtre={}",
            t.decalage,
            t.canal.label(),
            t.fenetre.label()
        ),
    })
    .collect()
}

/// Un seul bras : le banc MP3 ne balaie qu'une résolution.
fn mesure_mp3(signal: &Signal<'_>, reglage: &Reglage) -> Vec<Mesure> {
    mp3_bank::likelihood(signal.pcm, signal.canaux, signal.taux, reglage.fils_max)
        .map(|t| Mesure {
            bras: "long",
            statistique: t.l,
            lambda: verdict::QUANT_LAMBDA_MP3,
            detail: format!("décalage={} canal={}", t.decalage, t.canal.label()),
        })
        .into_iter()
        .collect()
}

/// Les deux jeux de production du banc de cadrage : `vorbis` et `wma`.
///
/// DEUX et pas cinq. Les trois autres de `framing::JEUX` (`aac`, `aac-sinus`, `mp3`) visent des
/// familles que les deux lignes moins chères de cette table mesurent mieux, et par la grille de
/// quantification plutôt que par le cadrage. Le harnais `framing_scan` balaie les cinq
/// (`SIFT_FRAMING_JEUX`) : ce sont deux questions différentes, et la table ne répond qu'à celle de
/// la production.
const CADRAGE_JEUX: [Jeu; 2] = [framing::JEUX[1], framing::JEUX[4]];

/// Demi-seconde à 44,1 kHz, seize blocs.
///
/// **MESURÉ le 2026-09-15**, et c'est la mesure qui a autorisé l'entrée de cette ligne en table.
/// La séparation avait d'abord été établie à 30 blocs (~4 500 ms par fichier) ; le balayage
/// cherchait le plus petit réglage qui la tienne encore, sur les 20 vrais transcodages et
/// 10 authentiques du corpus étiqueté :
///
/// | blocs | vrais, min | authentiques, max | marge | coût |
/// |---|---|---|---|---|
/// | 10 | 0,333 | 0,111 | +0,222 | 2,2 s |
/// | 12 | 0,833 | 0,125 | +0,708 | 2,3 s |
/// | **16** | **0,938** | **0,091** | **+0,847** | **2,9 s** |
/// | 20 | 0,950 | 0,125 | +0,825 | 3,4 s |
///
/// ⚠️ **Une clause a été RETIRÉE de ce paragraphe le 2026-09-22 : « quinze fois les deux autres
/// lignes réunies ».** Elle était fausse, et d'une façon instructive — elle divisait les 4 500 ms
/// par les 300 ms ANNONCÉS pour `mp3` + `aac` (100 + 200), or ces deux annonces étaient elles-
/// mêmes fausses d'un facteur ~20. Un nombre DÉRIVÉ hérite de l'erreur de son entrée et lui
/// survit, parce qu'il ne cite plus le champ dont il vient. Mesuré : à la date de ce balayage,
/// `aac` + `mp3` coûtaient ensemble ~10 s par fichier, donc 4 500 ms en valait 0,43 fois — pas
/// quinze. Le choix de 16 blocs, lui, ne repose pas dessus : il repose sur la MARGE de la
/// colonne du milieu, qui est mesurée.
///
/// ⚠️ La colonne « coût » de cette table est datée du 2026-09-15 et n'a pas été reprise : le
/// même réglage à 16 blocs mesure 5,75 s le 2026-09-22 sur la même machine. Ce sont les RAPPORTS
/// entre lignes qui ont choisi le réglage, et eux tiennent — voir l'avertissement de dérive sur
/// [`Banc::cout_ms`].
///
/// 10 ne tient pas : un vrai descend à 0,333, sous [`framing::ALIGNEMENT_MIN`].
///
/// **16 plutôt que 12, et c'est une SECONDE marge qui tranche.** Les deux tiennent le seuil, et 12
/// coûte 26 % de moins. Mais [`framing::BLOCS_ALIGNEMENT_MIN`] exige huit blocs RETENUS pour que
/// la mesure existe, et la distribution des blocs retenus dit ceci :
///
/// | | minimum retenu | seuil d'existence |
/// |---|---|---|
/// | 12 blocs analysés | **8** | 8 |
/// | 16 blocs analysés | **11** | 8 |
///
/// À 12, un vrai transcodage du corpus retient huit blocs PILE : un bloc rejeté de plus et il
/// cesse d'être mesurable — une détection perdue en silence, ce que ce détecteur refuse autant
/// qu'un faux positif. À 16, le minimum observé est 11. Le surcoût achète de la marge des DEUX
/// côtés : +0,14 d'alignement, +3 blocs de mesurabilité.
///
/// ⚠️ Ce tableau a d'abord été lu comme « 10 non, 12 oui, 16 oui, 20 NON, 30 oui », donc comme une
/// méthode instable qu'il fallait écarter. C'était le harnais qui retenait le jeu par SCORE quand
/// la décision le retient par ALIGNEMENT : un seul fichier basculait sur l'autre jeu et publiait
/// son alignement. Corrigé, le tableau est monotone.
const CADRAGE_BLOC: usize = framing::BLOC / 2;
const CADRAGE_BLOCS: usize = 16;

/// Le seul banc qui demande un signal MONO — il le dérive lui-même, une fois, et seulement s'il
/// tourne. Les deux autres lisent le PCM entrelacé tel que `decode_pcm` le rend.
fn mesure_cadrage(signal: &Signal<'_>, reglage: &Reglage) -> Vec<Mesure> {
    let mono = framing::mono(signal.pcm, signal.canaux);
    let traces = framing::balayer(
        &mono,
        &CADRAGE_JEUX,
        CADRAGE_BLOC,
        CADRAGE_BLOCS,
        reglage.fils_max,
    );
    // `mieux_aligne` et pas `cadrage_etabli` : le banc garde sa condition d'EXISTENCE de la mesure
    // (`BLOCS_ALIGNEMENT_MIN`, qui produit une absence) et rend son SEUIL DE DÉCISION à la table,
    // où il devient le dénominateur du rapport que `verdict()` compare à 1 — exactement comme les
    // λ des deux autres lignes. La distinction n'est pas cosmétique : le doc de
    // `BLOCS_CONCORDANTS_MIN` la nomme déjà, « une condition d'existence de la mesure, pas un
    // réglage de sensibilité ».
    framing::mieux_aligne(&traces)
        .map(|t| Mesure {
            bras: t.jeu.vise,
            statistique: t.alignement,
            // 0,5 est exact en f32 : la conversion ne perd rien, et le rapport garde
            // l'arithmétique des deux autres bancs.
            lambda: framing::ALIGNEMENT_MIN as f32,
            detail: format!(
                "index={} reste={}×{} blocs={} concordance={:.3} score={:.1}",
                t.index,
                t.reste_modal,
                t.reste_modal_compte,
                t.blocs_retenus,
                t.concordance,
                t.score
            ),
        })
        .into_iter()
        .collect()
}

// -------------------------------------------------------------------------------------------------
// Le parcours. Trois fonctions, et c'est tout ce que `analysis::analyze` appelle.
// -------------------------------------------------------------------------------------------------

/// **Faut-il RETENIR le PCM pendant le décodage ?**
///
/// Remplace la recopie qu'`analyze()` portait. Ce n'est plus une copie de quoi que ce soit : c'est
/// la disjonction des clauses amont de la table.
pub fn retention_utile(bancs: &[Banc], amont: Amont) -> bool {
    bancs.iter().any(|b| (b.avant)(amont))
}

/// Au moins un banc peut-il encore trancher, une fois le décodage fait ?
///
/// ⚠️ **Elle ne change PAS le résultat d'un sondage, et l'appelant doit le savoir.** [`sonder`]
/// teste les deux mêmes clauses ligne par ligne : sans cette garde, un fichier hors domaine
/// donnerait un [`Sondage`] dont tous les passages sont [`Issue::HorsDomaine`], donc un
/// [`Sondage::rapport`] à `None` — exactement la même valeur. Ce qu'elle évite est ailleurs :
/// construire le sondage, et surtout imprimer une ligne de journal « hors de son domaine » par
/// banc sur CHAQUE fichier authentique, c'est-à-dire l'écrasante majorité d'une bibliothèque
/// réelle. C'est une garde de dépense et de bruit, pas une garde de correction.
///
/// Remplace `verdict::needs_quant_probe`. **Elle implique [`retention_utile`] par construction**,
/// puisque c'est la même disjonction avec une conjonction de plus : aucune dérive n'est possible
/// entre la dépense et la rétention, et ce n'est pas un test qui le garantit, c'est la forme. Un
/// test en est le TÉMOIN, pas le rattrapage.
pub fn peut_trancher(bancs: &[Banc], amont: Amont, aval: Aval) -> bool {
    bancs.iter().any(|b| (b.avant)(amont) && (b.apres)(aval))
}

/// **LA couture.** Passe les bancs dans l'ordre de la table, chronomètre, nomme chaque issue.
///
/// N'écrit rien, ne journalise rien, ne décide aucun verdict : elle rend un [`Sondage`] que
/// l'appelant journalise et réduit.
///
/// **`bancs` est un PARAMÈTRE, et c'est délibéré.** Une fonction qui lirait [`BANCS_PRODUCTION`]
/// en dur ne serait exerçable qu'avec un vrai transcodage sur disque — l'ordre, la classification
/// d'issue, le pli du maximum : tout resterait au même endroit inatteignable qu'avant, derrière un
/// `analyze(path)` qui décode un fichier. Avec le paramètre, seize échantillons et deux lignes
/// factices suffisent.
///
/// **Aucune cascade, aucun budget, et c'est un arbitrage écrit.** Un arrêt anticipé ou un refus au
/// budget feraient dépendre `quant_likelihood` — valeur STOCKÉE en base, relue par `reverdict` —
/// de l'ordre d'évaluation ou de la charge de la machine. Le dépôt fige l'invariant inverse par
/// test (`quant_trace::le_nombre_de_fils_ne_change_ni_le_l_ni_le_decalage`). Et `corpus_scan`
/// passe par `analyze()` : sa colonne `quant_l` cesserait d'être un maximum. Le levier de dépense
/// est ailleurs — les deux clauses par ligne, et l'appartenance à la table.
///
/// **Modes d'erreur : aucun.** Une absence est une [`Issue`], jamais un `Err`.
pub fn sonder<'b>(
    bancs: &'b [Banc],
    signal: &Signal<'_>,
    amont: Amont,
    aval: Aval,
    reglage: &Reglage,
) -> Sondage<'b> {
    let mut passages = Vec::with_capacity(bancs.len());
    for banc in bancs {
        if !(banc.avant)(amont) || !(banc.apres)(aval) {
            passages.push(Passage {
                banc,
                issue: Issue::HorsDomaine,
                duree_ms: 0,
            });
            continue;
        }
        // `pcm.is_empty()` en direct : `Signal::est_vide` était le seul membre de son bloc
        // `impl`, appelé ici et nulle part ailleurs. C'est le `if` qui porte le sens — il tient
        // la distinction entre « rien à mesurer » et « le banc n'a rien trouvé ».
        if signal.pcm.is_empty() {
            passages.push(Passage {
                banc,
                issue: Issue::SignalVide,
                duree_ms: 0,
            });
            continue;
        }
        let t0 = Instant::now();
        let mesures = (banc.mesurer)(signal, reglage);
        let duree_ms = t0.elapsed().as_millis();
        let issue = if mesures.is_empty() {
            Issue::NonMesurable
        } else {
            Issue::Mesures(mesures)
        };
        passages.push(Passage {
            banc,
            issue,
            duree_ms,
        });
    }
    Sondage { passages }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le banc `cadrage` attrape Vorbis et WMA là où `mp3` et `aac` sont AVEUGLES.
    ///
    /// POURQUOI CE TEST EXISTE, et il corrige une conclusion que j'allais tirer. Mesuré le
    /// 2026-09-18 : `cadrage` coûte 47,3 % du temps d'analyse
    /// (`bench_sqlite::bench_ou_part_le_temps`), et sur 70 pistes de la bibliothèque de test il
    /// décide SEUL sur… zéro. La lecture tentante — « il ne sert à rien » — est fausse : cette
    /// bibliothèque ne contient simplement aucun faux d'origine Vorbis ou WMA. Une absence de
    /// déclenchement n'est pas une absence d'utilité.
    ///
    /// Sur des faux FABRIQUÉS, la réponse s'inverse. Trois sources authentiques, chacune passée
    /// par cinq encodeurs puis ramenée en FLAC 44,1/16 :
    ///
    /// ```text
    ///   classe (n=3)        mp3          aac        cadrage
    ///   authentique    0,35–0,52    0,47–0,47    0,00–0,12   aucun banc : pas de faux positif
    ///   vorbis q8      0,35–0,52    0,47–0,53    1,88–2,00   cadrage SEUL, 3 sur 3
    ///   wma 320k       0,43–0,43    0,47–0,53    1,88–2,00   cadrage SEUL, 3 sur 3
    ///   vorbis q10     0,43–0,43    0,47–0,47    0,00–1,07   cadrage SEUL, 2 sur 3
    ///   aac 256k       0,43–0,43    3,94–7,62    1,75–2,00   l'aac décide ; cadrage confirme
    ///   mp3 320k       4,43–5,56    0,42–0,53    0,00–0,00   le mp3 décide ; cadrage aveugle
    /// ```
    ///
    /// Huit faux sur dix-huit ne seraient détectés par PERSONNE sans ce banc. C'est ce qu'achètent
    /// ses 47 %.
    ///
    /// ## Trois assertions, et chacune répare une mutation qui avait survécu
    ///
    /// **Une MARGE, pas la borne.** `alignement = alignes / retenus` est une fraction plafonnée à
    /// 1,0, et `ALIGNEMENT_MIN` vaut 0,5 : le rapport SATURE à 2,00. Une première version
    /// assertait `>= 1.0`, et doubler le seuil — qui pose la barre exactement sur le plafond,
    /// rapport 1,00 — la laissait AU VERT. Le seuil de ce test est donc une marge mesurée
    /// (1,88 au minimum observé), pas la limite de décision.
    ///
    /// **Le BRAS gagnant, pas seulement le franchissement.** `CADRAGE_JEUX` vise `vorbis`
    /// (N=1024, fenêtre Vorbis) et `wma` (N=2048, sinus). Remplacer le second par une copie du
    /// premier laissait le test AU VERT : le jeu Vorbis attrape aussi le WMA. C'est un fait utile
    /// — et c'est pourquoi le test épingle quel bras décide, sinon il ne garde pas le choix des
    /// deux jeux.
    ///
    /// **L'ancre AUTHENTIQUE.** Sans elle le test gardait « cadrage se déclenche » et pas
    /// « cadrage se déclenche À BON ESCIENT » — un banc qui croise sur tout passerait.
    ///
    /// ⚠️ Le banc ne tourne qu'au-dessus de [`verdict::LOSSY_CLIFF_HZ`] (20 kHz) — sous la
    /// falaise le verdict est déjà Faux par la coupure. Les ancres doivent donc garder leur bande
    /// complète, d'où Vorbis q8 et WMA 320k plutôt que des réglages ordinaires, qui coupent trop
    /// bas pour jamais atteindre ce banc.
    ///
    /// ⚠️ Un trou connu, relevé par la même mesure et NON corrigé : un Vorbis q10 sur trois
    /// échappe aux trois bancs. La qualité maximale passe parfois entre les mailles.
    ///
    /// ANCRES LOCALES, gitignorées comme `anchor_lame320.flac` et pour la même raison — les
    /// fixtures synthétiques sont des sinus balayés, tonals et dégénérés, que les gardes des
    /// bancs désarment. Absentes, le test se saute en le disant. Recette dans
    /// `src-tauri/fixtures/README.md`.
    #[test]
    fn cadrage_attrape_vorbis_et_wma() {
        /// Rapport et bras gagnant de chaque banc qui a rendu une mesure.
        fn sonde(nom: &str) -> Option<Vec<(String, f32, String)>> {
            let chemin = format!("{}/fixtures/{nom}", env!("CARGO_MANIFEST_DIR"));
            if !std::path::Path::new(&chemin).exists() {
                return None;
            }
            let mut pcm = Vec::new();
            let info =
                crate::analysis::decode::decode_pcm(&chemin, 2, |b| pcm.extend_from_slice(b))
                    .ok()?;
            // Amont et aval permissifs : ce test porte sur ce que les bancs MESURENT, pas sur
            // leurs gardes d'entrée, qui ont leurs propres tests.
            let amont = Amont {
                declare: Rail::Lossless,
                conteneur: Rail::Lossless,
            };
            let aval = Aval {
                coupure_hz: verdict::LOSSY_CLIFF_HZ + 1.0,
            };
            let sondage = sonder(
                &BANCS_PRODUCTION,
                &Signal {
                    pcm: &pcm,
                    canaux: info.channels,
                    taux: info.sample_rate,
                },
                amont,
                aval,
                &Reglage { fils_max: Some(2) },
            );
            Some(
                sondage
                    .passages
                    .iter()
                    .filter_map(|p| {
                        let Issue::Mesures(m) = &p.issue else {
                            return None;
                        };
                        let meilleure = m
                            .iter()
                            .max_by(|a, b| a.rapport().total_cmp(&b.rapport()))?;
                        Some((
                            p.banc.nom.to_string(),
                            meilleure.rapport(),
                            meilleure.bras.to_string(),
                        ))
                    })
                    .collect(),
            )
        }

        /// 1,8 et pas 1,0 : voir « une MARGE, pas la borne » ci-dessus. Le minimum observé sur
        /// six faux Vorbis/WMA est 1,88.
        const MARGE: f32 = 1.8;

        // (ancre, cadrage doit croiser, bras attendu)
        let cas: [(&str, Option<&str>); 3] = [
            ("anchor_vorbisq8.flac", Some("vorbis")),
            ("anchor_wma320.flac", Some("wma")),
            ("anchor_auth_fullband.flac", None),
        ];

        let mut vus = 0usize;
        for (ancre, bras_attendu) in cas {
            let Some(rapports) = sonde(ancre) else {
                eprintln!("ancre {ancre} absente — cas sauté (voir fixtures/README.md)");
                continue;
            };
            vus += 1;
            let de = |n: &str| rapports.iter().find(|(m, _, _)| m == n);
            let r = |n: &str| de(n).map(|(_, v, _)| *v);
            eprintln!(
                "{ancre} : mp3 {:?} aac {:?} cadrage {:?}",
                r("mp3"),
                r("aac"),
                de("cadrage").map(|(_, v, b)| (*v, b.clone()))
            );

            match bras_attendu {
                // Un faux : `cadrage` décide avec une marge, par le bras attendu, et il est le
                // SEUL — sans cette seconde moitié le test passerait aussi si les trois bancs
                // croisaient, et il ne dirait plus rien de l'apport propre du banc.
                Some(attendu) => {
                    let (_, val, bras) = de("cadrage")
                        .unwrap_or_else(|| panic!("{ancre} : cadrage n'a rendu aucune mesure"));
                    assert!(
                        *val >= MARGE,
                        "{ancre} : cadrage rend {val:.2}, sous la marge {MARGE}"
                    );
                    assert_eq!(bras, attendu, "{ancre} : bras gagnant inattendu");
                    for autre in ["mp3", "aac"] {
                        if let Some(v) = r(autre) {
                            assert!(
                                v < 1.0,
                                "{ancre} : {autre} croise aussi ({v:.2}) — cadrage n'est plus le \
                                 seul à décider, et ce test ne dit plus rien"
                            );
                        }
                    }
                }
                // Un authentique : AUCUN banc ne doit croiser.
                None => {
                    for banc in ["mp3", "aac", "cadrage"] {
                        if let Some(v) = r(banc) {
                            assert!(
                                v < 1.0,
                                "{ancre} est AUTHENTIQUE et {banc} croise ({v:.2}) — faux positif"
                            );
                        }
                    }
                }
            }
        }
        if vus == 0 {
            eprintln!("aucune ancre Vorbis/WMA présente — test entièrement sauté");
        }
    }

    fn amont(declare: Rail, conteneur: Rail) -> Amont {
        Amont { declare, conteneur }
    }

    fn aval(coupure_hz: f32) -> Aval {
        Aval { coupure_hz }
    }

    // ---- lignes factices : c'est ce qui rend l'orchestration exerçable sans un seul fichier ----

    fn rien(_: &Signal<'_>, _: &Reglage) -> Vec<Mesure> {
        Vec::new()
    }

    fn un_demi(_: &Signal<'_>, _: &Reglage) -> Vec<Mesure> {
        vec![Mesure {
            bras: "a",
            statistique: 0.5,
            lambda: 1.0,
            detail: String::new(),
        }]
    }

    fn jamais(_: Amont) -> bool {
        false
    }

    fn toujours_amont(_: Amont) -> bool {
        true
    }

    fn toujours_aval(_: Aval) -> bool {
        true
    }

    fn banc(
        nom: &'static str,
        avant: fn(Amont) -> bool,
        mesurer: fn(&Signal<'_>, &Reglage) -> Vec<Mesure>,
    ) -> Banc {
        Banc {
            nom,
            voit: "factice",
            cout_ms: 1,
            avant,
            apres: toujours_aval,
            mesurer,
        }
    }

    fn signal_court() -> Vec<f32> {
        vec![0.0f32; 16]
    }

    /// **Dépenser implique avoir retenu.** L'invariant que la duplication d'hier ne pouvait pas
    /// tenir : `analyze()` décidait la rétention avec deux clauses recopiées à la main, et
    /// `verdict::needs_quant_probe` la dépense avec quatre. Élargir l'une sans l'autre produisait
    /// une sonde demandée sur un tampon vide, signalée par une seule ligne de log.
    ///
    /// MUTATION qui le fait tomber : remplacer le `&&` de `peut_trancher` par `||`. Avec
    /// `declare = Rail::Lossy`, aucune clause amont n'est vraie mais `apres(21 000)` l'est : la
    /// disjonction rendrait `true` quand `retention_utile` reste `false`.
    #[test]
    fn depenser_implique_avoir_retenu() {
        let rails = [Rail::Lossless, Rail::Lossy, Rail::Unknown];
        let coupures = [
            verdict::NO_MEASUREMENT_HZ,
            1_000.0,
            verdict::LOSSY_CLIFF_HZ,
            verdict::LOSSY_CLIFF_HZ + 0.1,
            20_400.0,
            verdict::LOSSLESS_OK_HZ,
            21_000.0,
            22_050.0,
        ];
        let mut vus = 0usize;
        for d in rails {
            for c in rails {
                for hz in coupures {
                    let a = amont(d, c);
                    if peut_trancher(&BANCS_PRODUCTION, a, aval(hz)) {
                        vus += 1;
                        assert!(
                            retention_utile(&BANCS_PRODUCTION, a),
                            "sonde dépensée sans rétention : {a:?} coupure {hz}"
                        );
                    }
                }
            }
        }
        assert!(
            vus > 0,
            "aucun cas ne déclenche la sonde : le test ne vérifierait rien"
        );
    }

    /// Le sondage parcourt la table DANS SON ORDRE et nomme chaque absence séparément.
    ///
    /// MUTATIONS : (a) supprimer le court-circuit `HorsDomaine` — la première ligne rendrait
    /// `NonMesurable` ; (b) échanger `SignalVide` et `NonMesurable` ; (c) parcourir `bancs` en
    /// `.rev()` — l'ordre des noms tombe.
    #[test]
    fn le_sondage_ordonne_et_nomme_chaque_absence() {
        let table = [
            banc("hors", jamais, un_demi),
            banc("muet", toujours_amont, rien),
            banc("plein", toujours_amont, un_demi),
        ];
        let pcm = signal_court();
        let s = sonder(
            &table,
            &Signal {
                pcm: &pcm,
                canaux: 1,
                taux: 44_100,
            },
            amont(Rail::Lossless, Rail::Lossless),
            aval(21_000.0),
            &Reglage { fils_max: Some(1) },
        );

        assert_eq!(
            s.passages.iter().map(|p| p.banc.nom).collect::<Vec<_>>(),
            vec!["hors", "muet", "plein"],
            "les passages suivent l'ordre de la table"
        );
        assert_eq!(s.passages[0].issue, Issue::HorsDomaine);
        assert_eq!(s.passages[1].issue, Issue::NonMesurable);
        assert!(matches!(s.passages[2].issue, Issue::Mesures(_)));

        // Signal vide : toute ligne recevable devient `SignalVide`, jamais `NonMesurable`.
        let vide = sonder(
            &table,
            &Signal {
                pcm: &[],
                canaux: 1,
                taux: 44_100,
            },
            amont(Rail::Lossless, Rail::Lossless),
            aval(21_000.0),
            &Reglage { fils_max: Some(1) },
        );
        assert_eq!(vide.passages[0].issue, Issue::HorsDomaine);
        assert_eq!(vide.passages[1].issue, Issue::SignalVide);
        assert_eq!(vide.passages[2].issue, Issue::SignalVide);
    }

    /// **Une absence ne pèse pas dans le maximum.** La règle dure du module, exécutable pour la
    /// première fois : un sondage sans aucune mesure rend `None`, jamais `Some(0.0)`.
    ///
    /// MUTATION : remplacer le `fold(None, …)` de `rapport()` par `.fold(0.0f32, f32::max)`
    /// enveloppé dans `Some` — le premier `assert_eq!` tombe.
    #[test]
    fn une_absence_ne_pese_pas_dans_le_maximum() {
        let pcm = signal_court();
        let sig = Signal {
            pcm: &pcm,
            canaux: 1,
            taux: 44_100,
        };
        let reglage = Reglage { fils_max: Some(1) };
        let a = amont(Rail::Lossless, Rail::Lossless);

        let muette = [banc("muet", toujours_amont, rien)];
        assert_eq!(
            sonder(&muette, &sig, a, aval(21_000.0), &reglage).rapport(),
            None,
            "aucune mesure : pas de rapport, et surtout pas zéro"
        );

        let melange = [
            banc("muet", toujours_amont, rien),
            banc("plein", toujours_amont, un_demi),
        ];
        assert_eq!(
            sonder(&melange, &sig, a, aval(21_000.0), &reglage).rapport(),
            Some(0.5),
            "la ligne muette ne dilue pas le maximum de la ligne qui a mesuré"
        );
    }

    /// **Le rapport garde l'arithmétique exacte du calcul qu'il remplace.**
    ///
    /// `statistique as f32 / lambda` et non `(statistique / lambda as f64) as f32` : les deux
    /// divergent d'un ulp sur des valeurs réelles, et la comparaison de `verdict()` est stricte.
    ///
    /// MUTATION : réécrire `Mesure::rapport` en `(self.statistique / self.lambda as f64) as f32`
    /// — les deux `assert_eq!` tombent.
    #[test]
    fn le_rapport_garde_larithmetique_de_lancien_calcul() {
        for (l, lambda) in [
            (0.105_474_818_f64, verdict::QUANT_LAMBDA_AAC_LONG),
            (0.064_244_877_f64, verdict::QUANT_LAMBDA_MP3),
        ] {
            let m = Mesure {
                bras: "t",
                statistique: l,
                lambda,
                detail: String::new(),
            };
            assert_eq!(
                m.rapport(),
                l as f32 / lambda,
                "le rapport doit convertir AVANT de diviser, comme le faisait analyze()"
            );
        }
    }

    /// **La sentinelle « rien décodé » reste strictement sous la falaise.**
    ///
    /// `aval_au_dessus_de_la_falaise` ne teste plus que la falaise, parce qu'à
    /// `NO_MEASUREMENT_HZ = 0` et `LOSSY_CLIFF_HZ = 20 000` la seconde clause de
    /// `verdict::needs_quant_probe` était absorbée par la première. Ce test est ce qui autorise
    /// cette simplification : il tombe si quelqu'un abaisse la falaise jusqu'à la sentinelle, cas
    /// où un fichier dont AUCUNE trame n'a été décodée entrerait dans un banc — et une coupure de
    /// 0 Hz lue comme une mesure est exactement le défaut que ce détecteur a déjà payé une fois
    /// (deux MP3 de plus de six minutes marqués Faux sur un décodage qui n'avait pas eu lieu).
    ///
    /// MUTATION : poser `coupure_hz: NO_MEASUREMENT_HZ` dans `aval` et vérifier que
    /// `aval_au_dessus_de_la_falaise` rend `false`.
    #[test]
    fn la_sentinelle_reste_sous_la_falaise() {
        assert!(
            !aval_au_dessus_de_la_falaise(aval(verdict::NO_MEASUREMENT_HZ)),
            "rien décodé : aucun banc ne doit être dépensé"
        );
        assert!(
            !aval_au_dessus_de_la_falaise(aval(verdict::LOSSY_CLIFF_HZ)),
            "la falaise elle-même reste exclue : la borne est stricte"
        );
        assert!(
            aval_au_dessus_de_la_falaise(aval(verdict::LOSSY_CLIFF_HZ + 0.1)),
            "juste au-dessus de la falaise, la fenêtre LAME 320 doit être sondée"
        );
    }

    /// La table est triée par coût STRICTEMENT croissant — la seule chose que `cout_ms` décide.
    ///
    /// ⚠️ La version d'avant le 2026-09-22 comparait la liste à sa copie triée, donc elle
    /// acceptait des valeurs ÉGALES : trois bancs à `1` passaient, et `cout_ms` aurait cessé
    /// d'ordonner quoi que ce soit sans que rien ne tombe. Un ordre total est ce que le champ
    /// promet ; c'est donc lui qu'il faut épingler, pas un tri.
    ///
    /// MUTATIONS : échanger les lignes `mp3` et `aac` dans `BANCS_PRODUCTION` ; donner le même
    /// coût à deux lignes.
    #[test]
    fn la_table_est_triee_par_cout_strictement_croissant() {
        let couts: Vec<u32> = BANCS_PRODUCTION.iter().map(|b| b.cout_ms).collect();
        for paire in couts.windows(2) {
            assert!(
                paire[0] < paire[1],
                "la table doit se lire du moins cher au plus STRICTEMENT cher, \
                 or {} n'est pas < {} — coûts lus : {couts:?}",
                paire[0],
                paire[1]
            );
        }
    }

    /// Les lignes nomment les λ CALIBRÉS, en littéral.
    ///
    /// Un test symbolique (`lambda == QUANT_LAMBDA_MP3`) suivrait n'importe quelle dérive sans
    /// tomber — c'est la même raison qui fait figer les valeurs dans `verdict.rs`.
    ///
    /// MUTATION : changer un λ dans `verdict.rs`.
    #[test]
    fn les_lignes_nomment_les_lambdas_calibres() {
        assert_eq!(verdict::QUANT_LAMBDA_AAC_LONG, 0.085);
        assert_eq!(verdict::QUANT_LAMBDA_AAC_COURT, 0.18);
        assert_eq!(verdict::QUANT_LAMBDA_MP3, 0.18);
        assert_eq!(
            BANCS_PRODUCTION.iter().map(|b| b.nom).collect::<Vec<_>>(),
            vec!["mp3", "aac", "cadrage"],
            "la table de production, du moins cher au plus cher"
        );
        assert_eq!(
            framing::ALIGNEMENT_MIN,
            0.5,
            "le λ du cadrage est une valeur calibrée, pas un symbole"
        );
        assert_eq!(
            CADRAGE_JEUX.iter().map(|j| j.vise).collect::<Vec<_>>(),
            vec!["vorbis", "wma"],
            "les deux jeux que les bancs de grille ne voient pas"
        );
    }
}
