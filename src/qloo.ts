// Qloo hackathon API client. The key stays on the server (QLOO_API_KEY).
// Responses are cached in memory only: Qloo data must not be stored in the
// public repo, and a process-lifetime cache keeps repeat taps fast.

export const QLOO_BASE = "https://hackathon.api.qloo.com";

export interface Entity {
  id: string;
  name: string;
  type: string;
  affinity?: number;
  distance?: number;
  address?: string;
  priceLevel?: number;
  tags: { id: string; name: string; type?: string }[];
  image?: string;
  lat?: number;
  lon?: number;
  blurb?: string; // Qloo's own one-line description
  adjectives: string[]; // Qloo's adjectives (artists), most telling first
}

export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number;
  json(): Promise<any>;
}>;

export class QlooError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class Qloo {
  private cache = new Map<string, Promise<any>>();
  calls = 0;
  private key: string;
  private fetcher: Fetcher;
  private base: string;

  // No parameter properties: the code runs on Node's built-in type stripping.
  constructor(key: string, fetcher: Fetcher = fetch as unknown as Fetcher, base = QLOO_BASE) {
    this.key = key;
    this.fetcher = fetcher;
    this.base = base;
  }

  // Qloo allows 10 requests a second per key; space calls to stay under it.
  private next = 0;
  private async slot(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + 125;
    if (at > now) await sleep(at - now);
  }

  private get(path: string, params: Record<string, string | number>): Promise<any> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    const url = `${this.base}${path}?${query}`;
    const hit = this.cache.get(url);
    if (hit) return hit;
    const pending = (async () => {
      let res;
      for (let attempt = 0; ; attempt++) {
        await this.slot();
        this.calls += 1;
        res = await this.fetcher(url, { headers: { "X-Api-Key": this.key, accept: "application/json" } });
        if (res.status !== 429 || attempt >= 3) break;
        await sleep(400 * (attempt + 1));
      }
      const body = await res.json().catch(() => ({}));
      if (res.status !== 200) {
        throw new QlooError(`Qloo ${path} returned HTTP ${res.status}`, res.status);
      }
      return body;
    })();
    this.cache.set(url, pending);
    // A failed call must not poison the cache.
    pending.catch(() => this.cache.delete(url));
    return pending;
  }

  /** Find entities by name. Used only for the fixed seed list, never live input. */
  async search(name: string, type: string, take = 3): Promise<Entity[]> {
    const body = await this.get("/search", { query: name, types: type, take });
    return (body.results ?? []).map(toEntity);
  }

  /** Score given entities against a taste profile (liked entity ids). */
  async score(likedIds: string[], candidateIds: string[], type: string): Promise<Map<string, Entity>> {
    const out = new Map<string, Entity>();
    if (!candidateIds.length) return out;
    const body = await this.get("/v2/insights", {
      "filter.type": type,
      "signal.interests.entities": likedIds.join(","),
      "filter.results.entities": candidateIds.join(","),
      take: Math.min(50, candidateIds.length),
    });
    for (const raw of body.results?.entities ?? []) {
      const e = toEntity(raw);
      out.set(e.id, e);
    }
    return out;
  }

  /** Places near a point with a category tag, ranked by the taste profile. */
  async nearby(likedIds: string[], lon: number, lat: number, tag: string, radius = 1500, take = 20): Promise<Entity[]> {
    const body = await this.get("/v2/insights", {
      "filter.type": "urn:entity:place",
      "filter.location": `POINT(${lon} ${lat})`,
      "filter.location.radius": radius,
      "filter.tags": tag,
      "signal.interests.entities": likedIds.join(","),
      take,
    });
    return (body.results?.entities ?? []).map(toEntity);
  }
}

export function toEntity(raw: any): Entity {
  const p = raw.properties ?? {};
  const loc = raw.location ?? {};
  return {
    id: raw.entity_id,
    name: raw.name,
    type: raw.type ?? raw.subtype ?? "",
    affinity: raw.query?.affinity,
    distance: raw.query?.distance,
    address: p.address,
    priceLevel: p.price_level,
    tags: (raw.tags ?? []).map((t: any) => ({ id: t.id ?? t.tag_id, name: t.name, type: t.type })),
    image: p.image?.url,
    lat: loc.lat,
    lon: loc.lon,
    blurb: firstSentence(p.known_for ?? p.short_description ?? englishShort(p.short_descriptions) ?? p.description),
    adjectives: (p.adjectives_for_music ?? p.adjectives_for_fans ?? []).filter((a: unknown) => typeof a === "string").slice(0, 4),
  };
}

function englishShort(list: any): string | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.find((x) => x?.languages?.includes("en"))?.value;
}

/** First sentence, at most about 120 characters, cut at a word. */
export function firstSentence(text: unknown): string | undefined {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const one = text.trim().split(/(?<=[.!?])\s/)[0];
  if (one.length <= 120) return one;
  return one.slice(0, 117).replace(/\s+\S*$/, "") + "...";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
