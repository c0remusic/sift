# M8 — Spike n°4 : isoler la cause du relink silencieux Rekordbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Déterminer, par 2 tests contrôlés isolant chaque variable, si le
relink silencieux observé au spike n°3 (Rekordbox ignore notre `FolderPath`
et résout vers un fichier tiers) est causé par (H1) un contenu de fichier
modifié (hash différent de l'original) ou par (H2) un dossier que Rekordbox
ne reconnaît pas comme surveillé — avant de pouvoir continuer le design M8
Tier 1.

**Architecture:** Spike **hors repo**, jetable, Python via `pyrekordbox`.
Réutilise la piste canary déjà validée sûre au spike n°3 (grille intacte,
ID `165700329`). Test A change le contenu (aucune modif) mais garde le
dossier non reconnu ; Test B garde le contenu modifié mais utilise un dossier
déjà connu de Rekordbox (`D:\MUSIQUE 2025\MP3\`). Chaque test isole une
seule variable par rapport au round-trip du spike n°3.

**Tech Stack:** Python 3, `pyrekordbox`, `mutagen` (déjà installés lors du
spike n°3).

## Global Constraints

- **Ne jamais toucher les fichiers live Rekordbox** ni le fichier audio
  canary original — seules des copies sont manipulées.
- **Test B écrit un fichier temporaire dans le vrai dossier musique**
  (`D:\MUSIQUE 2025\MP3\canary_retag_test.mp3`) — nom de fichier neuf,
  n'écrase rien d'existant, mais **doit être supprimé** à la fin de Task 4
  (nettoyage obligatoire, pas optionnel).
- **Tout le reste du travail (scripts, copies, JSON, FINDINGS.md) reste hors
  repo**, sous `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\`.
- **L'ouverture du vrai Rekordbox est réservée à Antoine** — chaque tâche
  qui en dépend s'arrête net et attend sa confirmation manuelle.
- **Backup horodaté avant chaque swap**, restauration immédiate après chaque
  observation — ne jamais laisser les fichiers live swappés plus longtemps
  que nécessaire.

---

### Task 1: Copie fraîche + préparation Test A (contenu inchangé, dossier non reconnu)

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike4-copy\master.db`
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike4-copy\masterPlaylists6.xml`
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike4-copy\canary_unmodified.mp3`
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\m8s4_testA.py`

**Interfaces:**
- Consumes: `m8s3_canary.json` (déjà produit, clés `id`/`folder_path`).
- Produces: `spike4-copy/` prêt pour swap (Task 2), `m8s4_testA_before.json`/
  `m8s4_testA_after.json` (diff de la ligne canary).

- [ ] **Step 1: Copier les fichiers live frais + le fichier canary SANS modification**

Run (Git Bash) :
```bash
mkdir -p "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db" \
   "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy/master.db"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml" \
   "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy/masterPlaylists6.xml"
```
Expected : mêmes tailles que les live (~20 Mo / ~2,7 Ko).

- [ ] **Step 2: Écrire et lancer le script de préparation Test A**

```python
# m8s4_testA.py
import json, os, shutil, hashlib
from pyrekordbox import Rekordbox6Database

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "spike4-copy", "master.db")

with open(os.path.join(BASE, "m8s3_canary.json")) as f:
    canary = json.load(f)

CANARY_ID = canary["id"]
ORIGINAL_AUDIO_PATH = canary["folder_path"]  # D:/MUSIQUE 2025/MP3/Weekender - Route 1 (Version).mp3
NEW_AUDIO_PATH = os.path.join(BASE, "spike4-copy", "canary_unmodified.mp3")

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

# --- Copie SANS AUCUNE modification (contrôle : contenu identique) ---
shutil.copy2(ORIGINAL_AUDIO_PATH, NEW_AUDIO_PATH)
print(f"copie non modifiée : {NEW_AUDIO_PATH}")
print(f"sha256 original : {sha(ORIGINAL_AUDIO_PATH)}")
print(f"sha256 copie    : {sha(NEW_AUDIO_PATH)}")
assert sha(ORIGINAL_AUDIO_PATH) == sha(NEW_AUDIO_PATH), "la copie doit être octet-identique — sinon Test A n'isole rien"

# --- Dump avant ---
db = Rekordbox6Database(path=DB)
before_row = dict(db.get_content(ID=CANARY_ID).__dict__)
before_row = {k: str(v) for k, v in before_row.items() if not k.startswith("_")}
db.close()
with open(os.path.join(BASE, "m8s4_testA_before.json"), "w") as f:
    json.dump(before_row, f, indent=2, default=str)

# --- Réparation de chemin SEULE (pas de TrackInfoUpdated cette fois, variable non pertinente ici) ---
db2 = Rekordbox6Database(path=DB)
content = db2.get_content(ID=CANARY_ID)
content.FolderPath = NEW_AUDIO_PATH
content.FileNameL = "canary_unmodified.mp3"
content.FileNameS = "canary_u.mp3"
db2.commit()
db2.close()
print("master.db modifié + committé (FolderPath/FileNameL/FileNameS uniquement)")

# --- Dump après, connexion fraîche ---
db3 = Rekordbox6Database(path=DB)
after_row = dict(db3.get_content(ID=CANARY_ID).__dict__)
after_row = {k: str(v) for k, v in after_row.items() if not k.startswith("_")}
db3.close()
with open(os.path.join(BASE, "m8s4_testA_after.json"), "w") as f:
    json.dump(after_row, f, indent=2, default=str)

print("--- colonnes changées ---")
for k in before_row:
    if before_row.get(k) != after_row.get(k):
        print(f"{k}: {before_row[k]!r} -> {after_row[k]!r}")
```

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python m8s4_testA.py
```
Expected : l'assertion de hash passe (copie octet-identique confirmée),
`FolderPath`/`FileNameL`/`FileNameS` apparaissent comme changés, `master.db`
modifié+committé sans erreur.

- [ ] **Step 3: Aucun commit** (hors repo).

---

### Task 2: Swap + ouverture réelle pour Test A (Antoine)

**Files:** aucun nouveau fichier — étape manuelle.

**Interfaces:**
- Consumes: `spike4-copy/master.db` modifié (Task 1).
- Produces: verdict Test A (H2 confirmée/réfutée) noté pour Task 5.

- [ ] **Step 1: Backup + swap**

Demander à Antoine de confirmer Rekordbox fermé, puis (agent ou Antoine,
selon qui a la main à ce moment — ce sont de simples copies de fichiers) :
```bash
mkdir -p "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testA"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db" "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testA/"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml" "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testA/"
cp "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy/master.db" "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db"
cp "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy/masterPlaylists6.xml" "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml"
```

- [ ] **Step 2: Antoine ouvre Rekordbox, cherche "Route 1 (Version)", note l'Emplacement affiché**

Question à poser : l'Emplacement affiché est-il
`spike4-copy\canary_unmodified.mp3` (notre chemin — H2 réfutée, le contenu
identique suffit) ou un autre chemin (H2 confirmée — même un contenu
identique dans un dossier inconnu déclenche un relink) ?

- [ ] **Step 3: Antoine ferme Rekordbox, restauration immédiate**

```bash
cp "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testA/master.db" "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db"
cp "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testA/masterPlaylists6.xml" "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml"
```
Antoine rouvre Rekordbox une fois pour confirmer le retour à la normale.

- [ ] **Step 4: Aucun commit** (hors repo).

---

### Task 3: Copie fraîche + préparation Test B (contenu modifié, dossier reconnu)

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike4-copy-b\master.db`
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike4-copy-b\masterPlaylists6.xml`
- Create: `D:\MUSIQUE 2025\MP3\canary_retag_test.mp3` (temporaire — **à
  supprimer en Task 4**)
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\m8s4_testB.py`

**Interfaces:**
- Consumes: `m8s3_canary.json` (canary), état frais de `master.db` (pas
  celui déjà modifié par Task 1 — repartir d'une copie propre).
- Produces: `spike4-copy-b/` prêt pour swap (Task 4), `m8s4_testB_before.json`/
  `m8s4_testB_after.json`.

- [ ] **Step 1: Copie fraîche des fichiers live (nouvelle copie, indépendante de Task 1)**

Run:
```bash
mkdir -p "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy-b"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db" \
   "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy-b/master.db"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml" \
   "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy-b/masterPlaylists6.xml"
```
Expected : tailles cohérentes avec le live actuel (Task 2 a déjà restauré
l'original avant cette étape — vérifier qu'aucun swap n'est en cours).

- [ ] **Step 2: Écrire et lancer le script de préparation Test B**

```python
# m8s4_testB.py
import json, os, shutil, hashlib
from mutagen import File as MutagenFile
from pyrekordbox import Rekordbox6Database

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "spike4-copy-b", "master.db")

