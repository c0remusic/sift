//! Détection de transcodage par le CADRAGE de l'encodeur, tous codecs confondus.
//!
//! POURQUOI un troisième banc. `quant_trace` (AAC) et `mp3_bank` (MP3) cherchent la GRILLE de
//! quantification, propre à un codec : chacun a coûté un chantier, et chacun ne voit qu'une
//! famille. Trois codecs restaient aveugles au 2026-09-15 — Opus, Vorbis, WMA — et la tentative
//! d'un banc Vorbis a échoué (review du chantier corpus, § Vorbis) : son résidu passe par un
//! `floor` qui déforme la grille, et ses blocs alternent, ce qui casse la périodicité.
//!
//! MÉTHODE. Kim & Rafii, *Lossy Audio Compression Identification*, EUSIPCO 2018. Elle ne cherche
//! pas la grille mais les coefficients **mis à ZÉRO**, ce que fait tout codec perceptuel, et elle
//! les cherche par le cadrage :
//!
//! > The idea is that the zeroed time-frequency coefficients will become visible only when the
//! > parameters and framing match those used for the encoding.
//!
//! Le signal décodé est ré-analysé en MDCT à CHAQUE position de départ possible. Tant que le
//! cadrage est faux, les trous laissés par l'encodeur sont étalés sur plusieurs coefficients et
//! l'énergie moyenne en dB varie peu d'une position à la suivante. Quand le cadrage retombe sur
//! celui de l'encodeur, les zéros se réalignent d'un coup et l'énergie plonge : c'est cette
//! MARCHE, et pas sa valeur absolue, que la mesure lit. D'où la différence entre positions
//! voisines, que les auteurs disent plus robuste au contenu que de compter les zéros.
//!
//! Leurs taux, sur des fichiers encodés puis reconvertis en WAV — notre cas : Vorbis 1,0 de 96 à
//! 320 kbps, WMA 1,0, AAC 1,0, AC-3 1,0, MP3 0,98.
//!
//! CE QUI CHANGE POUR NOUS. Le papier identifie QUEL codec, par l'argmax sur cinq jeux de
//! paramètres. Sift demande seulement s'il y en a eu UN : le maximum des scores suffit, et une
//! erreur d'attribution entre codecs est sans conséquence.
//!
//! ⚠️ CE MODULE MESURE, IL NE JUGE PAS. Le seuil de décision ([`ALIGNEMENT_MIN`]) vit ici avec sa
//! calibration du 2026-09-15, mais c'est `analysis::bancs` qui l'applique et `verdict()` qui
//! tranche. La phrase d'origine — « aucun seuil n'y vit » — est devenue fausse le jour où
//! `ALIGNEMENT_MIN` a été posé, et l'a été un moment sans que rien ne le dise.

use crate::analysis::mdct::MdctFast;
use crate::analysis::quant_trace::Fenetre;

/// Un jeu de paramètres d'analyse : la moitié d'une fenêtre MDCT, et sa forme.
///
/// Les couples viennent du papier (§ II) et de nos propres mesures : AAC et Vorbis partagent
/// `N = 1024`, seule la fenêtre les sépare, ce que la fenêtre KBD du 2026-09-11 avait déjà
/// établi de son côté. MP3 est le cas tordu — banc hybride, 576 coefficients par granule — et
/// son cadrage se lit quand même à `N = 576`, la taille de sa MDCT longue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Jeu {
    /// Coefficients par trame, soit la moitié de la fenêtre.
    pub n: usize,
    pub fenetre: Fenetre,
    /// Ce que ce jeu vise, pour la lisibilité des mesures — jamais pour décider.
    pub vise: &'static str,
}

/// Les jeux balayés par défaut. Un transcodage n'a qu'un cadrage ; les autres jeux servent de
/// témoins, et c'est leur écart au gagnant qui dit si le pic est réel.
pub const JEUX: [Jeu; 5] = [
    Jeu {
        n: 1024,
        fenetre: Fenetre::Kbd,
        vise: "aac",
    },
    Jeu {
        n: 1024,
        fenetre: Fenetre::Vorbis,
        vise: "vorbis",
    },
    Jeu {
        n: 1024,
        fenetre: Fenetre::Sinus,
        vise: "aac-sinus",
    },
    Jeu {
        n: 576,
        fenetre: Fenetre::Sinus,
        vise: "mp3",
    },
    Jeu {
        n: 2048,
        fenetre: Fenetre::Sinus,
        vise: "wma",
    },
];

/// Durée d'un bloc analysé, en échantillons à 44,1 kHz — la seconde du papier (§ IV.B).
///
/// Le coût est linéaire en durée : une MDCT par échantillon analysé, quelle que soit `N`
/// (`(s+1) × L/s ≈ L`). C'est ce qui borne tout le reste.
pub const BLOC: usize = 44_100;

/// Blocs analysés par fichier. Le papier en prend 59 sur une minute ; ici quelques-uns suffisent
/// à voir si la méthode sépare, et le harnais peut en demander plus.
pub const BLOCS: usize = 8;

