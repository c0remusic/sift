//! MDCT — la transformée dans laquelle les codecs AAC/MP3 quantifient réellement.
//!
//! POURQUOI ce module existe, et ce qu'il ne prétend pas. Le chantier
//! `docs/superpowers/changes/2026-08-17-detecteur-corpus/` a établi par la mesure que l'AAC à
//! débit élevé reste invisible à tout ce qu'on sait faire : `aac256` et `aacmf256` sont ratés 9/10
//! après l'entrée de la platitude dans le verdict. Trois statistiques de « trous » calculées sur
//! notre FFT Hann 4096 ont été essayées et réfutées — 1/10 sur dix sources.
//!
//! La cause probable, écrite dans le review : **notre FFT n'est pas la transformée du codec**. Un
//! encodeur AAC quantifie dans une MDCT à fenêtres 2048/256 avec commutation, à un décalage de
//! trame inconnu ; une FFT d'une autre base, d'une autre fenêtre et d'un autre alignement étale
//! cette structure jusqu'à l'effacer.
//!
//! ⚠️ **Ce module ne détecte rien pour l'instant.** Il porte la transformée, et rien de plus. Que
//! la structure de quantification survive au décodage puis se retrouve depuis un FLAC, c'est
//! l'hypothèse qu'il sert à tester — pas un acquis. Rien ici n'est branché sur `verdict()`.
//!
//! Coût : implémentation DIRECTE en O(N²), sans passer par `rustfft`. C'est un choix de sonde —
//! une MDCT rapide se factorise par une FFT complexe de N/2 points avec pré/post-rotation, et
//! l'écrire d'abord reviendrait à optimiser un chemin dont on ignore encore s'il mesure quelque
//! chose. À refaire si une sonde aboutit et doit tourner sur une bibliothèque.

/// Fenêtre sinus, celle des blocs longs AAC et MP3.
///
/// `w[n] = sin(pi/(2N) * (n + 0.5))` sur `2N` échantillons. Elle satisfait la condition de
/// Princen-Bradley (`w[n]² + w[n+N]² = 1`), qui est ce qui rend l'annulation du repliement
/// temporel possible — sans elle, la MDCT n'est pas inversible par recouvrement.
pub fn sine_window(two_n: usize) -> Vec<f32> {
    (0..two_n)
        .map(|n| (std::f32::consts::PI / two_n as f32 * (n as f32 + 0.5)).sin())
        .collect()
}

/// MDCT d'une trame de `2N` échantillons vers `N` coefficients.
///
/// `X[k] = Σ x[n] · cos(π/N · (n + 1/2 + N/2) · (k + 1/2))`
///
/// Le décalage `N/2` dans la phase n'est pas cosmétique : c'est lui qui place le repliement
/// temporel aux bons endroits, donc c'est lui qui permet à deux trames voisines de se reconstruire
/// mutuellement.
///
/// Panique si `frame.len()` est impair — une trame MDCT a toujours une longueur paire par
/// définition, et un appelant qui n'en fournit pas une s'est trompé de découpe.
pub fn mdct(frame: &[f32]) -> Vec<f32> {
    assert!(
        frame.len() % 2 == 0,
        "trame MDCT de longueur impaire : {}",
        frame.len()
    );
    let n = frame.len() / 2;
    let nf = n as f32;
    (0..n)
        .map(|k| {
            let mut acc = 0.0f32;
            for (idx, &x) in frame.iter().enumerate() {
                let phase =
                    std::f32::consts::PI / nf * (idx as f32 + 0.5 + nf / 2.0) * (k as f32 + 0.5);
                acc += x * phase.cos();
            }
            acc
        })
        .collect()
}

/// MDCT à base précalculée — même transformée que [`mdct`], sans les appels à `cos()`.
///
/// La sonde d'alignement demande la MDCT de la MÊME taille des milliers de fois : pour chaque
/// trame et chaque décalage candidat. [`mdct`] recalcule alors `2N × N` cosinus à chaque appel —
/// 2 millions pour N = 1024 — et c'est là que passe tout le temps, pas dans les multiplications.
///
/// La base coûte `2N × N` flottants en mémoire, soit 8 Mo pour N = 1024. Acceptable pour une
/// sonde ; ce n'est toujours PAS une MDCT rapide (une vraie se factorise par une FFT complexe de
/// N/2 points), et ça reste O(N²) par trame.
pub struct MdctPlan {
    n: usize,
    /// `n × 2n`, rangée `k` = les coefficients de la ligne `k` de la base.
    basis: Vec<f32>,
}

