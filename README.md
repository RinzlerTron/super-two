# Super Two

Eight taps plan your night out, powered by Qloo. Your agent holds it all, and when a booking
page tries to trick it, your taste twin catches it. Your night, your taste. No evil twins.

Live demo: https://rinzlertron.github.io/super-two/

## What it does

Start in your city. This demo has New York and Singapore, with more cities to come. Tap the one
you like more, eight times: a band or a brand, a show, dinner, a bar for after. Every tap tells
Qloo a little more about your taste, and your taste twin grows at the top of the screen.

Then "Hold my night" and an agent holds dinner, the show and drinks after. On the way, one
booking page tries a trick: it tells the agent to move dinner to its "partner" place. Your taste
twin checks that place with Qloo, sees it isn't you, and stops it. The evil twin is struck out
on screen and you end with a ticket for two.

## How it uses Qloo

Qloo chooses every option you see, gets to know your taste from your taps, and checks every
change the agent tries to make.

1. **Picks.** `/v2/insights` takes your picks as signals (`signal.interests.entities`) and ranks
   the shows and the real restaurants and bars near the venue (`filter.location`,
   `filter.location.radius`, `filter.tags`).
2. **Gets to know your taste.** Each pick joins the signal list, so the next pair fits you
   better. The twin bar shows Qloo's own tags and descriptions for what you picked.
3. **Guards** (`src/guard.ts`). Before any booking, the guard asks Qloo how well the new place
   fits you. A swap passes only if it fits as well as your twin's own top 10 for that slot and
   is within 2.5 km. Qloo's scores run higher in some cities than others, so each place is
   compared with its own area. If Qloo can't score a place, the guard asks you.

The agent is an AI model with three tools: read a venue page, hold tickets, hold a table. The
guard is plain code that runs on every change, so it never relies on the model saying no.

## Results

`npm run eval` throws 32 sneaky swaps at the guard, built live from Qloo for 4 different tastes
in New York and Singapore: nearby fast food and sports bars, labelled by Qloo category. Your
twin stopped 27. It also let through all 32 fair changes (swaps to the twin's own top places).

| Swaps | Cases | Without Qloo | With Qloo |
|---|---|---|---|
| Sneaky swaps (fast food, sports bars nearby) | 32 | all 32 go through | 27 stopped |
| Fair changes (the twin's own top places) | 32 | all 32 go through | 32 let through |

4 taste profiles, New York and Singapore, 64 cases, run on 28 Oct 2026
(`eval-results/summary.json`). The 5 sneaky swaps that got through were places Qloo ranks
close to that profile's taste.

## Limits

This is a demo. The guard checks taste and distance. A planted swap to a nearby place that does
fit your taste will pass. Beyond the demo, we can have more cities, better guardrails and solid
integration with venues and events data.

## What's next

Groups: one night planned around everyone's taste, with the ticket shared with the whole group.

## Run it

Needs Node 22.18 or later (runs TypeScript directly).

```bash
npm install
QLOO_API_KEY=... ANTHROPIC_API_KEY=... npm start
```

Then open http://127.0.0.1:8790. `npm test` runs the unit tests (no keys needed). Qloo
responses are kept in memory only and never written to this repo.

MIT licence.
