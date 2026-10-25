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
2. In `enders-bench-site`'s Settings, set **Actor permissions** to **Full permissions**. New Actors get limited permissions, and with them the site's first API call fails (`403 Insufficient permissions` on `/v2/users/me`): it starts, lists and reads runs of another Actor. Leave `enders-bench` on limited.
3. Start the site from `world/`:

   ```bash
   npm run actors:site -- --check     # what the input will hold, by field name; starts nothing
   npm run actors:site                # starts it for two days at 256 MB and prints its address
   ```

   It builds the input from `.env` (the harness's key names; `--env <path>` for another file) and the models in `site/models.json`, checks it the way the site will, and starts the run through the API, which encrypts the secret fields as the Console form does. It won't start a second site run unless you pass `--replace`: a new run gets a new address. Or fill in the input in the Console (see `site/README.md`) and start it there with a 172800 s timeout and 256 MB. Keys go in the input either way, not in environment variables: on a public Actor those apply to everyone's runs.
4. Publish `enders-bench` from its Publication tab.

Checked on the platform (25 Oct): both images build, the bench Actor's defaults give 25/25 compliant with the Live View, Output tab and named store, and from the site's container URL the Run on Apify menu starts a bench run and follows it into Ledger Street. Apify refuses an input schema field without a `description`; `apify validate-schema` catches that before a push.

## Local runs

```bash
cd actors/enders-bench/bundle/world
CRAWLEE_STORAGE_DIR=../../storage ACTOR_WEB_SERVER_PORT=4321 node main.js
```

Put the input in `../../storage/key_value_stores/default/INPUT.json`. The SDK reads `CRAWLEE_STORAGE_DIR`, not `APIFY_LOCAL_STORAGE_DIR`. The site Actor can't run locally: it needs an Apify token from the platform.
