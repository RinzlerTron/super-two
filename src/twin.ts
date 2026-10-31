// The taste twin: builds each pair of options from Qloo and learns from picks.

import { type Entity, Qloo } from "./qloo.ts";
import { CITIES, SEED_ROUNDS, SHOWS, TAG_ANY_BAR, TAG_BAR, TAG_RESTAURANT, type City, type Venue, venueByKey } from "./catalog.ts";

export interface Option {
  id: string; // Qloo entity id
  name: string;
  kind: "city" | "seed" | "show" | "dinner" | "after";
  affinity?: number; // 0..1, Qloo affinity to the profile
  line: string; // one plain line under the name
  why: string; // why it fits, from shared Qloo tags
  venue?: Venue;
  address?: string;
  priceLevel?: number;
  lat?: number;
  lon?: number;
  image?: string; // Qloo's image url, shown as is (never stored)
  rank?: number; // places: position in the taste-ranked nearby pool
  of?: number;
  blurb?: string; // Qloo's own one-line description
  adjectives?: string[]; // Qloo's adjectives (artists)
  focus?: string; // photo crop (CSS object-position) when the default cuts badly
  logo?: boolean; // the image is a brand mark
}

export interface Profile {
  liked: string[]; // Qloo ids, in pick order
  likedTags: Map<string, string>; // tag id -> tag name, from liked entities
  traits: Map<string, number>; // word -> weight: what the twin has learned, shown to you
}

export function newProfile(): Profile {
  return { liked: [], likedTags: new Map(), traits: new Map() };
}

export function learn(profile: Profile, picked: Entity | Option, tags: Entity["tags"] = []): void {
  if (!profile.liked.includes(picked.id)) profile.liked.push(picked.id);
  for (const t of tags) {
    if (t.id && t.name && !isCategoryTag(t.id)) {
      profile.likedTags.set(t.id, t.name);
      bump(profile, t.name, 1);
    }
  }
  // Qloo's adjectives for a picked artist say the most about you. Qloo lists
  // the most telling first, so weigh them 3, 2, 1.
  (picked.adjectives ?? []).slice(0, 3).forEach((a, i) => bump(profile, a, 3 - i));
}

function bump(profile: Profile, word: string, by: number): void {
  const w = word.toLowerCase().trim();
  if (!w || w.length > 24 || /\d/.test(w)) return;
  profile.traits.set(w, (profile.traits.get(w) ?? 0) + by);
}

/** The words the twin shows for you, strongest first. Ties keep the newest pick first. */
// Shop-shelf words say little about a person; the twin speaks in moods and genres instead.
const FLAT = new Set(["footwear", "apparel", "clothing", "accessories", "heritage", "retail", "brand", "brands", "luxury",
  "fashion", "outdoor", "sportswear", "streetwear", "television", "film", "music", "movie", "series", "book", "books",
  "jewelry", "jewellery", "eyewear", "watches", "bags", "handbags", "cosmetics", "beauty", "trap"]);

export function twinTraits(profile: Profile, n = 3): string[] {
  return [...profile.traits.entries()]
    .filter(([word]) => !FLAT.has(word.toLowerCase()))
    .map(([word, weight], i) => ({ word, weight, i }))
    .sort((a, b) => b.weight - a.weight || b.i - a.i)
    .slice(0, n)
    .map((x) => x.word);
}

function isCategoryTag(id: string): boolean {
  return id.startsWith("urn:tag:category:") || id.includes(":keyword:");
}

/** Plain reason from tags the option shares with what you liked. */
export function why(profile: Profile, tags: Entity["tags"]): string {
  const shared = tags.filter((t) => profile.likedTags.has(t.id)).map((t) => t.name.toLowerCase());
  const unique = [...new Set(shared)].slice(0, 2);
  if (unique.length === 2) return `Shares ${unique[0]} and ${unique[1]} with your picks`;
  if (unique.length === 1) return `Shares ${unique[0]} with your picks`;
  return "Close to your picks";
}

/** Exact-name lookup for our fixed lists. A wrong match is dropped, never guessed. */
export async function resolveExact(qloo: Qloo, name: string, type: string): Promise<Entity | null> {
  const hits = await qloo.search(name, type, 5);
  const want = norm(name);
  return hits.find((h) => norm(h.name) === want) ?? null;
}

