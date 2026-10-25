# Ender's Bench site

Hosts the Ender's Bench viewer on Apify and lets visitors start benchmark runs from it. The viewer includes the Observation Studio, the forest Clearing and Ledger Street.

One run of this Actor serves the site from its container URL, `https://<run>.runs.apify.net`. That address needs no token. It stays the same for as long as the run lasts, so start the run with a long timeout and share that link.

## What visitors can do

- Land on the dashboard (`/` opens `/?studio=landing`) and move between the views from there. The live Clearing watches the shared world on SpacetimeDB Maincloud.
- Press **Start a benchmark**, build a lineup of up to four agents and pick a scenario. The site answers the setup page in place of the local benchmark runner:
  - **The Clearing** resets the shared world on Maincloud with that lineup (`begin_run`). The database's think procedure asks the models itself, and every visitor watches the same live world. The site pauses the world when the rescue resolves, every model survivor has died, every model keeps failing, or **Longest Clearing run** passes.
  - **Ledger Street** runs one model through the seven-case quick tour as an `enders-bench` run.
- Press **Run on Apify** in Ledger Street, pick an agent, a policy and a case set, and start a run of the `enders-bench` Actor. The offices fill in as cases finish.
- Open recent runs, including ones started from the Console or the API.

## Keeping it safe to share

- With a **Run password** set, starting a run (Start a benchmark, Run on Apify) asks for it; anyone can still browse, replay and watch live runs. The site compares it in constant time and locks an address out after ten wrong guesses in an hour. `npm run actors:site` reads it from `RUN_PASSWORD`.
- Visitors choose only from the **Models on offer** you list. By default that's the policy script, which calls no model. Entries with a `lobby` name are the setup page's models.
- API keys, the custom endpoint, the CRS login and the SpacetimeDB token are stored encrypted in this Actor's input. They're passed to each benchmark run as encrypted secret input, or used only by this run, and never sent to the browser. A Clearing run's models are asked with the keys loaded into the database (`scripts/load-model-keys.sh`).
- The site starts one `enders-bench` run at a time and at most **Runs per hour**; one Clearing run at a time and at most **Clearing runs per hour**. It never resets the world while it's running.
- The site starts runs with the API token Apify gives this run, so no token appears in the page.
- On start, the site claims the shared world's harness slot (`claim_harness` trusts the first caller on a fresh world), so a stranger can't take it.

## Set it up

1. Push the `enders-bench` Actor, then this one, with `apify push`.
2. In this Actor's Settings, set **Actor permissions** to **Full permissions**, so its run token can start and read `enders-bench` runs.
3. `npm run actors:site` in `world/` starts it with the models in `models.json` and the keys from `.env` (see `../README.md`). Or, in this Actor's input, list the models to offer and add their keys. Example:

   ```json
   [
     { "id": "script", "label": "Policy reference script (no model)", "provider": "script" },
     { "id": "haiku", "label": "Claude Haiku 5.5", "provider": "anthropic", "model": "claude-haiku-5-5" },
     { "id": "deepseek", "label": "DeepSeek-V4.1-Flash (Bitdeer)", "provider": "bitdeer", "model": "deepseek-ai/DeepSeek-V4.1-Flash" },
     { "id": "ft", "label": "Fine-tuned Qwen3.8-27B", "provider": "custom", "model": "<served model name>" }
   ]
   ```

4. Start it with a timeout that covers the event, for example 172800 seconds (two days), and 256 MB of memory.
5. Open the run's **Live View**, or its container URL, and share that.

If the run stops, start it again; the new run has a new address.
