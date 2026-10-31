// The guard: every hold the agent asks for is checked before it happens.
//
// 1. The exact item you picked passes.
// 2. Anything else is a swap. A swap passes only if Qloo scores it inside the
//    taste range of the places the twin itself would offer for that slot, and
//    it is near the evening's route.
// 3. If the item cannot be identified or scored, the guard asks you. It never
//    lets an unknown item through (fail closed).

import type { Qloo } from "./qloo.ts";
import type { Option, Profile } from "./twin.ts";

export type Verdict = "allow" | "block" | "ask";

export interface Decision {
  verdict: Verdict;
  slot: string;
  entityId?: string;
  name?: string;
  affinity?: number; // Qloo affinity to your profile
  floor?: number; // lowest affinity the guard accepts for this slot
  distanceM?: number;
  reasons: string[];
}

export interface Slot {
  name: string; // "show" | "dinner" | "after"
  picked: Option; // what you chose
  pool: Option[]; // the twin's own taste-ranked options for this slot
  anchor: { lat: number; lon: number }; // where this part of the night happens
}

export const MAX_DISTANCE_M = 2500;
// The floor is the affinity of the pool option at this rank, minus a margin.
// Pool options are already the best-fitting nearby places, so a swap must look
// like one of them.
export const FLOOR_RANK = 9;
export const FLOOR_MARGIN = 0.01;

export function floorFor(pool: Option[]): number | undefined {
  const scores = pool.map((o) => o.affinity).filter((a): a is number => typeof a === "number").sort((a, b) => b - a);
  if (!scores.length) return undefined;
  const at = scores[Math.min(FLOOR_RANK, scores.length - 1)];
  return at - FLOOR_MARGIN;
}

export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export async function check(
  qloo: Qloo,
  profile: Profile,
  slot: Slot,
  request: { entityId?: string; name?: string },
): Promise<Decision> {
  const base = { slot: slot.name, entityId: request.entityId, name: request.name };
  if (request.entityId && request.entityId === slot.picked.id) {
    return { ...base, verdict: "allow", name: slot.picked.name, affinity: slot.picked.affinity, reasons: ["This is the place you picked."] };
  }
  if (!request.entityId) {
    return { ...base, verdict: "ask", reasons: ["The agent named a place the guard cannot identify. You decide."] };
  }

  let scored;
  try {
    scored = (await qloo.score(profile.liked, [request.entityId], "urn:entity:place")).get(request.entityId);
  } catch {
    return { ...base, verdict: "ask", reasons: ["Qloo could not be reached to check this swap. You decide."] };
  }
  if (!scored || typeof scored.affinity !== "number") {
    return { ...base, verdict: "ask", reasons: ["Qloo does not know this place. You decide."] };
  }

  const floor = floorFor(slot.pool);
  const reasons: string[] = [];
  let verdict: Verdict = "allow";
  const name = scored.name ?? request.name;

  if (floor === undefined) {
    return { ...base, name, affinity: scored.affinity, verdict: "ask", reasons: ["No taste range for this slot. You decide."] };
  }
  if (scored.affinity < floor) {
    verdict = "block";
    reasons.push(
      `Only ${score(scored.affinity)}/100 you. Your twin books ${slot.name} from ${score(floor)} up.`,
    );
  }
  let distanceM: number | undefined;
  if (typeof scored.lat === "number" && typeof scored.lon === "number") {
    distanceM = metres(slot.anchor, { lat: scored.lat, lon: scored.lon });
    if (distanceM > MAX_DISTANCE_M) {
      verdict = "block";
      reasons.push(`It is ${(distanceM / 1000).toFixed(1)} km from the rest of your night.`);
    }
  }
  if (verdict === "allow") {
    reasons.push(`A change of place, but still ${score(scored.affinity)}/100 you, and close by.`);
  }
  return { ...base, name, affinity: scored.affinity, floor, distanceM, verdict, reasons };
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Affinity as a score out of 100, as the page shows it ("71/100 you"). */
export function score(x: number): string {
  return String(Math.round(x * 100));
}