with open(os.path.join(BASE, "m8s3_canary.json")) as f:
    canary = json.load(f)

CANARY_ID = canary["id"]
ORIGINAL_AUDIO_PATH = canary["folder_path"]  # D:/MUSIQUE 2025/MP3/Weekender - Route 1 (Version).mp3
NEW_AUDIO_PATH = r"D:\MUSIQUE 2025\MP3\canary_retag_test.mp3"  # DOSSIER DEJA CONNU de Rekordbox

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

# --- Copie DANS un dossier déjà connu, AVEC modification de tag ---
shutil.copy2(ORIGINAL_AUDIO_PATH, NEW_AUDIO_PATH)
audio = MutagenFile(NEW_AUDIO_PATH, easy=True)
if audio is None:
    raise SystemExit(f"mutagen n'a pas reconnu le format de {NEW_AUDIO_PATH} — arrêt")
audio["artist"] = ["M8 SPIKE4 TEST ARTIST"]
audio.save()
print(f"tag modifié sur la copie dans dossier connu : {NEW_AUDIO_PATH}")
print(f"sha256 original : {sha(ORIGINAL_AUDIO_PATH)}")
print(f"sha256 copie modifiée : {sha(NEW_AUDIO_PATH)}")
assert sha(ORIGINAL_AUDIO_PATH) != sha(NEW_AUDIO_PATH), "le tag doit avoir changé le hash — sinon Test B n'isole rien"

