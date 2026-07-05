# M8 — Spike n°3 : flag reload metadata + acceptation XML

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur une copie complète jetable de la vraie bibliothèque Rekordbox
(`master.db` + `masterPlaylists6.xml`), déterminer (1) si un flag de statut
(`TrackInfoUpdated`) peut déclencher un reload metadata dans Rekordbox **sans**
ré-analyse audio (grille préservée), et (2) si Rekordbox accepte sans
réparation/rejet une base modifiée par `pyrekordbox` — avant d'écrire une
seule ligne de Rust d'écriture pour M8.

**Architecture:** Spike **hors repo**, jetable, Python via `pyrekordbox` (déjà
validé lecture+écriture — Éval 5/7/11). Une seule piste canary (choisie par
Antoine, grille corrigée à la main) sert de sujet pour un scénario combiné
qui reproduit l'usage réel de Sift : copier le fichier audio (simulateur de
« Sift a déplacé + ré-encodé »), éditer son tag sur la copie (jamais le
fichier live), puis réparer `FolderPath`/`FileNameL`/`FileNameS` et poser
`TrackInfoUpdated` dans `master.db`, sans toucher `Analysed`/`AnalysisUpdated`.
Ce même round-trip couvre en un script les Tests 1, 3 et 4 de
`docs/superpowers/specs/2026-07-06-m8-masterdb-spike-3-design.md` ; le Test 2
(acceptation XML) se vérifie sur le même swap manuel.

**Tech Stack:** Python 3, `pyrekordbox` (déjà installé), `mutagen` (édition de
tag fichier — à installer si absent), copie complète du dossier Rekordbox de
l'utilisateur.

## Global Constraints

- **Ne jamais toucher les fichiers live** : ni
  `C:\Users\LEETJ\AppData\Roaming\Pioneer\rekordbox\master.db`/`masterPlaylists6.xml`,
  ni le fichier audio réel de la piste canary. Toute écriture se fait sur des
  copies dans `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike3-copy\`.
- **Tout le travail (scripts, copies, JSON, FINDINGS.md) reste hors repo** —
  rien de ce plan n'est ajouté ni committé dans `dj-assistant-m6a`. La mise à
  jour du design v2 (`docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`)
  avec les FINDINGS réels est une action **de suivi**, hors scope de ce plan
  (voir "Suite" du design spike-3).
- **Aucune modification de `src-tauri/` ou `frontend/`** — spike de
  validation, pas d'implémentation Rust.
- **Jamais flipper `Analysed`/`AnalysisUpdated`** dans aucun script de ce
  plan — règle non négociable du design v2.
- **L'ouverture du vrai Rekordbox est réservée à Antoine** — aucune tâche de
  ce plan n'automatise cette étape ; chaque tâche qui en dépend s'arrête net
  avec des instructions précises et attend la confirmation manuelle avant de
  continuer.

---

### Task 1: Copie complète fraîche pour le spike n°3

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike3-copy\master.db`
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike3-copy\masterPlaylists6.xml`

**Interfaces:**
- Produces: dossier `spike3-copy\` utilisé par toutes les tâches suivantes.

- [ ] **Step 1: Créer le dossier et copier les deux fichiers live**

Run (Git Bash) :
```bash
mkdir -p "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike3-copy"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db" \
   "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike3-copy/master.db"
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/masterPlaylists6.xml" \
   "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike3-copy/masterPlaylists6.xml"
```
Expected: aucune erreur, `master.db` ~20 Mo, `masterPlaylists6.xml` ~2,7 Ko.

- [ ] **Step 2: Vérifier l'indépendance de la copie**

Run:
```bash
ls -la "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/spike3-copy/"
```
Expected: les deux fichiers présents, chemin bien sous `spike3-copy\`, pas
sous `AppData\Roaming\Pioneer`.

- [ ] **Step 3: Aucun commit** (fichiers binaires hors repo, jetables).

---

### Task 2: Sélection de la piste canary (grille corrigée à la main)

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\m8s3_canary_check.py`

**Interfaces:**
- Consumes: `spike3-copy/master.db` (Task 1).
- Produces: `m8s3_canary.json` (ID, Title, FolderPath, AnalysisDataPath de la
  piste canary confirmée) — consommé par Task 3 et Task 4.