/// Blocs CONCORDANTS exigés pour qu'un score existe.
///
/// MESURÉ le 2026-09-15, et c'est la correction la plus importante du réglage. Avec deux blocs
/// analysés, la moitié des scores élevés d'une bibliothèque réelle ne reposaient que sur UN bloc
/// retenu — or avec un seul bloc la somme circulaire dégénère en score isolé, et tout ce qui
/// fait la valeur de la méthode disparaît : la concordance des index entre blocs. Un pic fortuit
/// passait alors pour un cadrage. Sur 134 lossless réels, exiger un seul bloc laissait 17
/// fichiers au-dessus de 12 ; l'exigence de concordance est donc une condition d'existence de la
/// mesure, pas un réglage de sensibilité.
pub const BLOCS_CONCORDANTS_MIN: usize = 3;

/// Plancher du logarithme, en amplitude.
///
/// NON SPÉCIFIÉ PAR LE PAPIER, et c'est le réglage le plus délicat : un coefficient exactement
/// nul rendrait `-∞` et emporterait la moyenne. Après décodage, les zéros du codec ne sont plus
/// exactement nuls — le PCM 16 bits puis le ré-encapsulage les remontent au plancher d'arrondi —
/// mais ils restent des ordres de grandeur sous les coefficients gardés, et c'est précisément ce
/// creux que la mesure lit. Le plancher ne sert donc qu'à borner le cas dégénéré du silence
/// numérique exact.
const PLANCHER: f64 = 1e-12;

/// Ce qu'un balayage rapporte pour un jeu de paramètres.
#[derive(Debug, Clone, Copy)]
pub struct Trace {
    pub jeu: Jeu,
    /// Score final : le module de la somme circulaire sur les blocs retenus (§ III.B, avec le
    /// correctif de somme et non de moyenne).
    pub score: f64,
    /// Blocs retenus sur les blocs analysés.
    pub blocs_retenus: usize,
    /// CONCORDANCE des angles, dans `[0, 1]` : `|Σ r·e^{iθ}| / Σ r`.
    ///
    /// MESURÉ le 2026-09-15, et c'est ce qui sépare réellement. [`Trace::score`] est le module
    /// d'une somme NON normalisée : il grandit avec le nombre de blocs retenus, donc un seuil
    /// posé à 2 blocs ne veut plus rien dire à 6 — sur 24 témoins réels, passer de 2 à 6 blocs a
    /// fait monter 6 d'entre eux au-dessus de 12 sans qu'aucun ne garde son index. La
    /// concordance, elle, ne dépend pas du compte : elle vaut 1 quand tous les blocs désignent le
    /// même cadrage et tombe vers `1/√retenus` quand ils pointent au hasard. Sur les mêmes
    /// fichiers, les 43 suspects qui ont tenu ont gardé index ET jeu à l'identique entre les deux
    /// balayages, les 6 témoins montés en score n'en ont gardé aucun.
    pub concordance: f64,
    /// Position du cadrage la plus fréquente, modulo le saut — informative seulement.
    pub index: usize,
    /// Fraction des blocs retenus dont le cadrage tombe sur la GRILLE COURTE du codec.
    ///
    /// MESURÉ le 2026-09-15, et c'est la statistique qui décide, pas le score. Un encodeur MDCT
    /// pose ses trames sur les multiples de son bloc COURT — 128 coefficients pour Vorbis comme
    /// pour l'AAC — et le flux démarre sur un demi-bloc, d'où un reste constant de 64. Sur le
    /// corpus étiqueté, `index % 64 == 0` vaut pour 20/20 des vrais transcodages (10 `wma192`,
    /// 10 `vorbisq5`) et 0/10 des authentiques.
    ///
    /// Pourquoi une FRACTION et pas le seul index gagnant : Vorbis alterne blocs longs et courts,
    /// donc son cadrage absolu saute de 128 en cours de fichier. Les angles tournent, la somme
    /// circulaire s'annule — `vorbisq5` mesure 0,05 à 0,78 de concordance — mais chaque bloc reste
    /// sur la sous-grille. La somme circulaire est le mauvais agrégateur pour ce codec ; compter
    /// les blocs alignés est le bon.
    ///
    /// Au hasard, cette fraction vaut `1/64 ≈ 0,016`.
    pub alignement: f64,
    /// Reste MODAL de l'index modulo 128 sur les blocs retenus, et son compte.
    ///
    /// Distingue les deux signatures mesurées : `wma192` rend 0, `vorbisq5` rend 64. Le compte
    /// permet de dire à l'appelant sur combien de blocs le mode repose.
    pub reste_modal: usize,
    pub reste_modal_compte: usize,
}

/// La grille courte d'un encodeur MDCT, en échantillons : un demi-bloc court.
///
/// 64 pour les trois codecs visés — Vorbis et AAC ont un bloc court de 128 coefficients, et les
/// index WMA mesurés tombent aussi sur cette grille. Ce n'est PAS une constante de norme : c'est
/// la valeur qui sépare 20/20 des vrais de 10/10 des authentiques sur le corpus étiqueté, et elle
/// se re-mesure si un autre encodeur entre dans le périmètre.
pub const GRILLE_COURTE: usize = 64;

