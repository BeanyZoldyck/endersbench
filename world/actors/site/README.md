# Ender's Bench site

Hosts the Ender's Bench viewer on Apify and lets visitors start benchmark runs from it. The viewer includes the Observation Studio, the forest Clearing and Ledger Street.

One run of this Actor serves the site from its container URL, `https://<run>.runs.apify.net`. That address needs no token. It stays the same for as long as the run lasts, so start the run with a long timeout and share that link.

## What visitors can do

- Watch the recorded exhibits and any Ender's Bench run.
- Press **Run on Apify** in Ledger Street, pick an agent, a policy and a case set, and start a run of the `enders-bench` Actor. The offices fill in as cases finish.
- Open recent runs, including ones started from the Console or the API.

## Keeping it safe to share

- Visitors choose only from the **Models on offer** you list. By default that's the policy script, which calls no model.
- API keys, the custom endpoint and the CRS login are stored encrypted in this Actor's input. They're passed to each benchmark run as encrypted secret input and never sent to the browser.
- The site starts one run at a time and at most **Runs per hour** runs.
- The site starts runs with the API token Apify gives this run, so no token appears in the page.

## Set it up

1. Push the `enders-bench` Actor, then this one, with `apify push`.
2. In this Actor's input, list the models to offer and add their keys. Example:

   ```json
   [
     { "id": "script", "label": "Policy reference script (no model)", "provider": "script" },
     { "id": "haiku", "label": "Claude Haiku 5.5", "provider": "anthropic", "model": "claude-haiku-5-5" },
     { "id": "ft", "label": "Fine-tuned Qwen3.8-27B", "provider": "custom", "model": "<served model name>" }
   ]
   ```

3. Start it with a timeout that covers the event, for example 172800 seconds (two days), and 256 MB of memory.
4. Open the run's **Live View**, or its container URL, and share that.

If the run stops, start it again; the new run has a new address.
