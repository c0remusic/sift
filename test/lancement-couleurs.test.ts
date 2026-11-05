// Le raccord natif → HTML du lancement : `lancement_natif.rs` peint avant que la page existe, donc
// il ne peut pas lire `styles.css`. Ses couleurs sont une copie, et ce test la tient contre les
// tokens : un token qui bouge sans sa copie se verrait à l'écran comme un saut de couleur.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("frontend/styles.css", "utf8");
const rust = readFileSync("src-tauri/src/lancement_natif.rs", "utf8");

/** oklch → sRGB 8 bits, formules de Björn Ottosson (CSS Color 4). */
function oklchVersRgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  const octet = (x: number) => Math.round(Math.min(1, Math.max(0, gamma(x))) * 255);
  return [octet(lin[0]), octet(lin[1]), octet(lin[2])];
}

/** Valeur d'un token dans le bloc qui commence à `depuis` (0 : `:root`, thème clair). */
function token(nom: string, depuis: number): [number, number, number] {
  const m = css.slice(depuis).match(new RegExp(`--${nom}:oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
  if (!m) throw new Error(`token ${nom} introuvable`);
  return oklchVersRgb(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
}

function champ(nomConst: string, champNom: string): [number, number, number] {
  const bloc = rust.match(new RegExp(`${nomConst}: Couleurs = Couleurs \\{[^}]*\\}`))?.[0] ?? "";
  const m = bloc.match(new RegExp(`${champNom}: 0x([0-9a-fA-F]{6})`));
  if (!m) throw new Error(`champ ${champNom} introuvable dans ${nomConst}`);
  const v = parseInt(m[1], 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
}

const sombre = css.indexOf(':root[data-theme="dark"]');

describe("couleurs du lancement natif", () => {
  it.each([
    ["CLAIR", "fond", "color-background-tertiary", 0],
    ["CLAIR", "ambre", "color-hue-orange-solid", 0],
    ["CLAIR", "vert", "color-hue-green-solid", 0],
    ["SOMBRE", "fond", "color-background-tertiary", sombre],
    ["SOMBRE", "ambre", "color-text-warning", sombre],
    ["SOMBRE", "vert", "color-text-success", sombre],
  ])("%s.%s suit --%s", (c, ch, t, depuis) => {
    expect(sombre).toBeGreaterThan(0);
    const attendu = token(t, depuis);
    const vu = champ(c, ch);
    for (let i = 0; i < 3; i++) expect(Math.abs(attendu[i] - vu[i])).toBeLessThanOrEqual(1);
  });
});