Il n'existe **aucune colonne dans `djmdContent` marquant "grille corrigée à
la main"** (vérifié dans `pyrekordbox/db6/tables.py` — les données de grille
vivent dans les fichiers ANLZ référencés par `AnalysisDataPath`, pas dans
`master.db`). La sélection ne peut donc pas être automatisée : c'est un
savoir qu'Antoine seul possède.

- [ ] **Step 1: Demander à Antoine l'identifiant de la piste canary**

Poser la question : « Quelle piste de ta bibliothèque a une grille que tu as
corrigée à la main ? Donne son titre/artiste ou son ID Rekordbox si tu le
connais. » Ne pas deviner ni choisir une piste au hasard.

- [ ] **Step 2: Écrire le script de confirmation**

```python
# m8s3_canary_check.py
import json
from pyrekordbox import Rekordbox6Database

DB_PATH = "spike3-copy/master.db"
SEARCH_TERM = "REMPLACER_PAR_LE_TERME_DONNE_PAR_ANTOINE"  # titre, artiste, ou ID exact

db = Rekordbox6Database(path=DB_PATH)
contents = list(db.get_content())

matches = [
    c for c in contents
    if SEARCH_TERM.lower() in (c.Title or "").lower()
    or SEARCH_TERM.lower() in (c.FolderPath or "").lower()
    or c.ID == SEARCH_TERM
]

if len(matches) != 1:
    print(f"AMBIGU ou introuvable : {len(matches)} match(es) pour {SEARCH_TERM!r}")
    for m in matches[:10]:
        print(f"  ID={m.ID} Title={m.Title!r} FolderPath={m.FolderPath!r}")
    db.close()
    raise SystemExit(1)

canary = matches[0]
out = {
    "id": canary.ID,
    "title": canary.Title,
    "folder_path": canary.FolderPath,
    "analysis_data_path": canary.AnalysisDataPath,
}
db.close()

with open("m8s3_canary.json", "w") as f:
    json.dump(out, f, indent=2)
print(json.dumps(out, indent=2))
```

- [ ] **Step 3: Renseigner `SEARCH_TERM` avec la réponse d'Antoine et lancer**

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python m8s3_canary_check.py
```
Expected: exactement 1 match, `m8s3_canary.json` créé avec `id`/`title`/
`folder_path`/`analysis_data_path` non vides. Si `AMBIGU ou introuvable` :
affiner `SEARCH_TERM` (utiliser l'ID exact affiché dans la liste) et relancer
— ne pas continuer tant qu'un seul match n'est pas confirmé.

- [ ] **Step 4: Aucun commit** (script + JSON hors repo).

---

### Task 3: Inventaire des colonnes de suivi (format réel avant d'écrire quoi que ce soit)

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\m8s3_inventory.py`

**Interfaces:**
- Consumes: `spike3-copy/master.db` (Task 1), `m8s3_canary.json` (Task 2).
- Produces: `m8s3_inventory.json` (échantillon de valeurs réelles de
  `TrackInfoUpdated`/`AnalysisUpdated`/`CueUpdated`/`Analysed` sur 20 pistes +
  la piste canary) — détermine le format de valeur à écrire dans Task 4.

- [ ] **Step 1: Écrire le script d'inventaire**

```python
# m8s3_inventory.py
import json
from pyrekordbox import Rekordbox6Database

with open("m8s3_canary.json") as f:
    canary = json.load(f)

db = Rekordbox6Database(path="spike3-copy/master.db")
contents = list(db.get_content())

sample_ids = [c.ID for c in contents[:20]]
if canary["id"] not in sample_ids:
    sample_ids.append(canary["id"])

rows = []
for cid in sample_ids:
    c = db.get_content(ID=cid)
    rows.append({
        "id": c.ID,
        "Analysed": c.Analysed,
        "AnalysisUpdated": c.AnalysisUpdated,
        "TrackInfoUpdated": c.TrackInfoUpdated,
        "CueUpdated": c.CueUpdated,
        "is_canary": cid == canary["id"],
    })
db.close()

with open("m8s3_inventory.json", "w") as f:
    json.dump(rows, f, indent=2, default=str)
print(json.dumps(rows, indent=2, default=str))
```

