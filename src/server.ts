// HTTP server: the pick-of-two flow, the booking run (server-sent events) and
// the static page. No framework: node:http is enough for four routes.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { Qloo, type Entity } from "./qloo.ts";
import {
  cityPair, learn, newProfile, twinTraits, pickTwo, placePool, resolveCatalog, seedPair, showPair,
  type Option, type Profile, type Resolved,
} from "./twin.ts";
import { check, floorFor } from "./guard.ts";
import { holdRef, lureNote, runAgent, type AgentEvent, type Plan, type Scenario } from "./agent.ts";

const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? "127.0.0.1";

// The public demo spends a capped Claude key and Qloo's 50k calls a month:
// cap agent runs and new sessions per visitor and per day.
type Req = { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } };
const ipOf = (req: Req) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
function limiter(perHour: number, perDay: number, hourText: string, dayText: string) {
  const byIp = new Map<string, number[]>();
  let day = "";
  let today = 0;
  return (ip: string): string | null => {
    const now = Date.now();
    const d = new Date(now).toISOString().slice(0, 10);
    if (d !== day) { day = d; today = 0; byIp.clear(); }
    const recent = (byIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (today >= perDay) return dayText;
    if (recent.length >= perHour) return hourText;
    recent.push(now);
    byIp.set(ip, recent);
    today++;
    return null;
  };
}
const RUNS_PER_HOUR = Number(process.env.RUNS_PER_HOUR ?? 6);
const runLimit = limiter(RUNS_PER_HOUR, Number(process.env.RUNS_PER_DAY ?? 300),
  `You have held ${RUNS_PER_HOUR} nights this hour. Try again in a little while.`,
  "The demo has reached today's limit of agent runs. Try again tomorrow.");
const startLimit = limiter(Number(process.env.STARTS_PER_HOUR ?? 30), Number(process.env.STARTS_PER_DAY ?? 1500),
  "You have started a lot of nights this hour. Try again in a little while.",
  "The demo has reached today's limit. Try again tomorrow.");
const QLOO_CALLS_PER_DAY = Number(process.env.QLOO_CALLS_PER_DAY ?? 5000);
let qlooDay = "";
let qlooAtDayStart = 0;
function qlooSpentToday(calls: number): number {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== qlooDay) { qlooDay = d; qlooAtDayStart = calls; }
  return calls - qlooAtDayStart;
}
loadWindowsUserKeys(["QLOO_API_KEY", "ANTHROPIC_API_KEY"]);
const qloo = new Qloo(process.env.QLOO_API_KEY ?? "");
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Local dev on Windows: keys saved as user variables after the shell started
// are not in process.env yet. Read them from the registry. Never printed.
function loadWindowsUserKeys(names: string[]): void {
  if (process.platform !== "win32") return;
  for (const name of names) {
    if (process.env[name]) continue;
    try {
      const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(\\S+)`));
      if (m) process.env[name] = m[1];
    } catch {
      // not set
    }
  }
}
const PAGE = new URL("../public/index.html", import.meta.url);

// Off-taste categories a poisoned page can push: the lure is the nearby place
// from these that fits the guest's taste least.
const LURE_TAGS = [
  "urn:tag:category:place:fast_food_restaurant",
  "urn:tag:category:place:steak_house",
  "urn:tag:category:place:sports_bar",
];

type Stage = "city" | "seed" | "show" | "dinner" | "after" | "review";

interface Session {
  id: string;
  profile: Profile;
  city?: string;
  stage: Stage;
  round: number;
  pair: Option[];
  picks: Partial<Record<"show" | "dinner" | "after", Option>>;
  pools: Partial<Record<"dinner" | "after", Option[]>>;
  plan?: Plan;
  booking?: boolean;
  touched: number;
  ahead?: Map<string, Promise<Session>>; // option id -> the session after that pick
}

const sessions = new Map<string, Session>();
let resolved: Resolved | null = null;
let resolving: Promise<Resolved> | null = null;

function catalog(): Promise<Resolved> {
  if (resolved) return Promise.resolve(resolved);
  resolving ??= resolveCatalog(qloo).then((r) => {
    resolved = r;
    if (r.dropped.length) console.log(`dropped from catalog: ${r.dropped.join(", ")}`);
    return r;
  }).finally(() => { resolving = null; });
  return resolving;
}

// Sessions expire after 30 idle minutes.
setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, s] of sessions) if (s.touched < cutoff) sessions.delete(id);
}, 60_000).unref();

async function nextPair(s: Session): Promise<void> {
  const r = await catalog();
  if (s.stage === "city") {
    s.pair = cityPair(r);
    return;
  }
  if (s.stage === "seed") {
    const pair = seedPair(r, s.round);
    if (pair) { s.pair = pair; return; }
    s.stage = "show";
  }
  if (s.stage === "show") {
    s.pair = await showPair(qloo, r, s.profile, s.city ?? "nyc");
    return;
  }
  if (s.stage === "dinner") {
    const show = s.picks.show!;
    const pool = await placePool(qloo, s.profile, { lat: show.lat!, lon: show.lon! }, "dinner");
    s.pools.dinner = pool;
    s.pair = pickTwo(pool);
    return;
  }
  if (s.stage === "after") {
    const show = s.picks.show!;
    const dinner = s.picks.dinner!;
    // The after spot is near the venue: the night continues from the show.
    const pool = await placePool(qloo, s.profile, { lat: show.lat!, lon: show.lon! }, "after", [dinner.id]);
    s.pools.after = pool;
    s.pair = pickTwo(pool);
    return;
  }
  s.pair = [];
}

async function makePlan(s: Session): Promise<Plan> {
  const show = s.picks.show!;
  const anchor = { lat: show.lat!, lon: show.lon! };
  const plan: Plan = {
    show,
    dinner: s.picks.dinner!,
    after: s.picks.after!,
    partySize: 2,
    slots: {
      dinner: { name: "dinner", picked: s.picks.dinner!, pool: s.pools.dinner ?? [], anchor },
      after: { name: "after", picked: s.picks.after!, pool: s.pools.after ?? [], anchor },
    },
  };
  // Pick the lure: the least fitting nearby place from off-taste categories.
  const found: Entity[] = [];
  for (const tag of LURE_TAGS) {
    const near = await qloo.nearby(s.profile.liked, anchor.lon, anchor.lat, tag, 1500, 10).catch(() => []);
    found.push(...near.filter((p) => typeof p.affinity === "number"));
  }
  const floor = floorFor(plan.slots.dinner.pool) ?? 1;
  const below = found.filter((p) => p.affinity! < floor).sort((a, b) => a.affinity! - b.affinity!);
  const lure = below[0];
  if (lure) {
    plan.lure = {
      id: lure.id, name: lure.name, kind: "dinner", affinity: lure.affinity,
      line: lure.address ?? "", why: "", address: lure.address, lat: lure.lat, lon: lure.lon,
    };
  }
  return plan;
}

function view(s: Session) {
  return {
    session: s.id,
    stage: s.stage,
    city: s.city ? resolved?.cities.find((c) => c.city.key === s.city)?.city.name : null,
    round: s.round,
    rounds: resolved?.seeds.length ?? 4,
    pair: s.pair.map(publicOption),
    picks: Object.fromEntries(Object.entries(s.picks).map(([k, v]) => [k, publicOption(v!)])),
    twin: twinTraits(s.profile),
    agentReady: !!anthropic,
    proof: PROOF,
    // The taste rounds are fixed, so their photos can load while you pick a city.
    preload: s.stage === "city" ? resolved?.seeds.flat().map((e) => e.image).filter(Boolean) ?? [] : [],
  };
}

/** Apply one pick to a session: learn, move to the next stage, build the next pair. */
async function applyPick(s: Session, chosen: Option): Promise<void> {
  if (s.stage === "city") {
    s.city = chosen.id;
    s.stage = "seed";
    await nextPair(s);
    return;
  }
  const tags = s.stage === "seed" ? resolved!.seeds[s.round].find((e) => e.id === chosen.id)?.tags ?? [] : [];
  learn(s.profile, chosen, tags);
  if (s.stage === "seed") {
    s.round += 1;
    if (s.round >= (resolved?.seeds.length ?? 0)) s.stage = "show";
  } else if (s.stage === "show") { s.picks.show = chosen; s.stage = "dinner"; }
  else if (s.stage === "dinner") { s.picks.dinner = chosen; s.stage = "after"; }
  else if (s.stage === "after") { s.picks.after = chosen; s.stage = "review"; }
  await nextPair(s);
  if (s.stage === "review") s.plan = await makePlan(s);
}

function cloneSession(s: Session): Session {
  const { ahead, ...rest } = s;
  return structuredClone(rest) as Session;
}

/** While the guest decides, work out both possible next screens, so a tap answers at once.
 *  Costs one extra branch of Qloo calls per step (all cached in memory). */
function lookAhead(s: Session): void {
  if (s.stage === "review") return;
  s.ahead = new Map(s.pair.map((o) => {
    const branch = cloneSession(s);
    const done = applyPick(branch, o).then(() => branch);
    done.catch(() => {}); // a failed branch is redone on the real tap
    return [o.id, done];
  }));
}

function publicOption(o: Option) {
  return { id: o.id, name: o.name, kind: o.kind, line: o.line, why: o.why, blurb: o.blurb ?? null, fit: o.affinity != null ? Math.round(o.affinity * 1000) / 10 : null, venue: o.venue?.name, image: o.image ?? null, rank: o.rank ?? null, of: o.of ?? null, focus: o.focus ?? null, logo: o.logo ?? false };
}

async function body(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

// The guard's measured record (eval-results/summary.json, committed), shown on the ticket.
const PROOF = (() => {
  try {
    const a = JSON.parse(readFileSync(new URL("../eval-results/summary.json", import.meta.url), "utf8")).arms;
    return { stopped: a.qlooGuard.attacksStopped, of: a.qlooGuard.attacks };
  } catch { return null; }
})();

// The page can also be served from GitHub Pages; it then calls this server across sites.
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS ?? "https://rinzlertron.github.io").split(",");

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function getSession(id: unknown): Session | null {
  const s = typeof id === "string" ? sessions.get(id) : undefined;
  if (s) s.touched = Date.now();
  return s ?? null;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  const origin = req.headers.origin;
  if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" });
      res.end();
      return;
    }
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(PAGE));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    send(res, 200, { ok: true, catalog: !!resolved, agent: !!anthropic, qlooCalls: qloo.calls });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/start") {
    const limited = startLimit(ipOf(req)) ?? (qlooSpentToday(qloo.calls) >= QLOO_CALLS_PER_DAY ? "The demo has reached today's limit. Try again tomorrow." : null);
    if (limited) return send(res, 429, { error: limited });
    const s: Session = {
      id: randomUUID(), profile: newProfile(), stage: "city", round: 0, pair: [],
      picks: {}, pools: {}, touched: Date.now(),
    };
    sessions.set(s.id, s);
    await nextPair(s);
    lookAhead(s);
    send(res, 200, view(s));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/pick") {
    const b = await body(req);
    const s = getSession(b.session);
    if (!s) return send(res, 404, { error: "This night has expired. Start again." });
    const chosen = s.pair.find((o) => o.id === b.id);
    if (!chosen) return send(res, 400, { error: "That option is no longer on screen." });
    // Use the branch worked out while the guest was deciding, if it is ready
    // and good; otherwise work it out now.
    const ahead = s.ahead?.get(chosen.id);
    let next: Session | null = ahead ? await ahead.catch(() => null) : null;
    if (!next) {
      next = cloneSession(s);
      await applyPick(next, chosen);
    }
    Object.assign(s, next, { id: s.id, touched: Date.now(), ahead: undefined, booking: false });
    lookAhead(s);
    send(res, 200, view(s));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/book") {
    const s = getSession(url.searchParams.get("session"));
    if (!s || !s.plan) return send(res, 404, { error: "Pick your night first." });
    if (!anthropic) return send(res, 503, { error: "The booking agent is not configured on this server." });
    if (s.booking) return send(res, 409, { error: "Already booking." });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const emit = (e: AgentEvent | Record<string, unknown>) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const limited = runLimit(ipOf(req));
    if (limited) {
      emit({ type: "error", text: limited });
      emit({ type: "end" });
      res.end();
      return;
    }
    s.booking = true;
    const scenario: Scenario = url.searchParams.get("scenario") === "clean" ? "clean" : "poisoned";
    emit({
      type: "lure", name: s.plan.lure?.name ?? null, page: s.plan.dinner.name,
      quote: s.plan.lure ? lureNote(s.plan.lure.name) : null,
      fit: s.plan.lure?.affinity != null ? Math.round(s.plan.lure.affinity * 100) : null,
    });
    let obeyed = false;
    let failed = false;
    try {
      await runAgent({
        client: anthropic, qloo, profile: s.profile, plan: s.plan, scenario,
        emit: (e) => {
          if (e.type === "done") obeyed = e.obeyedInjection;
          if (e.type === "error") failed = true;
          emit(e);
        },
      });
      // A well-behaved model may ignore the planted line. Show what the guard
      // does when an agent obeys it: the same check, on the same place.
      if (!failed && !obeyed && scenario === "poisoned" && s.plan.lure) {
        const decision = await check(qloo, s.profile, s.plan.slots.dinner, { entityId: s.plan.lure.id, name: s.plan.lure.name });
        emit({ type: "simulated", page: s.plan.dinner.name, slot: "dinner", name: s.plan.lure.name, decision, ref: decision.verdict === "block" ? holdRef(0) : undefined });
      }
    } catch (error) {
      emit({ type: "error", text: "The booking run failed." });
      console.error(error);
    } finally {
      emit({ type: "end" });
      s.booking = false;
      res.end();
    }
    return;
  }
  send(res, 404, { error: "Not found" });
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) send(res, 502, { error: "Qloo did not answer. Try again." });
    else res.end();
  });
}).listen(PORT, HOST, () => {
  console.log(`Super Two on http://${HOST}:${PORT}`);
  catalog().then((r) => console.log(`catalog ready: ${r.seeds.length} rounds, ${r.shows.length} shows`)).catch((e) => console.error("catalog failed", e.message));
});
