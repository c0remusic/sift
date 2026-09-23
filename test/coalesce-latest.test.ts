// `coalesce-latest.ts` — une écriture à la fois, et la dernière demande n'est jamais perdue. Le cas
// réel : l'artiste gravé au premier Tab, le titre tapé et validé pendant que l'écriture tourne.
import { describe, expect, it } from "vitest";
import { coalesceLatest } from "../frontend/coalesce-latest";

/** Un `run` dont chaque exécution attend qu'on la libère à la main. */
function manualRun() {
  const calls: string[] = [];
  const releases: Array<() => void> = [];
  const run = (v: string): Promise<void> => {
    calls.push(v);
    return new Promise<void>((res) => releases.push(res));
  };
  const releaseNext = async (): Promise<void> => {
    releases.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { calls, run, releaseNext };
}

describe("coalesceLatest", () => {
  it("une demande arrivée pendant l'écriture est rejouée après, avec sa valeur", async () => {
    const m = manualRun();
    const trigger = coalesceLatest(m.run, (a, b) => a === b);
    const first = trigger("artiste");
    void trigger("artiste+titre");
    expect(m.calls).toEqual(["artiste"]);
    await m.releaseNext();
    expect(m.calls).toEqual(["artiste", "artiste+titre"]);
    await m.releaseNext();
    await first;
  });

  it("trois demandes pendant le vol : seule la dernière est rejouée", async () => {
    const m = manualRun();
    const trigger = coalesceLatest(m.run, (a, b) => a === b);
    const first = trigger("a");
    void trigger("b");
    void trigger("c");
    void trigger("d");
    await m.releaseNext();
    await m.releaseNext();
    await first;
    expect(m.calls).toEqual(["a", "d"]);
  });

  it("le double déclenchement (Entrée puis blur, même valeur) n'écrit qu'une fois", async () => {
    const m = manualRun();
    const trigger = coalesceLatest(m.run, (a, b) => a === b);
    const first = trigger("x");
    void trigger("x");
    await m.releaseNext();
    await first;
    expect(m.calls).toEqual(["x"]);
  });

  it("après la fin, une nouvelle demande repart normalement", async () => {
    const m = manualRun();
    const trigger = coalesceLatest(m.run, (a, b) => a === b);
    const first = trigger("x");
    await m.releaseNext();
    await first;
    const second = trigger("y");
    await m.releaseNext();
    await second;
    expect(m.calls).toEqual(["x", "y"]);
  });
});
