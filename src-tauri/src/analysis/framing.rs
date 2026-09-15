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
//! ⚠️ Ce module MESURE, il ne décide rien. Aucun seuil n'y vit, aucun verdict ne le lit encore :
//! il est branché sur le seul harnais `corpus::framing_scan` tant que la mesure sur le corpus
//! n'a pas dit ce qu'il vaut.

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
    /// Position du cadrage la plus fréquente, modulo le saut — informative seulement.
    pub index: usize,
}

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
fn energies_par_decalage(bloc: &[f32], n: usize, w: &[f32]) -> Option<Vec<f64>> {
    let s = saut(n);
    let deux_n = 2 * n;
    // Le décalage `s` est le plus contraint : c'est lui qui fixe le compte commun.
    if bloc.len() < s + deux_n {
        return None;
    }
    let trames = (bloc.len() - s - deux_n) / s + 1;
    let plan = MdctFast::new(n);
    let mut trame = vec![0.0f32; deux_n];
    let mut coeffs = vec![0.0f64; n];
    let mut e = vec![0.0f64; s + 1];

    for (i, ei) in e.iter_mut().enumerate() {
        let mut acc_bloc = 0.0f64;
        for k in 0..trames {
            let p = i + k * s;
            for (t, (x, wi)) in bloc[p..p + deux_n].iter().zip(w.iter()).enumerate() {
                trame[t] = x * wi;
            }
            plan.transform_f64_into(&trame, &mut coeffs);
            // Moyenne des coefficients EN dB, pas le dB de la moyenne : c'est la première qui
            // laisse un coefficient annulé peser, et c'est tout l'intérêt de la mesure.
            let mut acc = 0.0f64;
            for &c in coeffs.iter() {
                acc += 20.0 * c.abs().max(PLANCHER).log10();
            }
            acc_bloc += acc / n as f64;
        }
        *ei = acc_bloc / trames as f64;
    }
    Some(e)
}

/// Le couple (score, index) d'un bloc : différences successives, score standard, maximum.
///
/// Rend `None` quand la mesure n'existe pas — bloc trop court pour une seule trame, ou
/// différences toutes identiques (silence numérique), cas où l'écart-type est nul et le score
/// standard indéfini. Jamais une valeur par défaut : c'est la règle du dépôt sur l'absence de
/// mesure, la même que pour `verdict()`.
fn score_bloc(bloc: &[f32], n: usize, w: &[f32]) -> Option<(f64, usize)> {
    let e = energies_par_decalage(bloc, n, w)?;
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
pub fn score_fichier(signal: &[f32], jeu: Jeu, bloc_len: usize, blocs_max: usize) -> Option<Trace> {
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

    for b in 0..n_blocs {
        let debut = b * pas * bloc_len;
        let fin = (debut + bloc_len).min(signal.len());
        if fin <= debut + 2 * jeu.n {
            continue;
        }
        let Some((r, idx)) = score_bloc(&signal[debut..fin], jeu.n, &w) else {
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
        retenus += 1;
        if r > meilleur_r {
            meilleur_r = r;
            index_gagnant = absolu;
        }
    }

    (retenus > 0).then(|| Trace {
        jeu,
        score: (x * x + y * y).sqrt(),
        blocs_retenus: retenus,
        index: index_gagnant,
    })
}

/// Le meilleur jeu pour un signal déjà réduit en mono, et tous les scores pour inspection.
pub fn balayer(signal: &[f32], jeux: &[Jeu], bloc_len: usize, blocs_max: usize) -> Vec<Trace> {
    jeux.iter()
        .filter_map(|&j| score_fichier(signal, j, bloc_len, blocs_max))
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
        let t = score_fichier(&signal, JEUX[0], BLOC, 3).expect("assez long pour être mesuré");
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
        let (z, idx) = score_bloc(&bloc, n, &w).expect("bloc assez long");
        eprintln!("bruit blanc : z max {z:.2} à l'index {idx}");
        assert!(
            z < 6.0,
            "une marche déterministe subsiste dans les énergies : z = {z} à l'index {idx}"
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
            score_fichier(&[0.0; 100], JEUX[0], BLOC, 4).is_none(),
            "trop court"
        );
        // Silence numérique exact : toutes les énergies valent le plancher, donc l'écart-type
        // des différences est nul et le score standard n'existe pas.
        assert!(
            score_fichier(&vec![0.0f32; 4 * BLOC], JEUX[0], BLOC, 3).is_none(),
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

        // Le nom de fichier EN DERNIER : un « ; » dans un titre décalerait toutes les colonnes
        // suivantes (piège mesuré le 2026-08-18 sur une vraie clé USB).
        // `contraste` = meilleur score / médiane des autres jeux. Le score BRUT n'est pas
        // comparable d'un jeu à l'autre : le maximum d'un score standard sur `s` points croît
        // comme la racine du logarithme de `s`, et `s` vaut ici 576, 1024 ou 2048 selon le jeu.
        // Le grand `N` serait donc favorisé partout, et on lirait ce biais comme une détection.
        // Le rapport aux autres jeux du MÊME fichier annule ce biais.
        print!("meilleur;contraste;vise;index;blocs;secondes");
        for j in JEUX.iter() {
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
                    println!("ERREUR;-;-;-;-;-{};{name} ({err})", ";-".repeat(JEUX.len()));
                    continue;
                }
            };
            let signal = mono(&pcm, info.channels);
            let t0 = std::time::Instant::now();
            let traces = balayer(&signal, &JEUX, BLOC, blocs);
            let secondes = t0.elapsed().as_secs_f64();

            let Some(best) = traces
                .iter()
                .max_by(|a, b| a.score.total_cmp(&b.score))
                .copied()
            else {
                println!(
                    "NON-MESURE;-;-;-;-;{secondes:.1}{};{name}",
                    ";-".repeat(JEUX.len())
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
                "{:.2};{contraste:.2};{};{};{};{secondes:.1}",
                best.score, best.jeu.vise, best.index, best.blocs_retenus
            );
            for j in JEUX.iter() {
                let s = traces
                    .iter()
                    .find(|t| t.jeu.n == j.n && t.jeu.fenetre == j.fenetre)
                    .map(|t| t.score)
                    .unwrap_or(0.0);
                print!(";{s:.2}");
            }
            println!(";{name}");
        }
        println!("-- {vus} fichiers parcourus, {blocs} blocs par fichier");
        assert!(vus > 0, "aucun fichier audio dans {dir} — mesure vide");
    }
}