- [ ] **Step 2: Lancer le script**

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python m8s3_inventory.py
```
Expected: 21 lignes JSON imprimées, `m8s3_inventory.json` créé. Observer le
format réel de `TrackInfoUpdated`/`AnalysisUpdated`/`CueUpdated` (chaîne
`VARCHAR(255)` attendue — probablement un timestamp ISO ou une chaîne
numérique, PAS `0`/`1`/`None` uniquement). Noter ce format : il détermine la
valeur à écrire dans Task 4, Step 2.

- [ ] **Step 3: Aucun commit** (script + JSON hors repo).

---

### Task 4: Round-trip combiné — réparation chemin + flag reload metadata sur la piste canary

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\m8s3_combined_test.py`

**Interfaces:**
- Consumes: `spike3-copy/master.db`+`masterPlaylists6.xml` (Task 1),
  `m8s3_canary.json` (Task 2), format observé dans `m8s3_inventory.json`
  (Task 3).
- Produces: `m8s3_before.json`/`m8s3_after.json` (dump complet de la ligne
  canary avant/après), `m8s3_xml_before.xml`/`m8s3_xml_after.xml`, diff
  imprimé colonne par colonne (couvre Tests 1, 3, 4 de la spec) — la copie
  modifiée `spike3-copy/` sert ensuite au swap manuel (Task 5, Test 2).

- [ ] **Step 1: Installer `mutagen` si absent**

Run:
```bash
python -c "import mutagen" 2>NUL || pip install mutagen
```
Expected: `mutagen` disponible (import silencieux ou installation réussie).

- [ ] **Step 2: Écrire le script combiné**

Remplacer `<VALEUR_FORMAT_OBSERVE>` par une valeur cohérente avec le format
vu dans `m8s3_inventory.json` (Task 3) — ex. si c'est un timestamp ISO,
utiliser l'heure courante dans ce même format ; si c'est un entier en
chaîne, l'incrémenter. Ne jamais laisser une valeur inventée sans base dans
les données réelles observées.

```python
# m8s3_combined_test.py
import json
import os
import shutil
import hashlib
from datetime import datetime, timezone
from mutagen import File as MutagenFile
from pyrekordbox import Rekordbox6Database

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "spike3-copy", "master.db")
XML = os.path.join(BASE, "spike3-copy", "masterPlaylists6.xml")

with open("m8s3_canary.json") as f:
    canary = json.load(f)

CANARY_ID = canary["id"]
ORIGINAL_AUDIO_PATH = canary["folder_path"]
NEW_AUDIO_PATH = os.path.join(BASE, "spike3-copy", "canary_moved" + os.path.splitext(ORIGINAL_AUDIO_PATH)[1])
NEW_FILENAME = os.path.basename(NEW_AUDIO_PATH)

# Valeur déterminée à partir du format réel observé en Task 3 (Step 2 de
# cette tâche) — remplacer avant exécution :
NEW_TRACK_INFO_UPDATED = "<VALEUR_FORMAT_OBSERVE>"

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

# --- Phase 1 : simuler "Sift a déplacé + ré-encodé + re-taggé le fichier" ---
shutil.copy2(ORIGINAL_AUDIO_PATH, NEW_AUDIO_PATH)
audio = MutagenFile(NEW_AUDIO_PATH, easy=True)
if audio is None:
    raise SystemExit(f"mutagen n'a pas reconnu le format de {NEW_AUDIO_PATH} — arrêt, documenter dans FINDINGS")
audio["artist"] = ["M8 SPIKE TEST ARTIST"]
audio.save()
print(f"tag fichier modifié sur la copie : {NEW_AUDIO_PATH}")

# --- Phase 2 : dump avant modification DB ---
db = Rekordbox6Database(path=DB)
before_row = dict(db.get_content(ID=CANARY_ID).__dict__)
before_row = {k: str(v) for k, v in before_row.items() if not k.startswith("_")}
before_xml_sha = sha(XML)
db.close()
with open("m8s3_before.json", "w") as f:
    json.dump(before_row, f, indent=2, default=str)
shutil.copy2(XML, os.path.join(BASE, "m8s3_xml_before.xml"))

# --- Phase 3 : réparation chemin + flag reload metadata ---
db2 = Rekordbox6Database(path=DB)
content = db2.get_content(ID=CANARY_ID)
content.FolderPath = NEW_AUDIO_PATH
content.FileNameL = NEW_FILENAME
content.FileNameS = NEW_FILENAME[:8] + os.path.splitext(NEW_FILENAME)[1] if len(NEW_FILENAME) > 12 else NEW_FILENAME
content.TrackInfoUpdated = NEW_TRACK_INFO_UPDATED
db2.commit()
db2.close()
print("master.db modifié + committé (FolderPath/FileNameL/FileNameS/TrackInfoUpdated)")

# --- Phase 4 : dump après, connexion FRAÎCHE ---
db3 = Rekordbox6Database(path=DB)
after_row = dict(db3.get_content(ID=CANARY_ID).__dict__)
after_row = {k: str(v) for k, v in after_row.items() if not k.startswith("_")}
after_xml_sha = sha(XML)
db3.close()
with open("m8s3_after.json", "w") as f:
    json.dump(after_row, f, indent=2, default=str)
shutil.copy2(XML, os.path.join(BASE, "m8s3_xml_after.xml"))

# --- Phase 5 : diff colonne par colonne ---
print("--- colonnes changées ---")
for k in before_row:
    if before_row.get(k) != after_row.get(k):
        print(f"{k}: {before_row[k]!r} -> {after_row[k]!r}")
print(f"xml sha256 before={before_xml_sha} after={after_xml_sha} changed={before_xml_sha != after_xml_sha}")
print(f"Analysed unchanged: {before_row.get('Analysed') == after_row.get('Analysed')}")
print(f"AnalysisUpdated unchanged: {before_row.get('AnalysisUpdated') == after_row.get('AnalysisUpdated')}")
```