impl MdctPlan {
    pub fn new(n: usize) -> Self {
        let nf = n as f32;
        let mut basis = Vec::with_capacity(n * 2 * n);
        for k in 0..n {
            for idx in 0..2 * n {
                let phase =
                    std::f32::consts::PI / nf * (idx as f32 + 0.5 + nf / 2.0) * (k as f32 + 0.5);
                basis.push(phase.cos());
            }
        }
        Self { n, basis }
    }

    /// Panique si la trame ne fait pas `2N` — une trame d'une autre taille n'est pas un cas
    /// dégradé à rattraper, c'est un appelant qui s'est trompé de plan.
    pub fn transform(&self, frame: &[f32]) -> Vec<f32> {
        assert_eq!(
            frame.len(),
            2 * self.n,
            "trame de {} pour un plan a {}",
            frame.len(),
            2 * self.n
        );
        (0..self.n)
            .map(|k| {
                let row = &self.basis[k * 2 * self.n..(k + 1) * 2 * self.n];
                row.iter().zip(frame).map(|(b, x)| b * x).sum()
            })
            .collect()
    }
}

/// IMDCT — `N` coefficients vers `2N` échantillons, à recouvrir-additionner avec la trame voisine.
///
/// Seule ne rend PAS le signal : chaque moitié porte un repliement temporel que seule la trame
/// suivante annule. C'est le principe même de la transformée, et c'est ce que le test de
/// reconstruction vérifie.
///
/// Existe pour ce test, justement : sans inverse, rien ne distingue une MDCT correcte d'une
/// somme de cosinus au terme de phase faux — les deux « localisent » un sinus dans le bon bin.
pub fn imdct(coeffs: &[f32]) -> Vec<f32> {
    let n = coeffs.len();
    let nf = n as f32;
    (0..2 * n)
        .map(|idx| {
            let mut acc = 0.0f32;
            for (k, &c) in coeffs.iter().enumerate() {
                let phase =
                    std::f32::consts::PI / nf * (idx as f32 + 0.5 + nf / 2.0) * (k as f32 + 0.5);
                acc += c * phase.cos();
            }
            acc * 2.0 / nf
        })
        .collect()
}

/// Sonde d'alignement — le harnais de recherche, pas un détecteur.
///
/// L'idée testée, et pourquoi elle diffère des trois formulations déjà réfutées : celles-là
/// mesuraient une sparsité ABSOLUE, et le review a conclu que « les valeurs absolues sont pilotées
/// par le matériau, pas par le codec » — un morceau clairsemé l'est sur toutes les mesures, faux
/// ou pas. Ici on mesure le CONTRASTE entre le meilleur décalage de trame et le décalage médian.
///
/// Ce que ça change : un master n'a aucune raison d'avoir un alignement privilégié, donc son
/// contraste doit rester proche de 1 quel que soit son matériau. Un fichier passé par un encodeur
/// AAC a été quantifié sur UNE grille, et si quelque chose en survit, ça doit apparaître à un
/// décalage et pas aux autres. Le rapport élimine le niveau absolu, donc le matériau.
///
/// ⚠️ Hypothèse, pas résultat. Rien ne dit que la structure survive au décodage puis au ré-encodage
/// FLAC.
///
/// **Ce qui est mesuré (2026-08-18) : le pic est étroit.** Sur une grille de 32, 10 sources ×
/// {aac256, aacmf256} donnent 17/20 au-dessus du plus haut authentique — mais en décalant l'entrée
/// de 17 échantillons, ce taux tombe à 5/20 et le décalage retenu cesse d'être 0. Le pic fait donc
/// moins de ±16 échantillons de large : une grille grossière ne le trouve QUE sur des fichiers
/// fabriqués depuis l'échantillon 0, c'est-à-dire les nôtres. D'où le repérage au pas de 1.
#[cfg(test)]
mod sonde {
    use super::*;

