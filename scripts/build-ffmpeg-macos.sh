#!/usr/bin/env bash
# Construit un ffmpeg macOS SANS composant GPL, pour remplacer les builds osxexperts epingles
# jusqu'au 2026-08-02 : `ffmpeg711arm` etait --enable-gpl, et `ffmpeg7intel` --enable-gpl ET
# --enable-nonfree (un binaire nonfree n'est redistribuable sous aucune licence).
#
# POURQUOI PAS `--disable-everything` : FFmpeg est LGPL PAR DEFAUT. Les builds publies sont GPL
# parce qu'ils activent explicitement x264/x265, pas parce que le socle le serait. Il suffit donc
# de ne PAS passer --enable-gpl et d'ajouter libmp3lame (LAME est LGPL-2.1). On garde ainsi tous
# les codecs natifs, et on evite le vrai risque d'un build chirurgical : oublier un demultiplexeur
# et casser un format d'entree en silence, sur une plateforme que personne ici ne peut tester.
#
# Sift n'utilise que trois encodeurs (`src-tauri/src/encode.rs:143-145`) mais decode des fichiers
# utilisateurs arbitraires : la generosite du cote decodage est voulue.
#
# Appele par `scripts/fetch-ffmpeg.mjs` sur macOS. Usage :
#   scripts/build-ffmpeg-macos.sh <chemin/du/binaire/de/sortie>

set -euo pipefail

OUT="${1:?usage: build-ffmpeg-macos.sh <output-binary-path>}"

# Version epinglee. La mettre a jour est un geste delibere, pas une derive : `latest` ferait
# changer le binaire distribue sans qu'aucun commit ne le dise. 8.1.2 est la derniere release
# stable au 2026-08-02 ; elle rapproche macOS du build Windows, qui tourne sur un instantane de
# master (N-125881), la ou l'ancienne source osxexperts restait en 7.1.1.
FFMPEG_VERSION="8.1.2"
# Empreinte CALCULEE sur le tarball reellement telecharge depuis ffmpeg.org le 2026-08-02, pas
# recopiee d'une page. ffmpeg.org ne publie pas de .sha256 (404) — seulement une signature GPG,
# dont l'usage demanderait d'epingler en plus une empreinte de cle. L'epingle ci-dessous protege
# donc contre une corruption de transfert et contre un changement silencieux du contenu sous une
# meme version ; elle ne remplace pas une verification de signature, et ne pretend pas le faire.
# La mettre a jour en meme temps que FFMPEG_VERSION, jamais separement.
FFMPEG_SHA256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Dependances (LAME)"
# LAME fournit libmp3lame. `brew` expose l'archive statique en plus de la dylib ; c'est elle
# qu'on veut, sinon le binaire irait chercher /opt/homebrew/lib sur la machine de l'utilisateur.
brew list lame >/dev/null 2>&1 || brew install lame
brew list nasm >/dev/null 2>&1 || brew install nasm
LAME_PREFIX="$(brew --prefix lame)"

if [ ! -f "$LAME_PREFIX/lib/libmp3lame.a" ]; then
  echo "ERREUR: $LAME_PREFIX/lib/libmp3lame.a absent — sans archive statique, ffmpeg lierait" >&2
  echo "        la dylib Homebrew, introuvable sur la machine de l'utilisateur." >&2
  exit 1
fi

echo "==> Sources FFmpeg $FFMPEG_VERSION"
cd "$WORK"
curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
echo "$FFMPEG_SHA256  ffmpeg.tar.xz" | shasum -a 256 -c - || {
  echo "ERREUR: l'archive telechargee ne correspond pas a FFMPEG_SHA256." >&2
  echo "        Attendu : $FFMPEG_SHA256" >&2
  echo "        Obtenu  : $(shasum -a 256 ffmpeg.tar.xz | awk '{print $1}')" >&2
  exit 1
}
tar xf ffmpeg.tar.xz
cd "ffmpeg-$FFMPEG_VERSION"

