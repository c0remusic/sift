# M8 — Spike d'écriture `master.db` (validation avant tout code de prod)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prouver, sur une copie jetable de la vraie bibliothèque Rekordbox de
l'utilisateur, qu'un round-trip déchiffrer→modifier→rechiffrer→relire de
`master.db` est sûr (round-trip fidèle, HMAC valide, pas de corruption),
avant d'écrire une seule ligne de code de production pour M8.

**Architecture:** Spike **hors repo**, jetable, en Python via `pyrekordbox`
(déjà validé en lecture — Évaluation 5, `docs/ressources-externes.md`).
`pyrekordbox` gère nativement le chiffrement SQLCipher (dérivation de clé,
HMAC par page) en lecture ET en écriture via `db.update()`/`db.commit()` —
on réutilise cette implémentation éprouvée plutôt que de réimplémenter
AES-256-CBC + HMAC-SHA512 à la main pour un spike de validation. Si le
spike valide la sûreté de l'opération, le portage en Rust pur (symétrique
au lecteur SQLCipher déjà écrit pour M7) est une tâche **distincte**,
hors scope de ce plan.

**Tech Stack:** Python 3, `pyrekordbox` (déjà installé lors du spike
Évaluation 5 — `pip install pyrekordbox` si environnement différent),
copie locale de `master.db` de l'utilisateur.

## Global Constraints

- **Ne jamais toucher le fichier live** : `/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db`
  n'est JAMAIS ouvert directement par aucun script de ce plan. Seule la
  copie `master.db.copy` (Task 1) est manipulée.
- **Tout le travail reste hors repo** : dossier
  `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\` (déjà créé, vide) —
  aucun fichier de ce spike ne doit être ajouté au repo Sift ni committé
  dans `dj-assistant-m6a`.
- **Aucune modification de `src-tauri/` ou `frontend/`** dans ce plan — le
  spike est une validation, pas une implémentation. Un futur plan séparé
  couvrira le portage en prod si ce spike réussit.
- Le seul commit **dans le repo Sift** prévu par ce plan est la
  documentation du résultat dans `docs/ressources-externes.md` (Task 6).

---

### Task 1: Copier `master.db` en lecture seule vers le dossier probe

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\master.db.copy`

**Interfaces:**
- Produces: chemin `master.db.copy` utilisé par toutes les tâches suivantes.

- [ ] **Step 1: Copier le fichier live vers la copie de travail**

Run (Git Bash) :
```bash
cp "/c/Users/LEETJ/AppData/Roaming/Pioneer/rekordbox/master.db" \
   "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/master.db.copy"
```
Expected: aucune erreur, fichier de ~20 Mo présent.

- [ ] **Step 2: Vérifier que la copie est indépendante du fichier live**

Run:
```bash
ls -la "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe/master.db.copy"
```
Expected: taille identique (~20.1M) affichée, chemin bien sous `Desktop\sift-masterdb-write-probe`, pas sous `AppData\Roaming\Pioneer`.

- [ ] **Step 3: Aucun commit** (fichier binaire hors repo, jetable — ne pas versionner).

---

### Task 2: Script de lecture baseline (référence avant modification)

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\baseline.py`

**Interfaces:**
- Consumes: `master.db.copy` (Task 1).
- Produces: fichier `baseline.json` (compte de tracks/playlists + un
  `content_id`/`folder_path` cible et une paire `(playlist_id, track_id)`
  dupliquée si trouvée) — consommé par Task 3 et Task 4.

- [ ] **Step 1: Écrire le script de baseline**

```python
# baseline.py
import json
from collections import Counter
from pyrekordbox import Rekordbox6Database

db = Rekordbox6Database(path="master.db.copy")

contents = list(db.get_content())
playlists = list(db.get_playlist())

# Cible pour le test de réparation de chemin (Task 3) : premier track
# dont le FolderPath est non vide.
target_content = next(c for c in contents if c.FolderPath)