    const N: usize = 1024; // bloc long AAC : fenêtre 2048, 1024 coefficients
    /// Pas de la grille de RÉFÉRENCE, celle qui donne la médiane. Elle n'a pas besoin d'être fine :
    /// elle sert à établir le niveau ordinaire, pas à trouver un pic.
    const PAS_REFERENCE: usize = 32;
    /// Trames du repérage — peu, parce qu'il tourne sur les 1024 décalages.
    const TRAMES_REPERAGE: usize = 8;
    const TRAMES: usize = 60;
    const BANDE_LO_HZ: f32 = 8000.0;
    const BANDE_HI_HZ: f32 = 16000.0;
    /// Un coefficient compte comme « creux » sous ce rapport à la RMS de sa bande dans sa trame.
    const SEUIL_CREUX: f32 = 0.1;

    fn decode_mono(path: &str) -> Result<(Vec<f32>, u32), String> {
        let mut pcm = Vec::new();
        let info = crate::analysis::decode::decode_pcm(path, 1, |b| pcm.extend_from_slice(b))?;
        // `SIFT_MDCT_SKIP` retire des échantillons de tête AVANT toute analyse, et ce n'est pas
        // une commodité : les faux du corpus sont encodés depuis l'échantillon 0, donc leur grille
        // de trames tombe pile sur un point de la grille de recherche. Un fichier réel rogné, lui,
        // a un alignement quelconque. Sonder avec un décalage premier avec `PAS_DECALAGE` est le
        // seul moyen de savoir si le contraste mesuré est une propriété du signal ou un cadeau de
        // la façon dont on a fabriqué le corpus.
        let skip: usize = std::env::var("SIFT_MDCT_SKIP")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        if skip > 0 && skip < pcm.len() {
            pcm.drain(..skip);
        }
        Ok((pcm, info.sample_rate))
    }

    /// Fraction moyenne de coefficients creux dans la bande, sur `TRAMES` trames réparties.
    fn creux_au_decalage(
        pcm: &[f32],
        plan: &MdctPlan,
        w: &[f32],
        decalage: usize,
        bins: (usize, usize),
        n_max: usize,
    ) -> f32 {
        let (lo, hi) = bins;
        let dispo = (pcm.len().saturating_sub(decalage + 2 * N)) / N;
        if dispo == 0 {
            return f32::NAN;
        }
        let pas = (dispo / n_max).max(1);
        let mut somme = 0.0f32;
        let mut n_trames = 0usize;
        let mut trame = vec![0.0f32; 2 * N];
        for f in (0..dispo).step_by(pas).take(n_max) {
            let debut = decalage + f * N;
            for i in 0..2 * N {
                trame[i] = pcm[debut + i] * w[i];
            }
            let x = plan.transform(&trame);
            let bande = &x[lo..hi];
            let rms = (bande.iter().map(|v| v * v).sum::<f32>() / bande.len() as f32).sqrt();
            if rms <= f32::EPSILON {
                continue; // trame silencieuse : tout y est « creux », ça ne dit rien du codec
            }
            let creux = bande.iter().filter(|v| v.abs() < SEUIL_CREUX * rms).count();
            somme += creux as f32 / bande.len() as f32;
            n_trames += 1;
        }
        if n_trames == 0 {
            f32::NAN
        } else {
            somme / n_trames as f32
        }
    }

