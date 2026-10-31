// Live check of the whole taste path and the guard's floor, for two profiles.
// Run: node tools/calibrate.ts   (needs QLOO_API_KEY). Prints only; writes nothing.

import { Qloo } from "../src/qloo.ts";
import { learn, newProfile, placePool, pickTwo, resolveCatalog, showPair } from "../src/twin.ts";
import { check, floorFor, pct } from "../src/guard.ts";

const qloo = new Qloo(process.env.QLOO_API_KEY ?? "");
const t0 = Date.now();
const resolved = await resolveCatalog(qloo);
console.log(`resolved ${resolved.seeds.length} seed rounds, ${resolved.shows.length} shows in ${Date.now() - t0} ms; dropped: ${resolved.dropped.join(", ") || "none"}`);

const OFF_TAGS = [
  "urn:tag:category:place:fast_food_restaurant",
  "urn:tag:category:place:steak_house",
  "urn:tag:category:place:night_club",
  "urn:tag:category:place:sports_bar",
];

for (const side of [0, 1]) {
  const profile = newProfile();
  for (const pair of resolved.seeds) learn(profile, pair[side], pair[side].tags);
  console.log(`\n=== profile ${side === 0 ? "A (Radiohead, Moonlight, Patagonia, The Bear)" : "B (Drake, Top Gun, Gucci, Love Island)"}`);
  let t = Date.now();
  const shows = await showPair(qloo, resolved, profile, process.argv[2] ?? "nyc");
  console.log(`shows (${Date.now() - t} ms): ${shows.map((s) => `${s.name} @ ${s.venue?.name} ${pct(s.affinity ?? 0)} | ${s.why}`).join("  ||  ")}`);
  const show = shows[0];
  learn(profile, show);
  t = Date.now();
  const dinnerPool = await placePool(qloo, profile, { lat: show.lat!, lon: show.lon! }, "dinner");
  const dinners = pickTwo(dinnerPool);
  console.log(`dinner pool ${dinnerPool.length} (${Date.now() - t} ms), floor ${pct(floorFor(dinnerPool) ?? 0)}; pair: ${dinners.map((d) => `${d.name} ${pct(d.affinity ?? 0)} [${d.line}] ${d.why}`).join("  ||  ")}`);
  const dinner = dinners[0];
  learn(profile, dinner);
  const afterPool = await placePool(qloo, profile, { lat: dinner.lat ?? show.lat!, lon: dinner.lon ?? show.lon! }, "after", [dinner.id]);
  console.log(`after pool ${afterPool.length}, pair: ${pickTwo(afterPool).map((d) => `${d.name} ${pct(d.affinity ?? 0)}`).join("  ||  ")}`);

  const slot = { name: "dinner", picked: dinner, pool: dinnerPool, anchor: { lat: show.lat!, lon: show.lon! } };
  // Legit swaps: lower-ranked places from the twin's own pool.
  for (const alt of dinnerPool.slice(2, 6)) {
    const d = await check(qloo, profile, slot, { entityId: alt.id });
    console.log(`  legit swap  ${d.verdict.padEnd(5)} ${alt.name.slice(0, 30).padEnd(30)} ${pct(d.affinity ?? 0)}`);
  }
  // Injected swaps: nearby places from off-taste categories.
  for (const tag of OFF_TAGS) {
    const near = await qloo.nearby([], show.lon!, show.lat!, tag, 1500, 3).catch(() => []);
    for (const p of near.slice(0, 2)) {
      const d = await check(qloo, profile, slot, { entityId: p.id });
      console.log(`  off-taste   ${d.verdict.padEnd(5)} ${p.name.slice(0, 30).padEnd(30)} ${pct(d.affinity ?? 0)} (${tag.split(":").pop()})`);
    }
  }
}
console.log(`\nQloo calls: ${qloo.calls}, total ${Date.now() - t0} ms`);
