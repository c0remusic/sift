"""Regenerates src-tauri/tests/fixtures/rekordbox_master.db.

Synthetic SQLCipher v4 database, no personal data. The passphrase below is
the deobfuscated static `master.db` passphrase (same value asserted by
rekordbox_masterdb.rs's `deobfuscate_key_matches_pyrekordbox_reference`
test) — it is a publicly documented constant, not a per-installation secret.

Usage: python scripts/make-rekordbox-fixture.py
Requires: pip install sqlcipher3-wheels
"""
import os
import sqlcipher3.dbapi2 as sqlite3

KEY = "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497"
OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "src-tauri", "tests", "fixtures", "rekordbox_master.db",
)

if os.path.exists(OUT):
    os.remove(OUT)

conn = sqlite3.connect(OUT)
conn.execute("PRAGMA key = '" + KEY + "'")
conn.execute("PRAGMA cipher_compatibility = 4")

conn.execute(
    "CREATE TABLE djmdContent ("
    "ID TEXT PRIMARY KEY, Title TEXT, FolderPath TEXT, "
    "FileNameL TEXT, FileNameS TEXT, "
    "rb_local_usn INTEGER, updated_at TEXT)"
)
conn.execute("CREATE TABLE djmdPlaylist (ID TEXT PRIMARY KEY, Name TEXT, ParentID TEXT)")
conn.execute(
    "CREATE TABLE djmdSongPlaylist ("
    "ID TEXT PRIMARY KEY, PlaylistID TEXT, ContentID TEXT, TrackNo INTEGER)"
)
conn.execute(
    "CREATE TABLE agentRegistry (registry_id TEXT PRIMARY KEY, int_1 INTEGER, updated_at TEXT)"
)

conn.executemany(
    "INSERT INTO djmdContent VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
        ("40000001", "Synthetic Test Track One", "D:/FIXTURE/track1.mp3",
         "track1.mp3", "track1.mp3", 1000, "2026-01-01 00:00:00.000000"),
        ("40000002", "Synthetic Test Track Two", "D:/FIXTURE/track2.flac",
         "track2.flac", "track2.flac", 1000, "2026-01-01 00:00:00.000000"),
        ("40000003", "Synthetic Test Track Three", "D:/FIXTURE/track3.wav",
         "track3.wav", "track3.wav", 1000, "2026-01-01 00:00:00.000000"),
    ],
)
conn.execute("INSERT INTO djmdPlaylist VALUES ('50000001', 'Fixture Playlist', NULL)")
conn.executemany(
    "INSERT INTO djmdSongPlaylist VALUES (?, ?, ?, ?)",
    [
        ("60000001", "50000001", "40000001", 1),
        ("60000002", "50000001", "40000002", 2),
    ],
)
conn.execute(
    "INSERT INTO agentRegistry VALUES ('localUpdateCount', 1000, '2026-01-01 00:00:00.000000')"
)

conn.commit()
conn.close()
print("wrote", OUT, os.path.getsize(OUT), "bytes")