- [ ] **Step 3: Lancer le script**

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python m8s3_combined_test.py
```
Expected: liste des colonnes changées incluant `FolderPath`, `FileNameL`,
`FileNameS`, `TrackInfoUpdated`, `rb_local_usn`, `updated_at` — **PAS**
`Analysed` ni `AnalysisUpdated` (les deux lignes `unchanged` doivent afficher
`True`). Si `Analysed`/`AnalysisUpdated` apparaissent dans la liste des
colonnes changées ou si `unchanged: False` : **STOP**, ne pas continuer vers
Task 5, documenter l'anomalie — ça signifierait que `pyrekordbox` touche ces
colonnes même sans qu'on les définisse explicitement, ce qui invaliderait
l'hypothèse du flag séparé.

- [ ] **Step 4: Aucun commit** (script + JSON + fichier audio copié hors repo).

---

### Task 5: Vérification manuelle dans le vrai Rekordbox + FINDINGS

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\FINDINGS-m8-spike-3.md`

**Interfaces:**
- Consumes: `m8s3_before.json`/`m8s3_after.json`/diff imprimé (Task 4),
  `m8s3_inventory.json` (Task 3), `spike3-copy/master.db`+
  `masterPlaylists6.xml` modifiés (Task 4).
- Produces: verdicts PASS/FAIL des Tests 1/2/3/4 de la spec, qui débloquent
  (ou non) la mise à jour du design v2 et le passage au plan Rust.

Cette tâche a une partie scriptée (rédaction du squelette FINDINGS avec les
résultats automatisables déjà connus) et une partie **strictement manuelle,
réservée à Antoine** (ouverture du vrai Rekordbox) — aucun agent ne peut
exécuter cette seconde partie.

- [ ] **Step 1: Rédiger le squelette FINDINGS avec les résultats automatisables**

```markdown
# FINDINGS — M8 spike 3 : flag reload metadata + acceptation XML (2026-07-06)

## 1. Piste canary
ID, Title, FolderPath original : [coller depuis m8s3_canary.json]

## 2. Format réel des colonnes de suivi (Task 3)
[coller le tableau de valeurs de m8s3_inventory.json — format observé pour
TrackInfoUpdated/AnalysisUpdated/CueUpdated, valeur choisie pour le test]

## 3. Diff colonne par colonne (Task 4)
[coller la sortie "--- colonnes changées ---" de m8s3_combined_test.py]
Analysed unchanged: [true/false]
AnalysisUpdated unchanged: [true/false]

## 4. Acceptation masterPlaylists6.xml (Task 4)
xml sha256 changed: [true/false]
[Si changé : comparer m8s3_xml_before.xml / m8s3_xml_after.xml, noter ce qui
a changé (timestamps, structure) — même méthode que FINDINGS-m8-spike-2.md]

## 5. Vérification manuelle dans le vrai Rekordbox (Antoine)
[voir Step 2 ci-dessous — à remplir après exécution]
```

- [ ] **Step 2: Instructions manuelles pour Antoine (à exécuter, pas à déléguer)**

