import { describe, expect, it } from "vitest";
import { appliquerDelta, creerLecteurDeFile } from "../frontend/queue-delta";
import type { QueueDelta, QueueItem } from "../shared/contracts";

const piste = (id: number, title: string | null = null): QueueItem => ({
  id,
  path: `C:/m/${id}.flac`,
  filename: `${id}.flac`,
  source_id: 1,
  verdict: null,
  rail: null,
  artist: null,
  title,
  dup: false,
  needs_analysis: true,
  analysis_attempts: 0,
  duration: null,
  bitrate: null,
  declared_fmt: null,
  is_new: false,
});

const ids = (file: QueueItem[]) => file.map((it) => it.id);

describe("appliquerDelta", () => {
  it("retire, remplace et insère à sa place par id", () => {
    const apres = appliquerDelta([piste(1), piste(3), piste(5)], {
      upserted: [piste(3, "neuf"), piste(4), piste(9)],
      removed: [1],
    });
    expect(ids(apres)).toEqual([3, 4, 5, 9]);
    expect(apres[0].title).toBe("neuf");
  });

  it("ne touche pas la file d'origine", () => {
    const file = [piste(1)];
    appliquerDelta(file, { upserted: [], removed: [1] });
    expect(ids(file)).toEqual([1]);
  });
});

describe("creerLecteurDeFile", () => {
  const vide: QueueDelta = { upserted: [], removed: [] };

  it("lit tout une fois, puis ne demande que des deltas", async () => {
    let tout = 0;
    let deltas = 0;
    const lire = creerLecteurDeFile(
      async () => (tout++, [piste(1)]),
      async () => (deltas++, { upserted: [piste(2)], removed: [] }),
    );
    expect(ids(await lire())).toEqual([1]);
    expect(ids(await lire())).toEqual([1, 2]);
    expect([tout, deltas]).toEqual([1, 1]);
  });

  it("applique les deltas dans l'ordre des appels, même si le premier répond plus tard", async () => {
    let libere: (d: QueueDelta) => void = () => {};
    const reponses: Array<() => Promise<QueueDelta>> = [
      () => new Promise((r) => (libere = r)),
      async () => ({ upserted: [piste(1, "seconde")], removed: [] }),
    ];
    const lire = creerLecteurDeFile(
      async () => [piste(1, "origine")],
      () => (reponses.shift() ?? (async () => vide))(),
    );
    await lire();
    const a = lire();
    const b = lire();
    await Promise.resolve();
    libere({ upserted: [piste(1, "premiere")], removed: [] });
    await a;
    expect((await b)[0].title).toBe("seconde");
    expect((await lire())[0].title).toBe("seconde");
  });

  it("après un delta en échec, relit tout : le backend a pu avancer sans nous", async () => {
    let tout = 0;
    let echoue = true;
    const lire = creerLecteurDeFile(
      async () => (tout++, [piste(tout)]),
      async () => {
        if (echoue) {
          echoue = false;
          throw new Error("ipc");
        }
        return vide;
      },
    );
    await lire();
    await expect(lire()).rejects.toThrow("ipc");
    expect(ids(await lire())).toEqual([2]);
  });

  it("un échec n'empêche pas l'appel qui attendait derrière lui", async () => {
    let n = 0;
    const lire = creerLecteurDeFile(
      async () => {
        if (n++ === 0) throw new Error("ipc");
        return [piste(1)];
      },
      async () => vide,
    );
    const a = lire();
    const b = lire();
    await expect(a).rejects.toThrow("ipc");
    expect(ids(await b)).toEqual([1]);
  });
});