echo "==> configure (LGPL : ni --enable-gpl ni --enable-nonfree)"
# --disable-autodetect : LE drapeau qui rend ce build reproductible. Sans lui, `configure` lie
#   tout ce qu'il trouve installe sur la machine. Sur le runner GitHub, Homebrew fournit libxcb,
#   et ffmpeg activait donc `xcbgrab` (capture d'ecran X11, dont Sift n'a aucun usage) en tirant
#   six dylibs de /opt/homebrew -- introuvables sur le Mac de l'utilisateur. Attrape en CI le
#   2026-08-02 par la verification otool. Desactiver ces six-la une par une aurait ete du
#   colmatage : le prochain runner avec une autre bibliotheque installee aurait rejoue la scene.
#   BtbN fait le meme choix sur son build LGPL Windows (--disable-libxcb --disable-xlib).
#   Consequence : tout ce dont on a besoin doit etre demande EXPLICITEMENT ci-dessous.
# --enable-zlib : reclame explicitement puisque l'autodetection est coupee. Presente en systeme
#   (/usr/lib/libz), donc conforme a l'invariant otool.
# --disable-network : Sift ne lit que des fichiers locaux. Rien a gagner a garder les protocoles
#   reseau, et c'est autant de surface d'attaque en moins sur un binaire qui traite des fichiers
#   telecharges par l'utilisateur.
# --disable-ffplay/--disable-ffprobe : seul `ffmpeg` est bundle comme sidecar.
./configure \
  --prefix="$WORK/prefix" \
  --enable-static \
  --disable-shared \
  --pkg-config-flags=--static \
  --disable-autodetect \
  --extra-cflags="-I$LAME_PREFIX/include" \
  --extra-ldflags="-L$LAME_PREFIX/lib" \
  --enable-libmp3lame \
  --enable-zlib \
  --disable-network \
  --disable-ffplay \
  --disable-ffprobe \
  --disable-doc \
  --disable-debug

echo "==> make"
make -j"$(sysctl -n hw.ncpu)"

BUILT="$WORK/ffmpeg-$FFMPEG_VERSION/ffmpeg"

# Les listes sont capturees UNE fois dans des variables, et les recherches se font dessus par
# here-string. Ne jamais ecrire `"$BUILT" -hide_banner -decoders | grep -q ...` : `grep -q` sort
# des la premiere correspondance, ce qui envoie un SIGPIPE a ffmpeg encore en train d'ecrire, et
# `set -o pipefail` remonte alors 141 comme statut du pipeline ALORS QUE la correspondance a ete
# trouvee. Le test echouait donc selon la position alphabetique de ce qu'il cherchait : `aac`,
# premier de la liste des decodeurs, faisait couper tot ; `libmp3lame`, en fin de liste des
# encodeurs, laissait ffmpeg terminer. Observe en CI le 2026-08-02.
CONFIG="$("$BUILT" -hide_banner -version)"
ENCODERS="$("$BUILT" -hide_banner -encoders)"
DECODERS="$("$BUILT" -hide_banner -decoders)"

echo "==> Verification : licence"
for flag in --enable-gpl --enable-nonfree; do
  if grep -q -- "$flag" <<<"$CONFIG"; then
    echo "ERREUR: le binaire construit porte $flag." >&2
    exit 1
  fi
done

echo "==> Verification : les encodeurs dont Sift a besoin"
# `encode.rs:143-145`. Un binaire qui compile mais ne sait pas encoder en MP3 casserait la
# fonction centrale de l'app, sur une plateforme que personne ici ne peut tester a la main.
for enc in libmp3lame pcm_s16be pcm_s16le; do
  grep -qE "^ [A-Z.]+ $enc " <<<"$ENCODERS" || {
    echo "ERREUR: encodeur $enc absent du binaire construit." >&2
    exit 1
  }
done

echo "==> Verification : les decodeurs des formats d'entree"
for dec in mp3 flac alac aac vorbis pcm_s16le pcm_s16be; do
  grep -qE "^ [A-Z.]+ $dec " <<<"$DECODERS" || {
    echo "ERREUR: decodeur $dec absent du binaire construit." >&2
    exit 1
  }
done

echo "==> Verification : aucune dylib non systeme"
# LE piege de ce build. Une dependance vers /opt/homebrew ou /usr/local passerait tous les tests
# ci-dessus sur le runner — ou Homebrew existe — et casserait chez l'utilisateur, ou il n'existe
# pas. Seules /usr/lib et /System sont presentes sur toute machine macOS.
BAD="$(otool -L "$BUILT" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/)' || true)"
if [ -n "$BAD" ]; then
  echo "ERREUR: dependances dynamiques non systeme, absentes sur la machine de l'utilisateur :" >&2
  printf '  %s\n' $BAD >&2
  exit 1
fi

echo "==> Verification : un encodage MP3 reel"
# Les listes ci-dessus disent qu'un encodeur est compile, pas qu'il fonctionne. Deux secondes de
# silence encodees en MP3 320, c'est exactement le chemin de production.
"$BUILT" -hide_banner -loglevel error -f lavfi -i "anullsrc=r=44100:cl=stereo" -t 2 \
  -vn -c:a libmp3lame -b:a 320k -ar 44100 -y "$WORK/probe.mp3"
[ -s "$WORK/probe.mp3" ] || { echo "ERREUR: l'encodage MP3 de controle n'a produit aucun octet." >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
cp "$BUILT" "$OUT"
chmod 755 "$OUT"
echo "==> OK : $OUT ($(wc -c < "$OUT") octets)"
