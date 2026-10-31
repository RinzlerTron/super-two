import { test } from "node:test";
import assert from "node:assert/strict";
import { Qloo, firstSentence, type Fetcher } from "../src/qloo.ts";
import { check, floorFor, metres } from "../src/guard.ts";
import { newProfile, pickTwo, why, learn, twinTraits, type Option } from "../src/twin.ts";

const anchor = { lat: 40.76, lon: -73.98 };

function opt(id: string, affinity: number, extra: Partial<Option> = {}): Option {
  return { id, name: id, kind: "dinner", affinity, line: "", why: "", ...extra };
}

// Pool of 12 places, affinity 0.95 down to 0.84 in steps of 0.01.
const pool = Array.from({ length: 12 }, (_, i) => opt(`p${i}`, 0.95 - i * 0.01, { lat: 40.76, lon: -73.98 }));
const slot = { name: "dinner", picked: pool[0], pool, anchor };

/** A Qloo stand-in that scores from a fixed table and counts calls. */
function fakeQloo(table: Record<string, { affinity?: number; lat?: number; lon?: number; name?: string }>, status = 200) {
  let calls = 0;
  const fetcher: Fetcher = async (url) => {
    calls++;
    const ids = new URL(url).searchParams.get("filter.results.entities")?.split(",") ?? [];
    const entities = ids
      .filter((id) => table[id])
      .map((id) => ({
        entity_id: id,
        name: table[id].name ?? id,
        query: { affinity: table[id].affinity },
        location: { lat: table[id].lat, lon: table[id].lon },
      }));
    return { status, json: async () => ({ results: { entities } }) };
  };
  return { qloo: new Qloo("k", fetcher, "http://fake"), calls: () => calls };
}

test("floor is the 10th best pool score minus the margin", () => {
  assert.equal(floorFor(pool)!.toFixed(2), "0.85");
  assert.equal(floorFor([]), undefined);
});

test("the picked place passes without calling Qloo", async () => {
  const { qloo, calls } = fakeQloo({});
  const d = await check(qloo, newProfile(), slot, { entityId: "p0" });
  assert.equal(d.verdict, "allow");
  assert.equal(calls(), 0);
});

test("an in-taste nearby swap passes", async () => {
  const { qloo } = fakeQloo({ alt: { affinity: 0.9, lat: 40.761, lon: -73.981 } });
  const d = await check(qloo, newProfile(), slot, { entityId: "alt" });
  assert.equal(d.verdict, "allow");
});

test("an off-taste swap is blocked with the score in the reason", async () => {
  const { qloo } = fakeQloo({ lure: { affinity: 0.71, lat: 40.761, lon: -73.981, name: "Applebee's" } });
  const d = await check(qloo, newProfile(), slot, { entityId: "lure" });
  assert.equal(d.verdict, "block");
  assert.match(d.reasons.join(" "), /71\/100 you/);
  assert.equal(d.name, "Applebee's");
});

test("an in-taste place far from the night is blocked", async () => {
  const { qloo } = fakeQloo({ far: { affinity: 0.94, lat: 40.65, lon: -73.95 } });
  const d = await check(qloo, newProfile(), slot, { entityId: "far" });
  assert.equal(d.verdict, "block");
  assert.match(d.reasons.join(" "), /km from the rest of your night/);
});

test("fails closed: unknown id, unscored place, Qloo down", async () => {
  const none = await check(fakeQloo({}).qloo, newProfile(), slot, {});
  assert.equal(none.verdict, "ask");
  const unknown = await check(fakeQloo({}).qloo, newProfile(), slot, { entityId: "nope" });
  assert.equal(unknown.verdict, "ask");
  const down = await check(fakeQloo({ x: { affinity: 0.99 } }, 500).qloo, newProfile(), slot, { entityId: "x" });
  assert.equal(down.verdict, "ask");
});

test("metres is about right for a known pair", () => {
  // Radio City to Madison Square Garden is about 1.4 km.
  const m = metres({ lat: 40.76, lon: -73.98 }, { lat: 40.7505, lon: -73.9934 });
  assert.ok(m > 1300 && m < 1700, String(m));
});

test("pickTwo prefers a second option at a different price", () => {
  const a = opt("a", 0.95, { priceLevel: 3 });
  const b = opt("b", 0.94, { priceLevel: 3 });
  const c = opt("c", 0.93, { priceLevel: 2 });
  assert.deepEqual(pickTwo([a, b, c]).map((o) => o.id), ["a", "c"]);
  const far = [a, b, opt("d", 0.92, { priceLevel: 3 }), opt("e", 0.91, { priceLevel: 3 }), opt("f", 0.9, { priceLevel: 3 }), opt("g", 0.89, { priceLevel: 1 })];
  assert.deepEqual(pickTwo(far).map((o) => o.id), ["a", "b"]); // never reaches past the top 5
  assert.deepEqual(pickTwo([a, b]).map((o) => o.id), ["a", "b"]);
});

test("why names shared tags and skips category tags", () => {
  const p = newProfile();
  learn(p, opt("liked", 1), [
    { id: "urn:tag:genre:music:indie", name: "Indie" },
    { id: "urn:tag:category:place:bar", name: "Bar" },
  ]);
  assert.equal(why(p, [{ id: "urn:tag:genre:music:indie", name: "Indie" }]), "Shares indie with your picks");
  assert.equal(why(p, [{ id: "urn:tag:category:place:bar", name: "Bar" }]), "Close to your picks");
});

test("Qloo client caches identical calls and retries on 429", async () => {
  let n = 0;
  const fetcher: Fetcher = async () => {
    n++;
    return n === 1 ? { status: 429, json: async () => ({}) } : { status: 200, json: async () => ({ results: [] }) };
  };
  const q = new Qloo("k", fetcher, "http://fake");
  await q.search("x", "urn:entity:artist");
  await q.search("x", "urn:entity:artist");
  assert.equal(n, 2); // one 429, one success, then served from cache
});

test("twin traits weigh artist adjectives 3, 2, 1 and skip numbers", () => {
  const p = newProfile();
  learn(p, opt("seed", 1), [{ id: "urn:tag:genre:music:indie", name: "Indie" }, { id: "urn:tag:audience:25_29", name: "25 29" }]);
  learn(p, { ...opt("artist", 1), adjectives: ["Ethereal", "Intimate", "Lush", "Haunting"] });
  assert.deepEqual(twinTraits(p), ["ethereal", "intimate", "lush"]);
});

test("firstSentence keeps one sentence and cuts long ones at a word", () => {
  assert.equal(firstSentence("Lush bar. Second sentence."), "Lush bar.");
  const long = "word ".repeat(40).trim() + ".";
  const cut = firstSentence(long)!;
  assert.ok(cut.length <= 120 && cut.endsWith("..."), cut);
  assert.equal(firstSentence(undefined), undefined);
});

test("pickTwo prefers places with photos inside the top ranks", () => {
  const o = (id: string, price: number, image?: string) => ({ id, name: id, kind: "dinner", affinity: 0.9, line: "", why: "", priceLevel: price, image }) as Option;
  const pool = [o("a", 2), o("b", 2, "x.jpg"), o("c", 3), o("d", 3, "y.jpg"), o("e", 4)];
  assert.deepEqual(pickTwo(pool).map((p) => p.id), ["b", "d"]);
  const noPhotos = [o("a", 2), o("b", 2), o("c", 3)];
  assert.deepEqual(pickTwo(noPhotos).map((p) => p.id), ["a", "c"]);
});