    /// `SIFT_MDCT_PATHS="a.flac;b.flac" cargo test --manifest-path src-tauri/Cargo.toml --release
    ///   mdct_alignment -- --ignored --nocapture`
    ///
    /// `--release` obligatoire : la transformée reste en O(N²), et un fichier coûte 32 décalages ×
    /// 60 trames × 2,1 M multiplications.
    #[test]
    #[ignore]
    fn mdct_alignment() {
        let Ok(liste) = std::env::var("SIFT_MDCT_PATHS") else {
            eprintln!("SIFT_MDCT_PATHS non défini — rien à sonder");
            return;
        };
        let plan = MdctPlan::new(N);
        let w = sine_window(2 * N);
        println!("fichier;sr;meilleur_decalage;creux_max;creux_median;contraste");
        let mut vus = 0usize;
        for path in liste.split(';').filter(|p| !p.trim().is_empty()) {
            let (pcm, sr) = match decode_mono(path.trim()) {
                Ok(v) => v,
                Err(e) => {
                    // Un échec est une ligne, pas un silence.
                    println!("{};ERREUR;-;-;-;{e}", nom(path));
                    continue;
                }
            };
            vus += 1;
            let hz_par_bin = sr as f32 / (2.0 * N as f32);
            let lo = (BANDE_LO_HZ / hz_par_bin).ceil() as usize;
            let hi = ((BANDE_HI_HZ / hz_par_bin).floor() as usize).min(N);
            // ÉTAGE 1 — repérage, tous les décalages, peu de trames.
            //
            // Le pas de 1 n'est pas du zèle : mesuré le 2026-08-18, décaler l'entrée de 17
            // échantillons fait tomber le taux de 17/20 à 5/20 sur une grille de 32. Le pic est
            // donc plus étroit que ±16, et une grille grossière ne le trouve QUE sur des fichiers
            // fabriqués depuis l'échantillon 0 — c'est-à-dire les nôtres, et pas ceux d'un DJ.
            let grossier: Vec<f32> = (0..N)
                .map(|d| creux_au_decalage(&pcm, &plan, &w, d, (lo, hi), TRAMES_REPERAGE))
                .collect();
            let Some((decalage_max, _)) = grossier
                .iter()
                .enumerate()
                .filter(|(_, v)| v.is_finite())
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            else {
                println!("{};{sr};ERREUR;-;-;aucune trame", nom(path));
                continue;
            };

            // ÉTAGE 2 — mesure. Le maximum ET la médiane se recalculent avec le MÊME nombre de
            // trames, sinon le rapport compare une estimation fine à une estimation grossière et
            // le contraste devient un artefact du protocole.
            let max = creux_au_decalage(&pcm, &plan, &w, decalage_max, (lo, hi), TRAMES);
            let mut valeurs: Vec<f32> = (0..N)
                .step_by(PAS_REFERENCE)
                .map(|d| creux_au_decalage(&pcm, &plan, &w, d, (lo, hi), TRAMES))
                .filter(|v| v.is_finite())
                .collect();
            if !max.is_finite() || valeurs.is_empty() {
                println!("{};{sr};ERREUR;-;-;aucune trame", nom(path));
                continue;
            }
            valeurs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let median = valeurs[valeurs.len() / 2];
            println!(
                "{};{sr};{decalage_max};{max:.4};{median:.4};{:.4}",
                nom(path),
                max / median
            );
        }
        assert!(vus > 0, "aucun fichier sonde — mesure vide");
    }