# Cherche une playlist non-dossier avec au moins 1 morceau, pour le test
# de dédup (Task 4). On simule un doublon nous-mêmes si aucun n'existe
# naturellement (voir Task 4).
target_playlist = next(p for p in playlists if not p.is_folder and len(p.Songs) > 0)
target_song = target_playlist.Songs[0]

baseline = {
    "track_count": len(contents),
    "playlist_count": len(playlists),
    "target_content_id": target_content.ID,
    "target_content_original_folder_path": target_content.FolderPath,
    "target_playlist_id": target_playlist.ID,
    "target_playlist_song_count": len(target_playlist.Songs),
    "target_track_id_in_playlist": target_song.ContentID,
}

with open("baseline.json", "w") as f:
    json.dump(baseline, f, indent=2)

print(json.dumps(baseline, indent=2))
db.close()
```

- [ ] **Step 2: Lancer le script et capturer la baseline**

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python baseline.py
```
Expected: JSON imprimé avec `track_count` proche de 2828 (cohérent avec
Évaluation 5), `playlist_count` proche de 24, et les 4 champs `target_*`
remplis (pas de `None`/exception). `baseline.json` créé dans le dossier.

- [ ] **Step 3: Aucun commit** (script hors repo).

---

### Task 3: Round-trip — réparation de chemin sur un track ciblé

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\test_path_repair.py`

**Interfaces:**
- Consumes: `baseline.json` (Task 2) — `target_content_id`,
  `target_content_original_folder_path`, `track_count`.
- Produces: verdict imprimé `PASS`/`FAIL` pour le scénario 2 de la spec
  Phase 2 (round-trip fidèle sur modification de `FolderPath`).

- [ ] **Step 1: Écrire le test de réparation de chemin**

```python
# test_path_repair.py
import json
from pyrekordbox import Rekordbox6Database

with open("baseline.json") as f:
    baseline = json.load(f)

NEW_PATH = baseline["target_content_original_folder_path"] + "_REPAIRED_TEST"

# --- Phase d'écriture ---
db = Rekordbox6Database(path="master.db.copy")
content = db.get_content(ID=baseline["target_content_id"])
content.FolderPath = NEW_PATH
db.commit()
db.close()

# --- Phase de relecture, connexion FRAÎCHE (pas le même objet db) ---
db2 = Rekordbox6Database(path="master.db.copy")
contents2 = list(db2.get_content())
reread = db2.get_content(ID=baseline["target_content_id"])

checks = {
    "folder_path_updated": reread.FolderPath == NEW_PATH,
    "track_count_unchanged": len(contents2) == baseline["track_count"],
    "other_field_sample_present": reread.Title is not None,
}
db2.close()

print(json.dumps(checks, indent=2))
if all(checks.values()):
    print("PASS")
else:
    print("FAIL")
```

- [ ] **Step 2: Lancer le test**

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python test_path_repair.py
```
Expected: les 3 clés du JSON à `true`, ligne finale `PASS`. Si `FAIL` ou
exception (HMAC invalide, page corrompue, `pyrekordbox` lève une erreur de
déchiffrement) : **STOP**, documenter l'erreur exacte dans Task 6, ne pas
continuer vers Task 4/5.

- [ ] **Step 3: Aucun commit** (script hors repo).

---

### Task 4: Round-trip — dédup d'une entrée de playlist dupliquée

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\test_playlist_dedup.py`

**Interfaces:**
- Consumes: `baseline.json` (Task 2) — `target_playlist_id`,
  `target_track_id_in_playlist`, `target_playlist_song_count`.
- Produces: verdict `PASS`/`FAIL` pour le scénario 5 de la spec Phase 2
  (dédup de playlist sans référence orpheline).

- [ ] **Step 1: Écrire le test de dédup**

```python
# test_playlist_dedup.py
import json
from pyrekordbox import Rekordbox6Database

