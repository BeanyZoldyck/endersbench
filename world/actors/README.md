# Ender's Bench on Apify

Two Actors:

- `enders-bench/`: the benchmark. One run is one benchmark job. It writes a dataset row per case, plus `OUTPUT`, `RUN` and `REPLAY` in its key-value store, and shows Ledger Street in its Live View. This is the one to publish to the Store.
- `site/` (`enders-bench-site`): one long run serves the whole viewer from its container URL and starts `enders-bench` runs for visitors from an allow-list of models.

Both reuse the benchmark code in `harness/finance/` and `spacetimedb/src/finance/` (the loop is in `harness/finance/bench.ts`). Neither talks to SpacetimeDB.

## Deploy

Needs Node 22 or later and the Apify CLI (`npm install -g apify-cli`, then `apify login`).

```bash
cd world
npm install
npm run actors:build           # vite build, then each Actor's bundle/
cd actors/enders-bench && npm install && apify push
cd ../site && npm install && apify push
```

`apify push` uploads `bundle/` (through `.actorignore`) and Apify builds the image from `.actor/Dockerfile`. Rebuild before every push: the bundle doesn't update itself.

Then:

1. Run `enders-bench` from the Console with its defaults. That's the policy script on the 25 held-out cases: no keys and no model calls. Check the Live View, the dataset's two views and the Output tab.
2. In `enders-bench-site`'s input, list the models visitors may run (see `site/README.md`) and add their keys. Keys go in the input, where Apify encrypts them. Not in environment variables: on a public Actor those apply to everyone's runs.
3. Start the site with a long timeout (172800 s covers two days) and 256 MB. Its container URL is the site's address. A new run gets a new address.
4. Publish `enders-bench` from its Publication tab.

## Not yet tested on the platform

- The site's Apify API calls: starting runs, listing them, reading `REPLAY`. They need a real run's token.
- The image build on Apify.
- The Run on Apify menu in a browser (`src/finance-desk/ApifyRun.tsx`).

## Local runs

```bash
cd actors/enders-bench/bundle/world
CRAWLEE_STORAGE_DIR=../../storage ACTOR_WEB_SERVER_PORT=4321 node main.js
```

Put the input in `../../storage/key_value_stores/default/INPUT.json`. The SDK reads `CRAWLEE_STORAGE_DIR`, not `APIFY_LOCAL_STORAGE_DIR`. The site Actor can't run locally: it needs an Apify token from the platform.
