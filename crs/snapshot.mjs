// Pulls the CRS sandbox responses for the 20 personas once and saves them as fixtures,
// so the lending world can run offline and the bridge can fall back when the API is slow.
//
//   node crs/snapshot.mjs --smoke   one login + P01's TransUnion report (the Friday-night gate)
//   node crs/snapshot.mjs           all 180 persona requests
//
// Only bodies from personas.json are ever sent: a body that doesn't match a persona
// goes to the real vendor, where it can fail or be billed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://api-sandbox.stitchcredit.com/api";
const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { CRS_USERNAME, CRS_PASSWORD } = process.env;
if (!CRS_USERNAME || !CRS_PASSWORD) {
  console.error("Set CRS_USERNAME and CRS_PASSWORD in endersbench/.env (see .env.example).");
  process.exit(1);
}

const { personas } = JSON.parse(readFileSync(join(here, "personas.json"), "utf-8"));
const smoke = process.argv.includes("--smoke");
const fixturesDir = join(here, "fixtures");

let token = null;
let refreshed = false;

async function login() {
  const res = await fetch(`${BASE_URL}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: CRS_USERNAME, password: CRS_PASSWORD }),
  });
  // Repeated failed logins disable the sandbox account, so a failure is never retried
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${await res.text()}\nNot retrying. Fix .env, then run once more.`);
  }
  token = (await res.json()).token;
  if (!token) throw new Error("Login response had no token.");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(req) {
  const path = req.config ? req.path.replace("{config}", req.config) : req.path;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(req.body),
    });
    if (res.status === 429) {
      await sleep(Number(res.headers.get("Retry-After") ?? 2) * 1000);
      continue;
    }
    // A 401 is an expired token or a product the account doesn't have; re-login once per run
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      await login();
      continue;
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { path, status: res.status, requestId: res.headers.get("RequestID"), body };
  }
  return { path, status: 429, requestId: null, body: "still rate limited after 5 tries" };
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Credit reports report failures as HTTP 200, so the outcome comes from the body
function outcome(result) {
  const b = result.body;
  if (result.status !== 200) return `HTTP ${result.status}`;
  if (b?.errorMessages?.length) return `errors: ${b.errorMessages.map((e) => e.creditErrorMessageText).join("; ")}`;
  if (b?.scores) {
    const scores = b.scores.map((s) => `${s.modelName}=${s.scoreValue ?? s.noScoreReasonType}`).join(", ");
    const files = (b.creditFiles ?? []).map((f) => f.creditFileDetail?.creditFileResultStatusType).join(", ");
    return `files: ${files || "none"}; scores: ${scores || "none"}; tradelines: ${b.tradelines?.length ?? 0}`;
  }
  return "ok";
}

const jobs = personas.flatMap((p) => p.requests.map((req) => ({ persona: p, req })));
const selected = smoke
  ? jobs.filter(({ persona, req }) => persona.id === "P01" && req.variant === "TransUnion")
  : jobs;

async function main() {
  await login();
  console.log(`Logged in. Sending ${selected.length} persona request(s).`);

  const index = [];
  for (const { persona, req } of selected) {
    const result = await send(req);
    const file = join(fixturesDir, persona.id, `${req.product}-${slug(req.variant)}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          persona: persona.id,
          product: req.product,
          variant: req.variant,
          method: req.method,
          path: result.path,
          request: req.body,
          expected: req.expected,
          status: result.status,
          requestId: result.requestId,
          response: result.body,
        },
        null,
        2,
      ),
    );
    const summary = outcome(result);
    index.push({ persona: persona.id, product: req.product, variant: req.variant, status: result.status, requestId: result.requestId, summary });
    console.log(`${persona.id} ${req.variant.padEnd(12)} ${summary}`);
    await sleep(250);
  }

  if (!smoke) writeFileSync(join(fixturesDir, "index.json"), JSON.stringify(index, null, 2));
  const failed = index.filter((r) => r.status !== 200);
  console.log(`\nDone: ${index.length - failed.length} ok, ${failed.length} not 200.`);
}

// process.exit() while fetch sockets are closing trips a libuv assertion on Windows, so set exitCode instead
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