/// Le SAUT entre deux trames, pour `n` coefficients.
///
/// Une MDCT de `n` coefficients consomme une fenêtre de `2n` échantillons, et les formats
/// travaillent tous à demi-recouvrement (« All the formats use half-overlapping windows ») : la
/// trame suivante commence donc `n` échantillons plus loin, pas `n/2`. Le papier appelle `N` la
/// LONGUEUR DE FENÊTRE et son saut vaut `N/2` — ici `n` est le nombre de COEFFICIENTS, donc le
/// même saut s'écrit `n`. Confondre les deux conventions divisait par deux le nombre de cadrages
/// testés et repliait deux cadrages distincts sur le même angle.
fn saut(n: usize) -> usize {
    n
}

/// Énergie moyenne en dB, par position de cadrage, sur un bloc.
///
/// Rend `s + 1` valeurs, une par décalage `i ∈ [0, s]`, avec `s = n` — le `N/2+1` de la figure 1
/// du papier, dans notre convention de coefficients.
///
/// **Une passe, pas `s+1`.** Le papier décrit `s+1` spectrogrammes de segments décalés d'un
/// échantillon ; pris au mot, cela recalculerait la même trame plusieurs fois. Les trames du
/// décalage `i` sont à `i, i+s, i+2s…` : chaque position de trame appartient à un seul décalage,
/// celui de son reste modulo `s`. Une seule boucle sur les positions suffit donc, et le coût
/// tombe à une MDCT par échantillon du bloc.
///
/// **Un nombre de trames CONSTANT, et c'est vital.** Borner chaque décalage par la fin du bloc
/// ferait varier le compte de trames avec `i` : il chuterait d'une unité en franchissant
/// `(L − 2n) mod s`, au MÊME index dans chaque bloc et quel que soit le fichier. Cette marche
/// déterministe se lirait comme un cadrage, et pire, la somme circulaire la récompenserait PLUS
/// qu'une vraie détection, puisqu'elle ne tourne pas d'un bloc à l'autre. Toutes les positions
/// utilisent donc le même nombre de trames, celui que le décalage le plus tardif peut tenir.
/// **Réparti sur les cœurs.** Les `s+1` décalages sont indépendants — chacun lit le bloc et
/// n'écrit que sa case — donc la boucle se tranche en bandes contiguës. Motif du dépôt :
/// `std::thread::scope`, comme `quant_trace::balaye_decalages` ; pas de rayon, pas d'async.
/// Chaque fil construit SON plan MDCT, dont le tampon de travail n'est pas partageable, et cela
/// ne coûte qu'une FFT planifiée par fil. Le résultat ne dépend pas du découpage : chaque case
/// est écrite par un seul fil, à partir des mêmes entrées.
fn energies_par_decalage(
    bloc: &[f32],
    n: usize,
    w: &[f32],
    fils_max: Option<usize>,
) -> Option<Vec<f64>> {
    let s = saut(n);
    let deux_n = 2 * n;
    // Le décalage `s` est le plus contraint : c'est lui qui fixe le compte commun.
    if bloc.len() < s + deux_n {
        return None;
    }
    let trames = (bloc.len() - s - deux_n) / s + 1;
    let mut e = vec![0.0f64; s + 1];

    let dispo = std::thread::available_parallelism()
        .map(|v| v.get())
        .unwrap_or(1);
    let fils = match fils_max {
        Some(m) => dispo.min(m).max(1),
        None => dispo.clamp(1, 16),
    };
    let par_fil = e.len().div_ceil(fils);

    std::thread::scope(|scope| {
        for (bande, tranche) in e.chunks_mut(par_fil).enumerate() {
            let depart = bande * par_fil;
            scope.spawn(move || {
                let plan = MdctFast::new(n);
                let mut trame = vec![0.0f32; deux_n];
                let mut coeffs = vec![0.0f64; n];
                for (j, ei) in tranche.iter_mut().enumerate() {
                    let i = depart + j;
                    let mut acc_bloc = 0.0f64;
                    for k in 0..trames {
                        let p = i + k * s;
                        for (t, (x, wi)) in bloc[p..p + deux_n].iter().zip(w.iter()).enumerate() {
                            trame[t] = x * wi;
                        }
                        plan.transform_f64_into(&trame, &mut coeffs);
                        // Moyenne des coefficients EN dB, pas le dB de la moyenne : c'est la
                        // première qui laisse un coefficient annulé peser, et c'est tout
                        // l'intérêt de la mesure.
                        let mut acc = 0.0f64;
                        for &c in coeffs.iter() {
                            acc += 20.0 * c.abs().max(PLANCHER).log10();
                        }
                        acc_bloc += acc / n as f64;
                    }
                    *ei = acc_bloc / trames as f64;
                }
            });
        }
    });
    Some(e)
}

/// Le couple (score, index) d'un bloc : différences successives, score standard, maximum.
///
/// Rend `None` quand la mesure n'existe pas — bloc trop court pour une seule trame, ou
/// différences toutes identiques (silence numérique), cas où l'écart-type est nul et le score
/// standard indéfini. Jamais une valeur par défaut : c'est la règle du dépôt sur l'absence de
/// mesure, la même que pour `verdict()`.
fn score_bloc(bloc: &[f32], n: usize, w: &[f32], fils_max: Option<usize>) -> Option<(f64, usize)> {
    let e = energies_par_decalage(bloc, n, w, fils_max)?;
    if e.len() < 3 {
        return None;
    }
    let d: Vec<f64> = e.windows(2).map(|p| p[1] - p[0]).collect();
    let moyenne = d.iter().sum::<f64>() / d.len() as f64;
    let variance = d.iter().map(|x| (x - moyenne).powi(2)).sum::<f64>() / d.len() as f64;
    let ecart = variance.sqrt();
    if !(ecart.is_finite() && ecart > 0.0) {
        return None;
    }
    let mut best = (f64::NEG_INFINITY, 0usize);
    for (i, &x) in d.iter().enumerate() {
        let z = (x - moyenne) / ecart;
        if z > best.0 {
            best = (z, i);
        }
    }
    // Seules les différences POSITIVES comptent : une chute d'énergie au passage d'un cadrage
    // au suivant se lit comme une hausse de `E[i+1] − E[i]` du côté où les zéros disparaissent.
    (best.0 > 0.0).then_some(best)
}