with open("baseline.json") as f:
    baseline = json.load(f)

playlist_id = baseline["target_playlist_id"]
track_id = baseline["target_track_id_in_playlist"]

# --- Phase de préparation : injecter un doublon artificiel ---
db = Rekordbox6Database(path="master.db.copy")
db.add_to_playlist(playlist_id=playlist_id, content_id=track_id)
db.commit()
db.close()

db_check = Rekordbox6Database(path="master.db.copy")
playlist_after_dup = db_check.get_playlist(ID=playlist_id)
dup_count_before = sum(
    1 for s in playlist_after_dup.Songs if s.ContentID == track_id
)
db_check.close()
assert dup_count_before >= 2, f"doublon non injecté, count={dup_count_before}"

# --- Phase de dédup : supprimer les occurrences en trop, en garder 1 ---
db2 = Rekordbox6Database(path="master.db.copy")
playlist = db2.get_playlist(ID=playlist_id)
songs_for_track = [s for s in playlist.Songs if s.ContentID == track_id]
for extra in songs_for_track[1:]:
    db2.remove_from_playlist(playlist_id=playlist_id, song=extra)
db2.commit()
db2.close()

# --- Phase de vérification, connexion FRAÎCHE ---
db3 = Rekordbox6Database(path="master.db.copy")
playlist_final = db3.get_playlist(ID=playlist_id)
dup_count_after = sum(
    1 for s in playlist_final.Songs if s.ContentID == track_id
)
content_still_exists = db3.get_content(ID=track_id) is not None
db3.close()

checks = {
    "duplicate_injected_then_removed": dup_count_before >= 2 and dup_count_after == 1,
    "track_still_exists_no_orphan": content_still_exists,
}
print(json.dumps(checks, indent=2))
print("PASS" if all(checks.values()) else "FAIL")
```

- [ ] **Step 2: Lancer le test**

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python test_playlist_dedup.py
```
Expected: `PASS`. Si `pyrekordbox` n'expose pas `add_to_playlist`/
`remove_from_playlist` sous ces noms exacts (API non vérifiée en écriture
à ce jour — seule la lecture a été testée en Évaluation 5), **STOP** :
inspecter `dir(db)` / la doc `pyrekordbox` installée pour trouver les
noms réels de méthode avant de continuer, documenter l'écart dans Task 6.

- [ ] **Step 3: Aucun commit** (script hors repo).

---

### Task 5: Test du verrou fichier (Rekordbox ouvert)

**Files:**
- Create: `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\test_file_lock.py`