    fn nom(path: &str) -> &str {
        path.rsplit(['/', '\\']).next().unwrap_or(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **La propriété qui pinne vraiment une MDCT** : deux trames voisines se reconstruisent
    /// mutuellement, exactement.
    ///
    /// Ce que ça attrape et que le test de localisation ne peut pas : le terme de phase. Une somme
    /// de cosinus dont le décalage `N/2` serait faux range TOUJOURS un sinus dans le bon bin — elle
    /// ne reconstruit simplement rien. La vérité de référence ici est le signal d'entrée lui-même,
    /// pas une valeur recalculée comme le code la calcule.
    ///
    /// Le signal est déterministe (un générateur congruentiel écrit sur place) : un test qui
    /// échouerait une fois sur mille selon le tirage ne serait pas un test.
    #[test]
    fn deux_trames_voisines_reconstruisent_le_signal() {
        const N: usize = 64;

        let mut graine = 12345u32;
        let signal: Vec<f32> = (0..3 * N)
            .map(|_| {
                graine = graine.wrapping_mul(1664525).wrapping_add(1013904223);
                (graine >> 16) as f32 / 32768.0 - 1.0
            })
            .collect();

        let w = sine_window(2 * N);
        let analyse = |offset: usize| {
            let trame: Vec<f32> = (0..2 * N).map(|i| signal[offset + i] * w[i]).collect();
            let y = imdct(&mdct(&trame));
            y.iter()
                .zip(w.iter())
                .map(|(v, wi)| v * wi)
                .collect::<Vec<f32>>()
        };

        let a = analyse(0);
        let b = analyse(N);

        // Le segment [N, 2N) est le seul que DEUX trames couvrent — c'est là, et seulement là, que
        // le repliement s'annule.
        for i in 0..N {
            let reconstruit = a[N + i] + b[i];
            assert!(
                (reconstruit - signal[N + i]).abs() < 1e-3,
                "échantillon {i} : {reconstruit} contre {} attendu",
                signal[N + i]
            );
        }
    }

    /// La base précalculée doit rendre EXACTEMENT ce que rend la transformée directe.
    ///
    /// Vérité de référence : [`mdct`], déjà tenue par le test de reconstruction. C'est le seul cas
    /// de ce module où recalculer la même chose est légitime — c'est précisément la question posée,
    /// « ces deux chemins sont-ils le même ».
    ///
    /// Tolérance relative à l'amplitude des coefficients, pas absolue : la somme se fait dans un
    /// ordre différent, donc les arrondis f32 diffèrent, et un seuil absolu serait soit trop lâche
    /// sur les petits coefficients soit trop serré sur les grands.
    #[test]
    fn la_base_precalculee_rend_la_meme_chose_que_la_directe() {
        const N: usize = 32;

        let mut graine = 999u32;
        let frame: Vec<f32> = (0..2 * N)
            .map(|_| {
                graine = graine.wrapping_mul(1664525).wrapping_add(1013904223);
                (graine >> 16) as f32 / 32768.0 - 1.0
            })
            .collect();

        let attendu = mdct(&frame);
        let obtenu = MdctPlan::new(N).transform(&frame);
        let echelle = attendu.iter().fold(0.0f32, |m, v| m.max(v.abs()));

        for (k, (a, b)) in attendu.iter().zip(&obtenu).enumerate() {
            assert!(
                (a - b).abs() < 1e-4 * echelle,
                "coefficient {k} : {b} contre {a}"
            );
        }
    }

    /// Un sinus pile au centre d'un bin doit concentrer son énergie DANS ce bin.
    ///
    /// La valeur attendue ne vient pas d'un recalcul de la formule — elle vient de ce qu'une
    /// transformée est censée FAIRE : la fréquence centrale du bin `k` d'une MDCT de `N` points à
    /// `sr` est `(k + 1/2) · sr / 2N`, et une transformée qui ne range pas cette fréquence-là dans
    /// ce bin-là n'est pas une MDCT, quelle que soit l'élégance de son code.
    #[test]
    fn un_sinus_au_centre_dun_bin_y_concentre_son_energie() {
        const N: usize = 64;
        const SR: f32 = 44100.0;
        const K: usize = 17;

        let f = (K as f32 + 0.5) * SR / (2.0 * N as f32);
        let w = sine_window(2 * N);
        let frame: Vec<f32> = (0..2 * N)
            .map(|i| (2.0 * std::f32::consts::PI * f * i as f32 / SR).sin() * w[i])
            .collect();

        let x = mdct(&frame);
        let total: f32 = x.iter().map(|v| v * v).sum();
        let argmax = x
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).unwrap())
            .map(|(i, _)| i)
            .unwrap();

        assert_eq!(argmax, K, "le pic n'est pas dans le bin attendu");

        // Le bin seul ne porte que 38 % : une MDCT n'est pas invariante par translation, et la
        // part exacte dépend de la phase du sinus dans la trame. Ce qui est une propriété de la
        // transformée, et pas un accident de cette entrée-ci, c'est que tout se joue dans le bin
        // et ses deux voisins. Mesuré ici : 99,12 % — la borne est posée en dessous avec marge,
        // pour ne pas transformer un test de localisation en test de troisième décimale.
        let voisinage: f32 = x[K - 1..=K + 1].iter().map(|v| v * v).sum();
        assert!(
            voisinage / total > 0.95,
            "énergie hors du voisinage du bin {K} : {:.2} % dedans seulement",
            100.0 * voisinage / total
        );
    }
}