/// Le score d'un fichier pour un jeu de paramètres : somme circulaire des blocs retenus.
///
/// Un vrai cadrage produit des pics au MÊME endroit modulo le saut, d'un bloc à l'autre ; un pic
/// fortuit tombe n'importe où. En polaire — rayon le score, angle l'index modulo le saut — les
/// premiers s'additionnent et les seconds s'annulent. Le papier prend la somme et non la
/// moyenne (§ IV.B, correctif), ce qui récompense aussi le nombre de blocs concordants.
pub fn score_fichier(
    signal: &[f32],
    jeu: Jeu,
    bloc_len: usize,
    blocs_max: usize,
    fils_max: Option<usize>,
) -> Option<Trace> {
    let s = saut(jeu.n);
    let w = jeu.fenetre.echantillons_n(jeu.n);
    if signal.len() < bloc_len {
        return None;
    }
    let dispo = signal.len() / bloc_len;
    let n_blocs = dispo.min(blocs_max).max(1);
    // Blocs étalés sur toute la durée : un fichier ne se juge pas sur son intro.
    let pas = if n_blocs > 1 {
        (dispo - 1) / (n_blocs - 1)
    } else {
        1
    };

    let mut x = 0.0f64;
    let mut y = 0.0f64;
    let mut retenus = 0usize;
    // Rejet des blocs à score faible (§ IV.B : « we also discarded the audio blocks which
    // returned very low scores »). Sans lui, la somme circulaire dégénère en « ×nombre de
    // blocs » et ne distingue plus quelques blocs très concordants d'un tas de blocs bruités.
    // 3 écarts-types : un maximum de z sur `s` points dépasse cela rarement par hasard.
    const REJET_Z: f64 = 3.0;
    let mut index_gagnant = 0usize;
    let mut meilleur_r = 0.0f64;
    let mut somme_r = 0.0f64;
    let mut alignes = 0usize;
    // Le reste modulo 128 de chaque bloc retenu : 128 cases, comptées sans allocation.
    let mut restes = [0usize; 128];

    for b in 0..n_blocs {
        let debut = b * pas * bloc_len;
        let fin = (debut + bloc_len).min(signal.len());
        if fin <= debut + 2 * jeu.n {
            continue;
        }
        let Some((r, idx)) = score_bloc(&signal[debut..fin], jeu.n, &w, fils_max) else {
            continue;
        };
        if r < REJET_Z {
            continue;
        }
        // L'angle porte sur le cadrage ABSOLU dans le fichier, pas sur l'index local au bloc.
        // Les blocs ne commencent pas à des multiples du saut — `44100 mod 1024 = 68` — donc un
        // transcodage réel verrait son index local TOURNER d'un bloc à l'autre, et la somme
        // circulaire annulerait précisément ce qu'elle doit additionner.
        let absolu = (debut + idx) % s;
        let theta = 2.0 * std::f64::consts::PI * absolu as f64 / s as f64;
        x += r * theta.cos();
        y += r * theta.sin();
        somme_r += r;
        retenus += 1;
        if absolu % GRILLE_COURTE == 0 {
            alignes += 1;
        }
        restes[absolu % 128] += 1;
        if r > meilleur_r {
            meilleur_r = r;
            index_gagnant = absolu;
        }
    }

    // Sans plusieurs blocs concordants, il n'y a pas de mesure — pas un score faible, PAS de
    // mesure. C'est la même règle que partout ailleurs dans le détecteur : une absence ne se
    // déguise jamais en valeur basse.
    let resultante = (x * x + y * y).sqrt();
    let (reste_modal, reste_modal_compte) = restes
        .iter()
        .enumerate()
        .max_by_key(|&(_, c)| *c)
        .map(|(i, &c)| (i, c))
        .unwrap_or((0, 0));
    (retenus >= BLOCS_CONCORDANTS_MIN.min(n_blocs)).then(|| Trace {
        jeu,
        score: resultante,
        blocs_retenus: retenus,
        alignement: alignes as f64 / retenus as f64,
        reste_modal,
        reste_modal_compte,
        // `somme_r` est une somme de `r` tous ≥ REJET_Z > 0, et `retenus > 0` ici : le
        // dénominateur ne peut pas être nul sur ce chemin.
        concordance: resultante / somme_r,
        index: index_gagnant,
    })
}

