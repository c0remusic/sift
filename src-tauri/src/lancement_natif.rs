//! Le mark fixe du lancement, peint avant que WebView2 existe (décision #95).
//!
//! POURQUOI UNE FENÊTRE À PART. La fenêtre `main` est visible à ≈ 50 ms, mais WebView2 prend ensuite
//! ≈ 410 ms de création, sur le fil principal et dans le code de Tauri, puis la page ≈ 450 ms. Rien
//! de Sift ne peut peindre dans `main` pendant ce temps. `main` reste donc cachée, et une fenêtre
//! Win32 sans webview, sur son propre fil, montre le fond et le mark dès le lancement.
//!
//! LE RELAIS. La page peint la même pose (`frontend/lancement.ts`), puis appelle
//! [`lancement_peint`] : `main` se montre SOUS cette fenêtre, qui est au premier plan, et celle-ci
//! se ferme une fois `main` peinte. Le raccord est invisible parce que les deux dessins sont le
//! même : `peindre` reprend la géométrie de `brand/mark.svg`, et ses couleurs sont tenues contre
//! `styles.css` par `test/lancement-couleurs.test.ts`.
//!
//! Hors Windows, pas de fenêtre native : `main` se montre dès que la page a peint.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Runtime};

/// Couleurs en 0xRRGGBB, copies des tokens lus par `#sift-lancement` dans `styles.css`.
#[derive(Clone, Copy)]
struct Couleurs {
    fond: u32,
    ambre: u32,
    vert: u32,
}

const CLAIR: Couleurs = Couleurs {
    fond: 0xe5e5ea,
    ambre: 0xff9500,
    vert: 0x34c759,
};

const SOMBRE: Couleurs = Couleurs {
    fond: 0x2c2c2e,
    ambre: 0xf2c274,
    vert: 0x9fe0af,
};

/// Largeur du mark en part de la largeur de fenêtre : `#sift-lancement .sift-lance-mark` (18vw).
const PART_DU_MARK: f64 = 0.18;

