//! Langue des messages que le backend envoie À L'ÉCRAN — erreurs rendues par une commande IPC,
//! textes d'état que le front affiche tels quels.
//!
//! Le front tranche la langue (`frontend/lang-boot.ts`) et la pousse ici par `set_ui_lang` au
//! démarrage : le backend ne sait pas résoudre le choix `auto`, il n'a pas la langue de l'OS que
//! `navigator.language` donne à la webview. Jusqu'à ce premier appel, et dans tous les tests, la
//! langue est le français — ce qui garde vraies toutes les assertions écrites avant ce module.
//!
//! Un message s'écrit dans ses deux langues AU SITE, avec les mêmes arguments :
//!
//! ```ignore
//! return Err(crate::tr!("Fichier introuvable : {}", "File not found: {}", path.display()));
//! ```
//!
//! ⚠️ NE PAS TRADUIRE CE QUI EST UN PROTOCOLE. Les sentinelles de `shared/contracts.ts`
//! (`FILE_GONE`, `DRIVE_VANISHED`…), les chaînes que le front RECONNAÎT par `includes`/`startsWith`
//! (`"source gone"`, `"NoLibraryRoot"`), les lignes de journal (`eprintln!`, `log::`) : une
//! traduction les casserait en anglais seulement, sans une erreur de compilation ni un test rouge.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    Fr,
    En,
}

static LANG: AtomicU8 = AtomicU8::new(0);

// Surcharge PAR FIL, pour les tests seulement : `cargo test` fait tourner les tests en parallèle
// sur plusieurs fils, et un test qui écrirait l'atome global ferait passer en anglais les messages
// qu'un test voisin compare à du français.
#[cfg(test)]
thread_local! {
    static OVERRIDE: std::cell::Cell<Option<Lang>> = const { std::cell::Cell::new(None) };
}

/// La langue en vigueur.
pub fn lang() -> Lang {
    #[cfg(test)]
    if let Some(l) = OVERRIDE.with(|c| c.get()) {
        return l;
    }
    match LANG.load(Ordering::Relaxed) {
        1 => Lang::En,
        _ => Lang::Fr,
    }
}

pub fn set_lang(l: Lang) {
    LANG.store(
        match l {
            Lang::Fr => 0,
            Lang::En => 1,
        },
        Ordering::Relaxed,
    );
}

/// Le code de langue, réciproque de `parse` — pour la ligne de commande du processus élevé.
pub fn code(l: Lang) -> &'static str {
    match l {
        Lang::Fr => "fr",
        Lang::En => "en",
    }
}

/// `"fr"` / `"en"`, et rien d'autre : `auto` se résout côté front, jamais ici.
pub fn parse(s: &str) -> Option<Lang> {
    match s {
        "fr" => Some(Lang::Fr),
        "en" => Some(Lang::En),
        _ => None,
    }
}

/// Exécute `f` avec la langue `l` sur CE fil seulement.
#[cfg(test)]
pub fn with_lang<R>(l: Lang, f: impl FnOnce() -> R) -> R {
    OVERRIDE.with(|c| c.set(Some(l)));
    let r = f();
    OVERRIDE.with(|c| c.set(None));
    r
}

/// Formate le message dans la langue courante. Les deux gabarits reçoivent les MÊMES arguments :
/// un argument explicite qu'un seul des deux utiliserait est une erreur de compilation
/// (`argument never used`), ce qui empêche une traduction de perdre une valeur.
#[macro_export]
macro_rules! tr {
    ($fr:literal, $en:literal $(,)?) => {
        match $crate::i18n::lang() {
            $crate::i18n::Lang::Fr => ::std::fmt::format(format_args!($fr)),
            $crate::i18n::Lang::En => ::std::fmt::format(format_args!($en)),
        }
    };
    ($fr:literal, $en:literal, $($arg:tt)+) => {
        match $crate::i18n::lang() {
            $crate::i18n::Lang::Fr => ::std::fmt::format(format_args!($fr, $($arg)+)),
            $crate::i18n::Lang::En => ::std::fmt::format(format_args!($en, $($arg)+)),
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_francais_est_la_langue_par_defaut() {
        assert_eq!(lang(), Lang::Fr);
        assert_eq!(
            crate::tr!("Fichier introuvable", "File not found"),
            "Fichier introuvable"
        );
    }

    #[test]
    fn la_macro_suit_la_langue_et_garde_ses_arguments() {
        let n = 3;
        let fr = with_lang(Lang::Fr, || crate::tr!("{} pistes", "{} tracks", n));
        let en = with_lang(Lang::En, || crate::tr!("{} pistes", "{} tracks", n));
        assert_eq!(fr, "3 pistes");
        assert_eq!(en, "3 tracks");
        // Arguments capturés dans le gabarit, forme la plus courante du dépôt.
        let p = "a.flac";
        assert_eq!(
            with_lang(Lang::En, || crate::tr!("Lecture de {p}", "Reading {p}")),
            "Reading a.flac"
        );
    }

    #[test]
    fn la_surcharge_ne_fuit_pas_hors_de_son_appel() {
        with_lang(Lang::En, || assert_eq!(crate::tr!("oui", "yes"), "yes"));
        assert_eq!(crate::tr!("oui", "yes"), "oui");
    }

    #[test]
    fn seuls_fr_et_en_sont_acceptes() {
        assert_eq!(parse("fr"), Some(Lang::Fr));
        assert_eq!(parse("en"), Some(Lang::En));
        assert_eq!(parse("auto"), None);
        assert_eq!(parse("EN"), None);
        assert_eq!(parse(""), None);
    }
}