/// Fraction de blocs alignés au-delà de laquelle un cadrage d'encodeur est ÉTABLI.
///
/// MESURÉ le 2026-09-15 sur le corpus étiqueté, 30 blocs d'une demi-seconde, jeux `vorbis` et
/// `wma` :
///
/// | famille | alignement min .. méd .. max | reste modal |
/// |---|---|---|
/// | `wma192` (10) | 0,966 .. 1,000 .. 1,000 | 0 pour 10/10 |
/// | `vorbisq5` (10) | 0,933 .. 1,000 .. 1,000 | 64 pour 10/10 |
/// | `genuine` (10) | 0,000 .. 0,000 .. 0,050 | dix valeurs différentes |
///
/// Au hasard la fraction vaut `1/64 ≈ 0,016`. Le seuil est posé à mi-chemin sur l'échelle, très
/// loin des deux groupes : les vrais sont 19 fois au-dessus des authentiques, et aucun seuil de
/// SCORE ne sépare aussi bien — `vorbisq5` descend à 26 quand un authentique monte à 41.
pub const ALIGNEMENT_MIN: f64 = 0.5;

/// Blocs retenus en deçà desquels l'alignement n'est pas une mesure.
///
/// Une fraction sur deux blocs vaut 0, 0,5 ou 1 : elle franchirait [`ALIGNEMENT_MIN`] sur un seul
/// coup de chance à `1/64`. Huit blocs mettent le hasard d'un franchissement à `P(X ≥ 4)` pour
/// `X ~ B(8, 1/64)`, soit environ `4·10⁻⁶`.
pub const BLOCS_ALIGNEMENT_MIN: usize = 8;

/// Le jeu le mieux ALIGNÉ parmi ceux qui reposent sur assez de blocs — **sans appliquer le seuil
/// de décision**.
///
/// Sépare deux choses que [`cadrage_etabli`] confondait. [`BLOCS_ALIGNEMENT_MIN`] est une
/// condition d'EXISTENCE de la mesure : une fraction calculée sur moins de huit blocs n'est pas un
/// alignement faible, c'est une absence — exactement ce que le doc de [`BLOCS_CONCORDANTS_MIN`]
/// dit déjà de son propre compte. [`ALIGNEMENT_MIN`] est un seuil de DÉCISION, et il a vocation à
/// devenir le dénominateur d'un rapport, comme les `λ` des deux autres bancs.
///
/// Le SCORE n'entre pas dans le classement : il varie de 26 à 953 chez les vrais transcodages et
/// monte à 41 chez les authentiques, il ne classe rien.
pub fn mieux_aligne(traces: &[Trace]) -> Option<Trace> {
    traces
        .iter()
        // `is_finite` et pas seulement le compte de blocs : `total_cmp` classe `NaN` AU-DESSUS de
        // tout, donc une trace d'alignement non fini gagnerait le maximum et ferait rendre `None`
        // à [`cadrage_etabli`] — masquant un jeu parfaitement aligné juste à côté. Une valeur non
        // finie n'est pas un alignement faible, c'est une absence de mesure, et ce module ne
        // déguise jamais l'une en l'autre.
        .filter(|t| t.blocs_retenus >= BLOCS_ALIGNEMENT_MIN && t.alignement.is_finite())
        .max_by(|a, b| a.alignement.total_cmp(&b.alignement))
        .copied()
}

/// Le cadrage d'un encodeur MDCT, s'il est établi.
///
/// Rend le jeu dont l'alignement est le plus fort, à condition qu'il dépasse [`ALIGNEMENT_MIN`]
/// sur au moins [`BLOCS_ALIGNEMENT_MIN`] blocs. **Le score n'entre pas dans la décision** — il
/// varie de 26 à 953 chez les vrais et monte à 41 chez les authentiques, donc il ne sépare pas ;
/// il reste dans la trace pour le journal.
///
/// Réécrite le 2026-09-15 par-dessus [`mieux_aligne`], à comportement identique : le maximum par
/// alignement de l'ensemble filtré par le nombre de blocs est ≥ tout autre élément de ce même
/// ensemble, donc appliquer le seuil avant ou après le maximum ne peut pas changer le résultat.
///
/// ⚠️ Cette équivalence a été revendiquée SANS le cas `NaN`, et elle y était fausse : `total_cmp`
/// classe `NaN` au-dessus de tout, donc `[NaN, 0,9]` rendait `Some(0,9)` sous l'ancienne forme
/// (où `NaN >= ALIGNEMENT_MIN` est faux, donc filtré) et `None` sous la nouvelle (où `NaN` gagne
/// le maximum, puis tombe au seuil). Mesuré. [`mieux_aligne`] écarte désormais les valeurs non
/// finies, ce qui rétablit l'équivalence sur TOUTES les entrées, pas seulement sur celles que
/// [`score_fichier`] sait produire.
///
/// Le RESTE MODAL n'entre pas non plus dans la décision, et c'est délibéré : `wma192` rend 0 et
/// `vorbisq5` rend 64, mais ces deux valeurs sortent d'UN encodeur chacune (ffmpeg `wmav2`,
/// ffmpeg `libvorbis`). Exiger un reste précis ferait dépendre le verdict d'une phase de départ
/// qui n'est mesurée que sur ces deux-là. Tomber SUR la grille est la propriété générale ;
/// l'endroit exact ne l'est pas. Le reste est rendu à l'appelant pour le journal, où il nomme le
/// codec probable sans engager la décision.
pub fn cadrage_etabli(traces: &[Trace]) -> Option<Trace> {
    mieux_aligne(traces).filter(|t| t.alignement >= ALIGNEMENT_MIN)
}