/// Distance signée à un rectangle arrondi centré en (cx, cy), négative à l'intérieur.
fn distance(x: f64, y: f64, cx: f64, cy: f64, demi: f64, rayon: f64) -> f64 {
    let (qx, qy) = ((x - cx).abs() - demi + rayon, (y - cy).abs() - demi + rayon);
    qx.max(qy).min(0.0) + (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() - rayon
}

fn melanger(dessous: u32, dessus: u32, part: f64) -> u32 {
    let canal = |decalage: u32| {
        let a = f64::from((dessous >> decalage) & 255);
        let b = f64::from((dessus >> decalage) & 255);
        ((a + (b - a) * part).round() as u32) << decalage
    };
    canal(16) | canal(8) | canal(0)
}

/// Peint le fond et le mark, centré, en pixels 0x00RRGGBB, ligne par ligne depuis le haut.
///
/// Coordonnées de `brand/mark.svg` : viewBox de 190 à 810, carré ambre en contour de 52 unités
/// tourné de -16° autour de (424, 424), carré vert plein de 394 à 803. L'ambre passe dessous.
fn peindre(largeur: usize, hauteur: usize, c: Couleurs) -> Vec<u32> {
    let mut pixels = vec![c.fond; largeur * hauteur];
    let cote = largeur as f64 * PART_DU_MARK;
    let echelle = 620.0 / cote;
    let gauche = (largeur as f64 - cote) / 2.0;
    let haut = (hauteur as f64 - cote) / 2.0;
    let (sin, cos) = 16f64.to_radians().sin_cos();
    let couvrir = |d: f64| (0.5 - d / echelle).clamp(0.0, 1.0);
    let x_max = ((gauche + cote).ceil() as usize + 1).min(largeur);
    let y_max = ((haut + cote).ceil() as usize + 1).min(hauteur);
    for py in (haut.floor().max(0.0) as usize)..y_max {
        for px in (gauche.floor().max(0.0) as usize)..x_max {
            let u = 190.0 + (px as f64 + 0.5 - gauche) * echelle;
            let v = 190.0 + (py as f64 + 0.5 - haut) * echelle;
            let (du, dv) = (u - 424.0, v - 424.0);
            let (lu, lv) = (du * cos - dv * sin + 424.0, du * sin + dv * cos + 424.0);
            let trait_ambre = distance(lu, lv, 424.0, 424.0, 178.5, 84.0).abs() - 26.0;
            let plein_vert = distance(u, v, 598.5, 598.5, 204.5, 110.0);
            let p = &mut pixels[py * largeur + px];
            *p = melanger(*p, c.ambre, couvrir(trait_ambre));
            *p = melanger(*p, c.vert, couvrir(plein_vert));
        }
    }
    pixels
}

/// `main` montrée une seule fois, par la page ou par la garde.
static MONTREE: AtomicBool = AtomicBool::new(false);

/// Délai laissé à `main` pour peindre sa première image, derrière la fenêtre native.
const PEINTURE_DE_MAIN: std::time::Duration = std::time::Duration::from_millis(150);

/// Si la page ne dit rien (script cassé), `main` se montre quand même.
const GARDE: std::time::Duration = std::time::Duration::from_secs(8);

fn montrer<R: Runtime>(app: &AppHandle<R>) {
    if MONTREE.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(w) = app.get_webview_window("main") else {
        log::error!("fenêtre principale introuvable au lancement");
        fermer();
        return;
    };
    if let Err(e) = w.show().and_then(|()| w.set_focus()) {
        log::error!("fenêtre principale non montrée : {e}");
    }
    std::thread::sleep(PEINTURE_DE_MAIN);
    // `set_focus` échoue sans bruit quand Windows refuse le premier plan : lancée pendant qu'une
    // autre app a le focus, `main` restait dessous et disparaissait à la fermeture de la fenêtre
    // native. Le passage en « toujours devant » la remonte sans demander le focus. Pas avant la
    // pause : elle couvrirait alors la fenêtre native avec une image pas encore peinte.
    if let Err(e) = w.set_always_on_top(true) {
        log::warn!("fenêtre principale non remontée : {e}");
    }
    fermer();
    if let Err(e) = w.set_always_on_top(false) {
        log::warn!("fenêtre principale restée devant : {e}");
    }
}

/// La page a peint la pose de départ : `main` prend le relais de la fenêtre native. Rend la main une
/// fois celle-ci fermée, pour que le geste de la page parte visible.
#[tauri::command]
pub async fn lancement_peint(app: AppHandle) -> Result<(), String> {
    crate::ipc::hors_du_fil(move || {
        montrer(&app);
        Ok(())
    })
    .await
}

/// Plugin posé juste après `single-instance` : un second lancement s'arrête là, sans rien peindre,
/// et tout ce qui suit dans `Builder::build` (WebView2 compris) est couvert.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("lancement-natif")
        .setup(|app, _api| {
            ouvrir(app);
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(GARDE);
                montrer(&app);
            });
            Ok(())
        })
        .build()
}

/// Position et taille de `main`, telles que `window-state` les restaurera.
#[derive(Debug, PartialEq)]
struct Place {
    x: i32,
    y: i32,
    largeur: i32,
    hauteur: i32,
    agrandie: bool,
}

fn lire_place(json: &str) -> Option<Place> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let m = v.get("main")?;
    let entier = |k: &str| m.get(k)?.as_i64().and_then(|n| i32::try_from(n).ok());
    Some(Place {
        x: entier("x")?,
        y: entier("y")?,
        largeur: entier("width")?,
        hauteur: entier("height")?,
        agrandie: m.get("maximized")?.as_bool()?,
    })
}

#[cfg(windows)]
fn ouvrir<R: Runtime>(app: &AppHandle<R>) {
    let place = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(".window-state.json")).ok())
        .and_then(|j| lire_place(&j));
    let base = app.path().app_data_dir().ok().map(|d| d.join("sift.db"));
    std::thread::spawn(move || {
        let reglage = base.and_then(|p| lire_theme(&p));
        let couleurs = match reglage.as_deref() {
            Some("light") => CLAIR,
            Some("dark") => SOMBRE,
            _ if win::systeme_en_clair() => CLAIR,
            _ => SOMBRE,
        };
        win::boucle(place, couleurs);
    });
}

