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
                "echantillon {i} : {reconstruit} contre {} attendu",
                signal[N + i]
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
            "energie hors du voisinage du bin {K} : {:.2} % dedans seulement",
            100.0 * voisinage / total
        );
    }
}