/// Le meilleur jeu pour un signal déjà réduit en mono, et tous les scores pour inspection.
pub fn balayer(
    signal: &[f32],
    jeux: &[Jeu],
    bloc_len: usize,
    blocs_max: usize,
    fils_max: Option<usize>,
) -> Vec<Trace> {
    jeux.iter()
        .filter_map(|&j| score_fichier(signal, j, bloc_len, blocs_max, fils_max))
        .collect()
}

/// Réduit un PCM entrelacé en mono, comme le papier (§ IV.B, « after taking the average over the
/// channels »).
pub fn mono(pcm: &[f32], channels: u16) -> Vec<f32> {
    let ch = channels.max(1) as usize;
    if ch == 1 {
        return pcm.to_vec();
    }
    pcm.chunks_exact(ch)
        .map(|t| t.iter().sum::<f32>() / ch as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un signal qui n'est jamais passé par un codec ne doit pas produire de cadrage franc.
    ///
    /// Du bruit blanc n'a ni trous spectraux ni périodicité : ses différences d'énergie sont du
    /// bruit, donc le score standard maximal reste modeste et les index tombent au hasard d'un
    /// bloc à l'autre, ce que la somme circulaire annule. Le seuil de 8 n'est pas calibré — il
    /// vaut comme garde-fou grossier, et la calibration viendra du corpus.
    #[test]
    fn du_bruit_blanc_ne_porte_pas_de_cadrage() {
        let mut x = 0x1234_5678u32;
        let signal: Vec<f32> = (0..4 * BLOC)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x as f32 / u32::MAX as f32) - 0.5
            })
            .collect();
        let t =
            score_fichier(&signal, JEUX[0], BLOC, 3, None).expect("assez long pour être mesuré");
        eprintln!(
            "bruit blanc : score {:.2} sur {} blocs",
            t.score, t.blocs_retenus
        );
        assert!(
            t.score < 8.0,
            "le bruit blanc ne doit pas simuler un cadrage : {}",
            t.score
        );
    }

    /// Toutes les positions de cadrage moyennent le MÊME nombre de trames.
    ///
    /// C'est la gate du piège le plus vicieux de cette mesure. Borner chaque décalage par la fin
    /// du bloc faisait chuter le compte d'une trame en franchissant `(L − 2n) mod s` : une marche
    /// d'énergie déterministe, au même index dans chaque bloc, quel que soit le fichier. Elle se
    /// serait lue comme un cadrage, et la somme circulaire l'aurait récompensée PLUS qu'une vraie
    /// détection, puisqu'un artefact de fenêtrage ne tourne pas d'un bloc à l'autre.
    ///
    /// Le test le mesure par sa conséquence, sur du bruit blanc — un signal sans cadrage : les
    /// différences d'énergie doivent rester du bruit, donc leur maximum en score standard doit
    /// rester modeste. Avec le compte variable, ce maximum explosait. Mesuré par mutation :
    /// remettre la borne `p + 2n <= bloc.len()` le fait tomber.
    #[test]
    fn toutes_les_positions_moyennent_le_meme_nombre_de_trames() {
        let mut x = 0x0bad_c0deu32;
        let bloc: Vec<f32> = (0..BLOC)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x as f32 / u32::MAX as f32) - 0.5
            })
            .collect();
        let n = 1024;
        let w = Fenetre::Kbd.echantillons_n(n);
        let (z, idx) = score_bloc(&bloc, n, &w, None).expect("bloc assez long");
        eprintln!("bruit blanc : z max {z:.2} à l'index {idx}");
        assert!(
            z < 6.0,
            "une marche déterministe subsiste dans les énergies : z = {z} à l'index {idx}"
        );
    }

    /// Une trace factice, pour exercer la DÉCISION sans faire tourner un balayage.
    fn trace(alignement: f64, blocs_retenus: usize, score: f64) -> Trace {
        Trace {
            jeu: JEUX[0],
            score,
            blocs_retenus,
            concordance: alignement,
            alignement,
            reste_modal: 0,
            reste_modal_compte: blocs_retenus,
            index: 0,
        }
    }

    /// **Un alignement non fini est une absence, pas un maximum.**
    ///
    /// `total_cmp` classe `NaN` au-dessus de tout — c'est son contrat, et c'est ce qui rend
    /// `max_by` total sur les flottants. La conséquence est piégeuse ici : sans le filtre
    /// `is_finite` de [`mieux_aligne`], une seule trace non finie masquerait un jeu parfaitement
    /// aligné du même fichier, et `cadrage_etabli` rendrait `None` là où l'ancienne forme rendait
    /// le bon jeu.
    ///
    /// `score_fichier` ne peut pas produire un tel alignement — c'est `alignes / retenus` avec
    /// `retenus >= 1`. Ce test passe donc par le constructeur de traces, comme le fera n'importe
    /// quel appelant futur qui assemble des traces autrement.
    ///
    /// MUTATION : retirer `&& t.alignement.is_finite()` de [`mieux_aligne`] — la première
    /// assertion tombe, `None` au lieu du jeu à 0,95.
    #[test]
    fn un_alignement_non_fini_ne_masque_pas_un_jeu_bien_aligne() {
        let bon = trace(0.95, 30, 40.0);
        let mut casse = trace(0.0, 30, 1.0);
        casse.alignement = f64::NAN;

        let gagnant = cadrage_etabli(&[casse, bon])
            .expect("le jeu à 0,95 doit gagner malgré la trace non finie");
        assert_eq!(gagnant.alignement, 0.95);

        assert!(
            cadrage_etabli(&[casse]).is_none(),
            "une trace non finie seule ne rend aucun cadrage"
        );
        assert!(
            mieux_aligne(&[casse]).is_none(),
            "elle ne rend pas non plus un maximum : ce n'est pas une mesure"
        );
    }

    /// Les trois refus et l'acceptation de [`cadrage_etabli`], aux bornes mesurées.
    ///
    /// Les valeurs ne sont pas inventées : 0,933 est le plus BAS des vingt vrais transcodages du
    /// corpus et 0,136 le plus HAUT des 83 authentiques mesurés. Un test qui passerait sur
    /// 0,9 contre 0,1 ne dirait rien de la marge réelle.
    #[test]
    fn le_cadrage_ne_setablit_quau_dessus_du_seuil_et_sur_assez_de_blocs() {
        let vrai = trace(0.933, 30, 25.97);
        let faux = trace(0.136, 22, 66.79);
        assert!(
            cadrage_etabli(&[vrai]).is_some(),
            "le plus bas vrai transcodage mesuré doit passer"
        );
        assert!(
            cadrage_etabli(&[faux]).is_none(),
            "le plus haut authentique mesuré ne doit pas passer, malgré un score bien plus élevé"
        );
        assert!(
            cadrage_etabli(&[trace(1.0, BLOCS_ALIGNEMENT_MIN - 1, 900.0)]).is_none(),
            "un alignement parfait sur trop peu de blocs n'est pas une mesure"
        );
        // Entre deux jeux qui passent, c'est l'ALIGNEMENT qui départage, pas le score : le score
        // varie de 26 à 953 chez les vrais, il ne classe rien.
        let gagnant = cadrage_etabli(&[trace(0.6, 30, 900.0), trace(0.95, 30, 30.0)])
            .expect("deux jeux au-dessus du seuil : un gagnant");
        assert_eq!(
            gagnant.alignement, 0.95,
            "le mieux aligné gagne, même avec un score 30 fois plus faible"
        );
    }

    /// La réduction en mono moyenne bien les canaux, et laisse un mono intact.
    #[test]
    fn le_mono_moyenne_les_canaux() {
        assert_eq!(mono(&[1.0, 3.0, -2.0, 0.0], 2), vec![2.0, -1.0]);
        assert_eq!(mono(&[1.0, 2.0, 3.0], 1), vec![1.0, 2.0, 3.0]);
    }

    /// L'absence de mesure sort en `None`, elle ne se déguise pas en score nul.
    #[test]
    fn un_signal_trop_court_ou_muet_ne_rend_aucune_mesure() {
        assert!(
            score_fichier(&[0.0; 100], JEUX[0], BLOC, 4, None).is_none(),
            "trop court"
        );
        // Silence numérique exact : toutes les énergies valent le plancher, donc l'écart-type
        // des différences est nul et le score standard n'existe pas.
        assert!(
            score_fichier(&vec![0.0f32; 4 * BLOC], JEUX[0], BLOC, 3, None).is_none(),
            "le silence n'a pas de cadrage"
        );
    }
}