# --- Dump avant ---
db = Rekordbox6Database(path=DB)
before_row = dict(db.get_content(ID=CANARY_ID).__dict__)
before_row = {k: str(v) for k, v in before_row.items() if not k.startswith("_")}
db.close()
with open(os.path.join(BASE, "m8s4_testB_before.json"), "w") as f:
    json.dump(before_row, f, indent=2, default=str)

# --- Réparation de chemin vers le dossier connu ---
db2 = Rekordbox6Database(path=DB)
content = db2.get_content(ID=CANARY_ID)
content.FolderPath = NEW_AUDIO_PATH.replace("\\", "/")
content.FileNameL = "canary_retag_test.mp3"
content.FileNameS = "canary_r.mp3"
db2.commit()
db2.close()
print("master.db modifié + committé (FolderPath vers dossier connu + tag modifié)")

# --- Dump après, connexion fraîche ---
db3 = Rekordbox6Database(path=DB)
after_row = dict(db3.get_content(ID=CANARY_ID).__dict__)
after_row = {k: str(v) for k, v in after_row.items() if not k.startswith("_")}
db3.close()
with open(os.path.join(BASE, "m8s4_testB_after.json"), "w") as f:
    json.dump(after_row, f, indent=2, default=str)

print("--- colonnes changées ---")
for k in before_row:
    if before_row.get(k) != after_row.get(k):
        print(f"{k}: {before_row[k]!r} -> {after_row[k]!r}")
```

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python m8s4_testB.py
```
Expected : l'assertion de hash différent passe (tag modifié confirmé),
`FolderPath`/`FileNameL`/`FileNameS` changés vers le chemin `D:\MUSIQUE
2025\MP3\canary_retag_test.mp3`.