function norm(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface Resolved {
  cities: { city: City; image?: string }[];
  seeds: [Entity, Entity][];
  shows: { key: string; artist: Entity; venues: Record<string, Venue> }[];
  dropped: string[];
}

/** Resolve the fixed lists once at start-up. */
export async function resolveCatalog(qloo: Qloo): Promise<Resolved> {
  const dropped: string[] = [];
  const seeds: [Entity, Entity][] = [];
  for (const [a, b] of SEED_ROUNDS) {
    const [ea, eb] = await Promise.all([resolveExact(qloo, a.name, a.type), resolveExact(qloo, b.name, b.type)]);
    if (ea && eb) seeds.push([ea, eb]);
    else dropped.push(`${a.name} / ${b.name}`);
  }
  const shows: Resolved["shows"] = [];
  const artists = await Promise.all(SHOWS.map((s) => resolveExact(qloo, s.artist, "urn:entity:artist")));
  SHOWS.forEach((s, i) => {
    const artist = artists[i];
    const venues = Object.fromEntries(Object.entries(s.venue).map(([city, key]) => [city, venueByKey(key)]));
    if (artist) shows.push({ key: s.key, artist, venues });
    else dropped.push(s.artist);
  });
  // City photos are a nice-to-have: a failed lookup just means no photo.
  const cities = await Promise.all(CITIES.map(async (city) => {
    const hit = await resolveExact(qloo, city.photo, "urn:entity:place").catch(() => null);
    return { city, image: hit?.image };
  }));
  return { cities, seeds, shows, dropped };
}

export function cityPair(resolved: Resolved): Option[] {
  return resolved.cities.map(({ city, image }) => ({
    id: city.key, name: city.name, kind: "city" as const, line: city.line, why: "", image,
  }));
}

export function seedPair(resolved: Resolved, round: number): Option[] | null {
  const pair = resolved.seeds[round];
  if (!pair) return null;
  const notes = SEED_ROUNDS[round];
  return pair.map((e, i) => ({
    id: e.id,
    name: e.name,
    image: e.image,
    blurb: e.blurb,
    kind: "seed" as const,
    line: notes[i].note,
    why: "",
    focus: notes[i].focus,
    logo: notes[i].logo,
  }));
}

/** Two shows that fit best, at two different venues. */
export async function showPair(qloo: Qloo, resolved: Resolved, profile: Profile, city: string): Promise<Option[]> {
  const scored = await qloo.score(profile.liked, resolved.shows.map((s) => s.artist.id), "urn:entity:artist");
  const ranked = resolved.shows
    .map((s) => ({ s: { ...s, venue: s.venues[city] }, e: scored.get(s.artist.id) }))
    .filter((x) => x.s.venue)
    .filter((x) => x.e && !profile.liked.includes(x.s.artist.id))
    .sort((a, b) => (b.e!.affinity ?? 0) - (a.e!.affinity ?? 0));
  const out: Option[] = [];
  const venues = new Set<string>();
  for (const { s, e } of ranked) {
    if (venues.has(s.venue.key)) continue;
    venues.add(s.venue.key);
    out.push({
      id: s.artist.id,
      name: s.artist.name,
      kind: "show",
      affinity: e!.affinity,
      line: `${s.venue.name}, ${s.venue.area}`,
      why: why(profile, e!.tags),
      venue: s.venue,
      image: e!.image ?? s.artist.image,
      blurb: e!.blurb ?? s.artist.blurb,
      adjectives: e!.adjectives.length ? e!.adjectives : s.artist.adjectives,
      lat: s.venue.lat,
      lon: s.venue.lon,
    });
    if (out.length === 2) break;
  }
  return out;
}

/** Taste-ranked places near a point; used for the pair and as the alternatives pool. */
export async function placePool(
  qloo: Qloo,
  profile: Profile,
  at: { lat: number; lon: number },
  kind: "dinner" | "after",
  exclude: string[] = [],
): Promise<Option[]> {
  // Widen the search when a venue has few matching places around it (for
  // example a stadium district): same tag further out, then a broader tag.
  const attempts =
    kind === "dinner"
      ? [{ tag: TAG_RESTAURANT, radius: 1200 }, { tag: TAG_RESTAURANT, radius: 2500 }]
      : [{ tag: TAG_BAR, radius: 1200 }, { tag: TAG_BAR, radius: 2500 }, { tag: TAG_ANY_BAR, radius: 2500 }];
  let places: Entity[] = [];
  for (const a of attempts) {
    const found = (await qloo.nearby(profile.liked, at.lon, at.lat, a.tag, a.radius, 25)).filter(
      (p) => !exclude.includes(p.id) && p.tags.some((t) => t.id === a.tag) && !/\bhotel\b/i.test(p.name),
    );
    places = found;
    if (found.length >= 4) break;
  }
  const pool = places
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind,
      affinity: p.affinity,
      line: placeLine(p),
      why: why(profile, p.tags),
      address: p.address,
      priceLevel: p.priceLevel,
      image: p.image,
      blurb: p.blurb,
      lat: p.lat,
      lon: p.lon,
    }));
  // Place scores sit on a different scale per city, so the tile shows the
  // rank among nearby places instead of the raw score.
  pool.forEach((o, i) => {
    o.rank = i + 1;
    o.of = pool.length;
  });
  return pool;
}

function placeLine(p: Entity): string {
  // First address part, without a trailing "Singapore 123456".
  const street = (p.address ?? "").split(",")[0].replace(/\s+Singapore\s+\d{6}.*$/i, "").replace(/\s+(New York|Brooklyn|Queens)$/i, "");
  const walk = p.distance != null ? `${Math.max(1, Math.round(p.distance / 80))} min walk` : "";
  const price = p.priceLevel ? "$".repeat(p.priceLevel) : "";
  return [walk, street, price].filter(Boolean).join(" · ");
}

/** Two from the top of the pool; the second at a different price if one is near the top. */
export function pickTwo(pool: Option[]): Option[] {
  if (pool.length <= 2) return pool.slice(0, 2);
  // A card without a photo looks broken next to one with, so prefer places with photos,
  // staying inside the twin's top 3 for the first and top 5 for the second.
  const first = pool.slice(0, 3).find((o) => o.image) ?? pool[0];
  const rest = pool.slice(0, 5).filter((o) => o !== first);
  const second = rest.find((o) => o.priceLevel !== first.priceLevel && o.image)
    ?? rest.find((o) => o.priceLevel !== first.priceLevel)
    ?? rest.find((o) => o.image)
    ?? rest[0];
  return [first, second];
}