**Interfaces:**
- Consumes: `master.db.copy` (Task 1).
- Produces: verdict `PASS`/`FAIL` pour le scénario 4 de la spec Phase 2
  (détection du verrou plutôt qu'écriture silencieuse).

- [ ] **Step 1: Écrire le test de verrou**

```python
# test_file_lock.py
import json
import sqlite3

# Simule "Rekordbox a le fichier ouvert" : une connexion SQLite séparée,
# non fermée, qui tient une transaction d'écriture active pendant qu'on
# tente d'écrire par-dessus avec pyrekordbox.
blocker = sqlite3.connect("master.db.copy")
blocker.execute("BEGIN EXCLUSIVE")

result = {"exception_raised": False, "exception_type": None}
try:
    from pyrekordbox import Rekordbox6Database
    db = Rekordbox6Database(path="master.db.copy")
    content = next(iter(db.get_content()))
    content.FolderPath = content.FolderPath + "_SHOULD_NOT_APPLY"
    db.commit()
    db.close()
except Exception as e:
    result["exception_raised"] = True
    result["exception_type"] = type(e).__name__

blocker.rollback()
blocker.close()

print(json.dumps(result, indent=2))
print("PASS" if result["exception_raised"] else "FAIL — écriture silencieuse malgré le verrou")
```

- [ ] **Step 2: Lancer le test**

Run:
```bash
cd "/c/Users/LEETJ/Desktop/sift-masterdb-write-probe" && python test_file_lock.py
```
Expected: `exception_raised: true`, ligne finale `PASS`. Si `FAIL` :
c'est un résultat de spike important en soi (pas un bug du script) — ça
veut dire qu'un futur write path en prod devra vérifier le verrou lui-même
(ex. tenter d'ouvrir en exclusif avant d'écrire) plutôt que de compter sur
une erreur SQLCipher — documenter dans Task 6 quel que soit le résultat.

- [ ] **Step 3: Aucun commit** (script hors repo).

---

### Task 6: Documenter le résultat du spike (seul commit de ce plan, dans le repo Sift)

**Files:**
- Modify: `docs/ressources-externes.md` (nouvelle section "Évaluation 7 —
  spike d'écriture `master.db`", à la suite de l'Évaluation 6 existante).

**Interfaces:**
- Consumes: les 4 verdicts `PASS`/`FAIL` des Tasks 3, 4, 5 (+ tout message
  d'erreur exact rencontré).
- Produces: décision actée sur si M8 reste gelé ou passe en Phase 2 (spec
  de prod), pour la prochaine session.

- [ ] **Step 1: Rédiger la section de résultat**

Ajouter à la suite de la section "## Évaluation 6" dans
`docs/ressources-externes.md` (garder le même format que les évaluations
précédentes : Contexte / Méthode / Résultat / Implication / Décision) :

```markdown
---

## Évaluation 7 — spike d'écriture `master.db` (2026-07-04)

**Contexte** : suite de l'Évaluation 5 (lecture seule validée). M8 est
gelé (`docs/plan-implementation.md:236-243`) jusqu'à preuve qu'un
round-trip d'écriture ne corrompt pas `master.db`. Ce spike teste
exactement ça, sur une copie jetable (`~/Desktop/sift-masterdb-write-probe/`,
jamais le fichier live).

**Méthode** : `pyrekordbox` (déjà utilisé en lecture) pour 3 scénarios —
réparation de `FolderPath`, dédup d'une entrée de playlist dupliquée,
détection de verrou fichier. Chaque test relit avec une connexion fraîche
pour confirmer le round-trip (pas juste l'état en mémoire).

**Résultat** : [à remplir avec les 3 verdicts PASS/FAIL réels + tout
message d'erreur exact — ne pas inventer un résultat, copier la sortie
JSON de chaque script]

**Implication pour M8** : [à remplir : si les 3 PASS → M8 peut passer en
Phase 2 (spec de prod, portage Rust) ; si un FAIL → M8 reste gelé,
documenter précisément quel scénario échoue et pourquoi]

**Décision** : [à remplir après exécution]

Probe conservé à `~/Desktop/sift-masterdb-write-probe/` (hors repo,
jetable — supprimable). Scripts : `baseline.py`, `test_path_repair.py`,
`test_playlist_dedup.py`, `test_file_lock.py`.
```

- [ ] **Step 2: Committer uniquement ce fichier**

Run:
```bash
git add docs/ressources-externes.md
git commit -m "docs: résultat spike écriture master.db (Évaluation 7, M8)"
```
Expected: commit créé, seul `docs/ressources-externes.md` modifié (aucun
fichier du dossier probe n'est dans ce commit — il est hors repo).

---

## Séquencement

Task 1 → 2 → 3 → 4 → 5 doivent s'exécuter **dans l'ordre** (chaque test
reprend l'état laissé par le précédent sur la même copie). Si Task 3, 4 ou
5 échoue, **ne pas continuer** vers la tâche suivante tant que l'échec
n'est pas compris — documenter immédiatement dans Task 6 plutôt que
d'empiler des échecs sur un fichier potentiellement déjà corrompu (si un
round-trip corrompt le fichier, relancer Task 1 pour repartir d'une copie
saine avant de continuer les tests suivants).