- [ ] **Step 3: Aucun commit** (hors repo — sauf le fichier temporaire dans
  `D:\MUSIQUE 2025\MP3\`, qui n'est pas un commit git mais doit être
  supprimé en Task 4, pas laissé en place).

---

### Task 4: Swap + ouverture réelle pour Test B (Antoine) + nettoyage obligatoire

**Files:** aucun nouveau fichier de code — étape manuelle + nettoyage.

**Interfaces:**
- Consumes: `spike4-copy-b/master.db` modifié (Task 3).
- Produces: verdict Test B (H1 confirmée/réfutée) noté pour Task 5.

- [ ] **Step 1: Backup + swap**

```bash
mkdir -p "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testB"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db" "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testB/"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml" "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testB/"
cp "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy-b/master.db" "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db"
cp "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike4-copy-b/masterPlaylists6.xml" "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml"
```

- [ ] **Step 2: Antoine ouvre Rekordbox, cherche "Route 1 (Version)", note l'Emplacement ET l'Artiste affichés**

Question à poser : l'Emplacement pointe-t-il vers
`D:\MUSIQUE 2025\MP3\canary_retag_test.mp3` (notre chemin — H1 réfutée, le
dossier connu suffit malgré le tag modifié) ? L'Artiste affiche-t-il "M8
SPIKE4 TEST ARTIST" (bonus : confirmerait aussi que le flag/reload
fonctionne quand le chemin est accepté) ou reste "Weekender"/autre (H1
confirmée — le contenu modifié déclenche le relink même en dossier connu) ?

- [ ] **Step 3: Antoine ferme Rekordbox, restauration immédiate**

```bash
cp "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testB/master.db" "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db"
cp "/c/Users/LEETJ/Desktop/rb-backup-2026-07-06-testB/masterPlaylists6.xml" "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml"
```

- [ ] **Step 4: Nettoyage OBLIGATOIRE — supprimer le fichier temporaire de la vraie bibliothèque**

```bash
rm "/d/MUSIQUE 2025/MP3/canary_retag_test.mp3"
ls "/d/MUSIQUE 2025/MP3/" | grep -i canary_retag || echo "confirmé supprimé"
```
Expected : `confirmé supprimé` imprimé — **ne pas passer à Task 5 tant que
ce fichier n'est pas confirmé supprimé**, il ne doit jamais rester dans la
vraie bibliothèque musicale d'Antoine.

- [ ] **Step 5: Antoine rouvre Rekordbox une fois pour confirmer le retour à la normale.**

- [ ] **Step 6: Aucun commit** (hors repo).

---

### Task 5: FINDINGS + mise à jour du design v2

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\FINDINGS-m8-spike-4.md`
- Modify: `docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`
  (section "Risque ouvert n°3" — remplacer par le verdict réel)

**Interfaces:**
- Consumes: verdicts Test A (Task 2) et Test B (Task 4).
- Produces: décision actée sur si Tier 1 peut avancer vers un plan Rust, ou
  doit être reconçu (si H1 confirmée).

- [ ] **Step 1: Rédiger `FINDINGS-m8-spike-4.md`**

```markdown
# FINDINGS — M8 spike 4 : isoler la cause du relink Rekordbox (2026-07-06)

## Test A — contenu inchangé, dossier non reconnu
Emplacement observé : [à remplir]
Verdict H2 : [confirmée / réfutée]

## Test B — contenu modifié, dossier reconnu
Emplacement observé : [à remplir]
Artiste observé : [à remplir]
Verdict H1 : [confirmée / réfutée]

## Conclusion
[à remplir selon la combinaison réelle — ne pas forcer un verdict binaire
si les deux résultats sont ambigus, documenter précisément ce qui a été vu]

## Implication pour M8 Tier 1
[à remplir — voir docs/superpowers/specs/2026-07-06-m8-masterdb-spike-4-relink-mystery-design.md,
section Intention, pour les 2 branches de décision déjà écrites]
```

- [ ] **Step 2: Remplir les verdicts réels** (jamais inventer — copier les
  observations exactes d'Antoine notées en Task 2/Task 4).

- [ ] **Step 3: Mettre à jour la section "Risque ouvert n°3" du design v2**
  avec le verdict — remplacer l'état "non départagé" par la conclusion
  réelle et son implication (Tier 1 viable tel quel, ou à reconcevoir).

- [ ] **Step 4: Commit — SEUL commit git de ce plan**

Composer le message de commit à partir du verdict réel obtenu en Step 2/3
(ne pas copier un texte entre crochets tel quel) — par exemple, si H1 est
confirmée : `"docs(m8): spike n°4 verdict — H1 confirmée (contenu modifié
déclenche le relink), Tier 1 à reconcevoir"`. Puis :

```bash
git add docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md
git commit -m "<message composé à partir du verdict réel>"
```

---

## Séquencement

Task 1 → 2 → 3 → 4 → 5 dans l'ordre strict. Task 3 doit repartir d'une
copie **fraîche** du live (pas de la copie déjà modifiée par Task 1) — les
deux tests sont indépendants, pas cumulatifs. **Ne jamais passer à Task 5
avant que Task 4 Step 4 (suppression du fichier temporaire de
`D:\MUSIQUE 2025\MP3\`) soit confirmée** — c'est un garde-fou de sûreté, pas
une formalité.