#[cfg(not(windows))]
fn ouvrir<R: Runtime>(_app: &AppHandle<R>) {}

/// Le thème choisi dans Réglages, sans attendre la connexion de `setup`. Base absente ou ancienne :
/// `None`, et la fenêtre suit le système comme `auto`.
#[cfg(windows)]
fn lire_theme(base: &std::path::Path) -> Option<String> {
    let conn = rusqlite::Connection::open_with_flags(
        base,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    crate::settings::get(&conn, "ui_theme").ok()?
}

#[cfg(windows)]
fn fermer() {
    win::fermer();
}

#[cfg(not(windows))]
fn fermer() {}

#[cfg(windows)]
mod win {
    use super::{peindre, Couleurs, Place};
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::OnceLock;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, EndPaint, GetMonitorInfoW, MonitorFromPoint, SetDIBitsToDevice, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        PAINTSTRUCT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    use windows::Win32::UI::HiDpi::{
        GetDpiForMonitor, GetDpiForSystem, GetSystemMetricsForDpi, MDT_EFFECTIVE_DPI,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetSystemMetrics,
        PostMessageW, PostQuitMessage, RegisterClassW, TranslateMessage, MSG, SM_CXPADDEDBORDER,
        SM_CXSCREEN, SM_CXSIZEFRAME, SM_CYSCREEN, SW_SHOWNOACTIVATE, WM_CLOSE, WM_DESTROY,
        WM_ERASEBKGND, WM_PAINT, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_POPUP,
    };

    /// 0 : aucune fenêtre ouverte.
    static FENETRE: AtomicIsize = AtomicIsize::new(0);
    static IMAGE: OnceLock<(i32, i32, Vec<u32>)> = OnceLock::new();

    pub fn systeme_en_clair() -> bool {
        let mut valeur = 1u32;
        let mut taille = std::mem::size_of::<u32>() as u32;
        // SAFETY: `valeur` et `taille` sont des locales vivantes pendant tout l'appel, et `taille`
        // annonce exactement les 4 octets de `valeur`. RRF_RT_REG_DWORD refuse tout autre type, donc
        // l'API n'écrit jamais plus que ce tampon. Les deux chaînes sont des littéraux `w!`
        // terminés par NUL. En cas d'échec, `valeur` garde 1, soit le clair de Windows.
        unsafe {
            let _ = RegGetValueW(
                HKEY_CURRENT_USER,
                w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
                w!("AppsUseLightTheme"),
                RRF_RT_REG_DWORD,
                None,
                Some(std::ptr::from_mut(&mut valeur).cast()),
                Some(&mut taille),
            );
        }
        valeur != 0
    }

    /// Ce que `main` mesure de plus que la taille enregistrée. `window-state` enregistre et restaure
    /// la taille intérieure, or la fenêtre sans décoration garde le style à bordure épaisse et la
    /// page occupe tout le rectangle : mesuré à 96 dpi, 1200×820 enregistrés donnent 1216×829 de zone
    /// cliente, soit le cadre à gauche, à droite et en bas, et 1 pixel en haut.
    fn cadre(dpi: u32) -> (i32, i32) {
        // SAFETY: ces deux appels ne prennent que des valeurs et ne retiennent rien.
        let f = unsafe {
            GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi)
                + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
        };
        (2 * f, f + 1)
    }

    /// Rectangle de la fenêtre : celui de `main`, sinon sa taille par défaut, centrée.
    fn rectangle(place: Option<Place>) -> (i32, i32, i32, i32) {
        match place {
            Some(p) if p.agrandie => {
                let mut info = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                let centre = POINT {
                    x: p.x + p.largeur / 2,
                    y: p.y + p.hauteur / 2,
                };
                // SAFETY: `MonitorFromPoint` ne prend que des valeurs et rend toujours un écran avec
                // MONITOR_DEFAULTTONEAREST. `info` est une locale initialisée dont `cbSize` annonce
                // la taille exacte, lue et écrite pendant l'appel seulement.
                let ok = unsafe {
                    let ecran = MonitorFromPoint(centre, MONITOR_DEFAULTTONEAREST);
                    GetMonitorInfoW(ecran, &mut info).as_bool()
                };
                let RECT {
                    left,
                    top,
                    right,
                    bottom,
                } = info.rcWork;
                if ok {
                    (left, top, right - left, bottom - top)
                } else {
                    (p.x, p.y, p.largeur, p.hauteur)
                }
            }
            Some(p) => {
                let (mut dpi_x, mut dpi_y) = (96, 96);
                let point = POINT { x: p.x, y: p.y };
                // SAFETY: `MonitorFromPoint` ne prend que des valeurs. `dpi_x` et `dpi_y` sont des
                // locales écrites pendant l'appel seulement ; en cas d'échec elles gardent 96.
                unsafe {
                    let ecran = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
                    let _ = GetDpiForMonitor(ecran, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
                }
                let (cl, ch) = cadre(dpi_x);
                (p.x, p.y, p.largeur + cl, p.hauteur + ch)
            }
            None => {
                // SAFETY: ces trois fonctions ne prennent que des valeurs et ne retiennent rien.
                let (ecran_l, ecran_h, dpi) = unsafe {
                    (
                        GetSystemMetrics(SM_CXSCREEN),
                        GetSystemMetrics(SM_CYSCREEN),
                        GetDpiForSystem() as i32,
                    )
                };
                let (cl, ch) = cadre(dpi as u32);
                let (l, h) = (1200 * dpi / 96 + cl, 820 * dpi / 96 + ch);
                ((ecran_l - l) / 2, (ecran_h - h) / 2, l, h)
            }
        }
    }

    /// SAFETY de l'appelant : appelée par Windows sur le fil de la fenêtre, avec une `HWND` valide.
    unsafe extern "system" fn procedure(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_ERASEBKGND => LRESULT(1),
            WM_PAINT => {
                let mut ps = PAINTSTRUCT::default();
                let hdc = BeginPaint(hwnd, &mut ps);
                if let Some((l, h, pixels)) = IMAGE.get() {
                    let info = BITMAPINFO {
                        bmiHeader: BITMAPINFOHEADER {
                            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                            biWidth: *l,
                            // Négatif : lignes depuis le haut, comme `peindre` les écrit.
                            biHeight: -*h,
                            biPlanes: 1,
                            biBitCount: 32,
                            biCompression: BI_RGB.0,
                            ..Default::default()
                        },
                        ..Default::default()
                    };
                    SetDIBitsToDevice(
                        hdc,
                        0,
                        0,
                        *l as u32,
                        *h as u32,
                        0,
                        0,
                        0,
                        *h as u32,
                        pixels.as_ptr().cast(),
                        &info,
                        DIB_RGB_COLORS,
                    );
                }
                let _ = EndPaint(hwnd, &ps);
                LRESULT(0)
            }
            WM_DESTROY => {
                FENETRE.store(0, Ordering::SeqCst);
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    /// Crée la fenêtre et pompe ses messages jusqu'à [`fermer`]. Tourne sur son propre fil.
    pub fn boucle(place: Option<Place>, couleurs: Couleurs) {
        let (x, y, l, h) = rectangle(place);
        if l <= 0 || h <= 0 {
            log::error!("lancement natif : rectangle vide {l}×{h}");
            return;
        }
        let _ = IMAGE.set((l, h, peindre(l as usize, h as usize, couleurs)));
        // SAFETY: la classe et le titre sont des littéraux `w!`, statiques. `procedure` est une
        // `extern "system"` à la signature de WNDPROC, et `IMAGE`, qu'elle lit, est statique et
        // posée avant la création. `MSG` et les rectangles sont des locales. La `HWND` rendue n'est
        // utilisée que sur ce fil, sauf par `PostMessageW`, que Windows autorise depuis tout fil.
        // `preference` vit pendant l'appel, et sa taille est calculée sur elle-même.
        unsafe {
            let Ok(module) = GetModuleHandleW(PCWSTR::null()) else {
                return;
            };
            let classe = w!("SiftLancement");
            let definition = WNDCLASSW {
                lpfnWndProc: Some(procedure),
                hInstance: module.into(),
                lpszClassName: classe,
                ..Default::default()
            };
            RegisterClassW(&definition);
            let hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                classe,
                w!("Sift"),
                WS_POPUP,
                x,
                y,
                l,
                h,
                None,
                None,
                Some(module.into()),
                None,
            );
            let Ok(hwnd) = hwnd else {
                log::error!("lancement natif : fenêtre non créée");
                return;
            };
            let preference = DWMWCP_ROUND;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                std::ptr::from_ref(&preference).cast(),
                std::mem::size_of_val(&preference) as u32,
            );
            FENETRE.store(hwnd.0 as isize, Ordering::SeqCst);
            let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    /// Demande la fermeture depuis n'importe quel fil. Sans fenêtre, ne fait rien.
    pub fn fermer() {
        let brut = FENETRE.load(Ordering::SeqCst);
        if brut == 0 {
            return;
        }
        // SAFETY: `PostMessageW` accepte une poignée périmée, il rend alors une erreur sans rien
        // déréférencer. `WM_CLOSE` ne porte aucun pointeur.
        unsafe {
            let _ = PostMessageW(
                Some(HWND(brut as *mut std::ffi::c_void)),
                WM_CLOSE,
                WPARAM(0),
                LPARAM(0),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const L: usize = 1000;
    const H: usize = 700;

    fn pixel(p: &[u32], x: usize, y: usize) -> u32 {
        p[y * L + x]
    }

    /// Sonde au centre de chaque forme, en coordonnées du `viewBox` de `brand/mark.svg`.
    fn en_pixels(u: f64, v: f64) -> (usize, usize) {
        let cote = L as f64 * PART_DU_MARK;
        let x = (L as f64 - cote) / 2.0 + (u - 190.0) * cote / 620.0;
        let y = (H as f64 - cote) / 2.0 + (v - 190.0) * cote / 620.0;
        (x as usize, y as usize)
    }

    #[test]
    fn le_mark_se_peint_a_sa_place() {
        let p = peindre(L, H, SOMBRE);
        assert_eq!(p.len(), L * H);
        assert_eq!(pixel(&p, 5, 5), SOMBRE.fond);
        let (x, y) = en_pixels(598.5, 598.5);
        assert_eq!(pixel(&p, x, y), SOMBRE.vert, "le vert passe devant l'ambre");
        // Milieu du côté gauche de l'ambre, avant rotation : (245.5 - 26 + 26, 424).
        let (du, dv) = (245.5 - 424.0, 0.0f64);
        let (sin, cos) = (-16f64).to_radians().sin_cos();
        let (x, y) = en_pixels(du * cos - dv * sin + 424.0, du * sin + dv * cos + 424.0);
        assert_eq!(pixel(&p, x, y), SOMBRE.ambre);
        // Le creux du contour reste au fond.
        let (x, y) = en_pixels(340.0, 340.0);
        assert_eq!(pixel(&p, x, y), SOMBRE.fond);
    }

    /// Une fenêtre minuscule ne déborde pas du tampon.
    #[test]
    fn une_petite_fenetre_ne_deborde_pas() {
        assert_eq!(peindre(3, 2, CLAIR).len(), 6);
    }

    #[test]
    fn la_place_se_lit_dans_le_fichier_de_window_state() {
        let j = r#"{"main":{"width":1670,"height":1058,"x":933,"y":74,"prev_x":933,"prev_y":74,
            "maximized":false,"visible":true,"decorated":false,"fullscreen":false}}"#;
        assert_eq!(
            lire_place(j),
            Some(Place {
                x: 933,
                y: 74,
                largeur: 1670,
                hauteur: 1058,
                agrandie: false
            })
        );
        assert_eq!(lire_place("{}"), None);
        assert_eq!(lire_place("pas du json"), None);
    }
}