#[cfg(test)]
mod corpus {
    use super::*;

    /// Harnais de mesure — imprime du CSV, ne juge rien. Modèle : `analysis::corpus::corpus_scan`.
    ///
    /// ```text
    /// SIFT_FRAMING_DIR=<dossier> cargo test --manifest-path src-tauri/Cargo.toml --release
    ///   framing_scan -- --ignored --nocapture
    /// ```
    ///
    /// `SIFT_FRAMING_BLOCS` change le nombre de blocs (défaut [`BLOCS`]). `--release` est
    /// obligatoire : la mesure fait une MDCT par échantillon analysé et par jeu.
    #[test]
    #[ignore]
    fn framing_scan() {
        let Ok(dir) = std::env::var("SIFT_FRAMING_DIR") else {
            eprintln!("SIFT_FRAMING_DIR non défini — rien à mesurer");
            return;
        };
        let blocs: usize = std::env::var("SIFT_FRAMING_BLOCS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(BLOCS);
        // `SIFT_FRAMING_BLOC` : durée d'un bloc en échantillons. `SIFT_FRAMING_JEUX` : les
        // `vise` à garder, séparés par une virgule. Les deux servent à mesurer ce que coûte,
        // en détection, chaque réduction du coût de calcul.
        let bloc_len: usize = std::env::var("SIFT_FRAMING_BLOC")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|&v: &usize| v > 0)
            .unwrap_or(BLOC);
        let choisis = std::env::var("SIFT_FRAMING_JEUX").ok();
        let jeux: Vec<Jeu> = match &choisis {
            Some(liste) => JEUX
                .iter()
                .filter(|j| liste.split(',').any(|v| v.trim() == j.vise))
                .copied()
                .collect(),
            None => JEUX.to_vec(),
        };
        if jeux.is_empty() {
            eprintln!("SIFT_FRAMING_JEUX ne désigne aucun jeu connu");
            return;
        }

        // Le nom de fichier EN DERNIER : un « ; » dans un titre décalerait toutes les colonnes
        // suivantes (piège mesuré le 2026-08-18 sur une vraie clé USB).
        // `contraste` = meilleur score / médiane des autres jeux. Le score BRUT n'est pas
        // comparable d'un jeu à l'autre : le maximum d'un score standard sur `s` points croît
        // comme la racine du logarithme de `s`, et `s` vaut ici 576, 1024 ou 2048 selon le jeu.
        // Le grand `N` serait donc favorisé partout, et on lirait ce biais comme une détection.
        // Le rapport aux autres jeux du MÊME fichier annule ce biais.
        print!("meilleur;concorde;aligne;reste;restec;contraste;vise;index;blocs;secondes");
        for j in jeux.iter() {
            print!(";{}", j.vise);
        }
        println!(";fichier");

        let mut vus = 0usize;
        for e in walkdir::WalkDir::new(&dir).into_iter().flatten() {
            if !e.file_type().is_file() {
                continue;
            }
            let path = e.path();
            let ext = path
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !matches!(
                ext.as_str(),
                "flac" | "wav" | "aif" | "aiff" | "m4a" | "mp3" | "ogg"
            ) {
                continue;
            }
            let name = path.file_name().and_then(|x| x.to_str()).unwrap_or("?");
            vus += 1;

            let mut pcm: Vec<f32> = Vec::new();
            let info = match crate::analysis::decode::decode_pcm(&path.to_string_lossy(), 2, |b| {
                pcm.extend_from_slice(b)
            }) {
                Ok(v) => v,
                Err(err) => {
                    println!(
                        "ERREUR;-;-;-;-;-;-;-;-;-{};{name} ({err})",
                        ";-".repeat(jeux.len())
                    );
                    continue;
                }
            };
            let signal = mono(&pcm, info.channels);
            let t0 = std::time::Instant::now();
            let traces = balayer(&signal, &jeux, bloc_len, blocs, None);
            let secondes = t0.elapsed().as_secs_f64();

            // Le jeu retenu se choisit par ALIGNEMENT, comme [`mieux_aligne`] — et donc comme
            // la décision que ce harnais est censé préfigurer.
            //
            // ⚠️ Il choisissait par SCORE jusqu'au 2026-09-15, et cet écart a produit une
            // conclusion FAUSSE : le balayage de `blocs_max` donnait 10 non, 12 oui, 16 oui,
            // 20 NON, 30 oui, ce qui se lisait comme une méthode instable. La non-monotonie
            // tenait à un seul fichier — `src09_vorbisq5` à 20 blocs, où le jeu `wma` marque
            // 24,50 contre 20,06 pour `vorbis`, donc le harnais retenait `wma` et publiait SON
            // alignement (0,105) pendant que `vorbis` était à 1,000. Le score ne classe rien : il
            // va de 26 à 953 chez les vrais et monte à 41 chez les authentiques.
            //
            // `mieux_aligne` n'est pas appelée ici : elle filtre sur `BLOCS_ALIGNEMENT_MIN`, et un
            // harnais doit voir AUSSI ce qui est sous le seuil d'existence — c'est son travail de
            // montrer où la mesure cesse d'exister.
            let Some(best) = traces
                .iter()
                .max_by(|a, b| a.alignement.total_cmp(&b.alignement))
                .copied()
            else {
                println!(
                    "NON-MESURE;-;-;-;-;-;-;-;-;{secondes:.1}{};{name}",
                    ";-".repeat(jeux.len())
                );
                continue;
            };
            let mut autres: Vec<f64> = traces
                .iter()
                .filter(|t| !(t.jeu.n == best.jeu.n && t.jeu.fenetre == best.jeu.fenetre))
                .map(|t| t.score)
                .collect();
            autres.sort_by(f64::total_cmp);
            let mediane = if autres.is_empty() {
                0.0
            } else {
                autres[autres.len() / 2]
            };
            let contraste = if mediane > 0.0 {
                best.score / mediane
            } else {
                f64::INFINITY
            };
            print!(
                "{:.2};{:.3};{:.3};{};{};{contraste:.2};{};{};{};{secondes:.1}",
                best.score,
                best.concordance,
                best.alignement,
                best.reste_modal,
                best.reste_modal_compte,
                best.jeu.vise,
                best.index,
                best.blocs_retenus
            );
            // Une colonne par jeu, en ALIGNEMENT : c'est la statistique qui décide. Le score du
            // jeu retenu reste en première colonne, pour le journal et pour l'historique des
            // mesures antérieures au 2026-09-15 — mais il ne classe rien.
            for j in jeux.iter() {
                let a = traces
                    .iter()
                    .find(|t| t.jeu.n == j.n && t.jeu.fenetre == j.fenetre)
                    .map(|t| t.alignement)
                    .unwrap_or(0.0);
                print!(";{a:.3}");
            }
            println!(";{name}");
        }
        println!(
            "-- {vus} fichiers, {blocs} blocs de {bloc_len}, jeux {:?}",
            jeux.iter().map(|j| j.vise).collect::<Vec<_>>()
        );
        assert!(vus > 0, "aucun fichier audio dans {dir} — mesure vide");
    }
}