1. **Fermer Rekordbox** complètement (vérifier dans le Gestionnaire des
   tâches qu'aucun `rekordbox.exe` ne tourne).
2. **Backup horodaté** des fichiers live :
   ```
   mkdir C:\Users\LEETJ\Desktop\rb-backup-2026-07-06-HHMM
   copy "C:\Users\LEETJ\AppData\Roaming\Pioneer\rekordbox\master.db" C:\Users\LEETJ\Desktop\rb-backup-2026-07-06-HHMM\
   copy "C:\Users\LEETJ\AppData\Roaming\Pioneer\rekordbox\masterPlaylists6.xml" C:\Users\LEETJ\Desktop\rb-backup-2026-07-06-HHMM\
   ```
3. **Remplacer** les fichiers live par la copie modifiée :
   ```
   copy "C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike3-copy\master.db" "C:\Users\LEETJ\AppData\Roaming\Pioneer\rekordbox\master.db"
   copy "C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\spike3-copy\masterPlaylists6.xml" "C:\Users\LEETJ\AppData\Roaming\Pioneer\rekordbox\masterPlaylists6.xml"
   ```
4. **Ouvrir Rekordbox** et observer, dans cet ordre :
   - Aucun message d'erreur / réparation forcée / reconstruction de
     bibliothèque au lancement (Test 2 — acceptation XML).
   - Chercher la piste canary : son chemin de fichier pointe-t-il vers
     `canary_moved.<ext>` (Test 3 — réparation acceptée) ?
   - Sa **grille est-elle identique** à avant (comparer visuellement à ta
     mémoire ou à une capture antérieure si tu en as une) ? (Test 4 —
     canary de grille, le plus important)
   - Le tag Artist affiche-t-il "M8 SPIKE TEST ARTIST" **sans** qu'un
     scan/ré-analyse ne se déclenche (pas d'icône de progression sur la
     piste, pas de changement d'icône "non analysé") ? (Test 1 — flag
     reload)
   - Si le tag n'apparaît PAS automatiquement : essayer manuellement
     clic-droit → **Reload Tags** sur cette seule piste, et noter si ÇA
     fonctionne (confirme au moins le mécanisme manuel en fallback).
5. **Fermer Rekordbox.**
6. **Restaurer les originaux** depuis le backup horodaté :
   ```
   copy C:\Users\LEETJ\Desktop\rb-backup-2026-07-06-HHMM\master.db "C:\Users\LEETJ\AppData\Roaming\Pioneer\rekordbox\master.db"
   copy C:\Users\LEETJ\Desktop\rb-backup-2026-07-06-HHMM\masterPlaylists6.xml "C:\Users\LEETJ\AppData\Roaming\Pioneer\rekordbox\masterPlaylists6.xml"
   ```
7. **Rouvrir Rekordbox une fois** pour confirmer le retour à la normale
   (piste canary de nouveau à son emplacement d'origine, grille intacte).

Noter chaque verdict (PASS/FAIL par test) dans la section 5 du FINDINGS.

- [ ] **Step 3: Compléter la section 5 du FINDINGS avec les verdicts observés**

Remplir `[à remplir après exécution]` avec les observations réelles d'Antoine
— ne jamais inventer un verdict. Si un test échoue, documenter précisément ce
qui a été vu (message d'erreur exact, comportement de la grille, etc.).

- [ ] **Step 4: Aucun commit** (FINDINGS hors repo — la mise à jour du design
  v2 dans le repo avec ces résultats est une action de suivi séparée, après
  cette tâche, une fois les verdicts réels connus).

---

## Séquencement

Task 1 → 2 → 3 → 4 → 5 dans l'ordre strict — chaque tâche consomme les
artefacts de la précédente sur la même copie. Si Task 4 (Step 3) montre que
`Analysed`/`AnalysisUpdated` ont changé de manière inattendue, **ne pas
continuer vers Task 5** : documenter l'anomalie, revenir à Task 1 pour
repartir d'une copie saine si un nouveau run est nécessaire.

**Après ce plan** : une fois `FINDINGS-m8-spike-3.md` complet avec les
verdicts manuels d'Antoine, mettre à jour
`docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`
avec les résultats réels (remplacer les hypothèses par les valeurs
vérifiées), puis relancer `superpowers:writing-plans` pour le plan
d'implémentation Rust — **pas avant**.
