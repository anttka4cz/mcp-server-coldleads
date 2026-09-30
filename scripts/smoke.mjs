#!/usr/bin/env node
// Live smoke test for the hosted endpoint (Streamable HTTP) and the stdio binary against a real Cold Leads API.
//   COLDLEADS_API_KEY_FILE=… (or COLDLEADS_API_KEY) COLDLEADS_API_BASE=https://coldleads.app node scripts/smoke.mjs
// Options: SMOKE_DOMAIN (a domain with contacts in the account), SMOKE_EMAILS (comma-separated addresses to verify),
// SMOKE_RATE_LIMIT=1 to also burst 125 requests and expect HTTP 429 (locks the key for about a minute).
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOLS } from "../dist/tools.js";

const base = (process.env.COLDLEADS_API_BASE || "https://coldleads.app").replace(/\/+$/, "");
const mcpUrl = `${base}/api/mcp`;
const key = (process.env.COLDLEADS_API_KEY_FILE ? readFileSync(process.env.COLDLEADS_API_KEY_FILE, "utf8") : process.env.COLDLEADS_API_KEY ?? "").trim();
const domain = process.env.SMOKE_DOMAIN || "acme-mcp.test";
const emails = (process.env.SMOKE_EMAILS || "someone@gmail.com,nobody@no-mx-domain-coldleads.invalid,info@example.com").split(",");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const post = (body, headers = {}) => fetch(mcpUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
const parse = (r) => JSON.parse(r.content[0].text);
if (!key) {
  console.error("set COLDLEADS_API_KEY or COLDLEADS_API_KEY_FILE");
  process.exit(2);
}

// ---- 2.3 transport security ----
{
  const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
  const j = await r.json().catch(() => ({}));
  check("HTTP: no Authorization header → 401", r.status === 401 && /^Bearer /.test(r.headers.get("www-authenticate") ?? "") && j?.error?.code === -32001, `status ${r.status}, error ${j?.error?.message}`);
  const bad = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer sk_${"0".repeat(48)}` });
  check("HTTP: wrong key → 401", bad.status === 401, `status ${bad.status}`);
  const get = await fetch(mcpUrl, { headers: { accept: "text/event-stream", authorization: `Bearer ${key}` } });
  check("HTTP: GET (server stream) → 405", get.status === 405, `status ${get.status}`);
}

// ---- 2.3 handshake + discovery with the official SDK client ----
const ajv = new Ajv({ strict: true });
{
  const client = new Client({ name: "smoke-http", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${key}` } } });
  await client.connect(transport);
  check("HTTP: initialize handshake", client.getServerVersion()?.name === "coldleads", `server ${JSON.stringify(client.getServerVersion())}, protocol ${transport.protocolVersion ?? "?"}`);
  const { tools } = await client.listTools();
  check("HTTP: tools/list returns the four tools", JSON.stringify(tools.map((t) => t.name)) === JSON.stringify(TOOLS.map((t) => t.name)));
  const same = tools.every((t) => JSON.stringify(t.inputSchema) === JSON.stringify(TOOLS.find((x) => x.name === t.name)?.inputSchema));
  check("HTTP vs stdio: identical input schemas", same);
  check("HTTP: schemas valid JSON Schema draft-07", tools.every((t) => ajv.validateSchema({ $schema: "http://json-schema.org/draft-07/schema#", ...t.inputSchema })));
  const s = parse(await client.callTool({ name: "search_leads", arguments: { domain } }));
  check(`HTTP: search_leads(${domain})`, s.status === "success", `count ${s.count}`);
  const sr = parse(await client.callTool({ name: "search_leads", arguments: { domain, role: "ceo", limit: 5 } }));
  check(`HTTP: search_leads(${domain}, role=ceo)`, sr.status === "success", `count ${sr.count}`);
  for (const email of emails) {
    const t = Date.now();
    const r = await client.callTool({ name: "verify_email", arguments: { email } });
    const ms = Date.now() - t;
    const d = parse(r);
    check(`HTTP: verify_email(${email}) < 5000 ms`, ms < 5000 && (d.status === "success" || d.error === "no_credits"), `${ms} ms, validity ${d.validity}, catch_all ${d.catch_all}, reasons ${JSON.stringify(d.reasons)}${d.error ? `, error ${d.error}` : ""}`);
  }
  await client.close();
}

// ---- 2.2 stdio binary against the same API ----
{
  const spawn = async (k) => {
    const c = new Client({ name: "smoke-stdio", version: "1.0.0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { PATH: process.env.PATH ?? "", COLDLEADS_API_KEY: k, COLDLEADS_API_BASE: base }, stderr: "pipe" }));
    return c;
  };
  const c = await spawn(key);
  const { tools } = await c.listTools();
  check("stdio: tools/list", tools.length === TOOLS.length);
  const s = parse(await c.callTool({ name: "search_leads", arguments: { domain } }));
  check(`stdio: search_leads(${domain})`, s.status === "success", `count ${s.count}`);
  const t = Date.now();
  const v = parse(await c.callTool({ name: "verify_email", arguments: { email: emails[0] } }));
  check(`stdio: verify_email(${emails[0]}) < 5000 ms`, Date.now() - t < 5000 && v.status === "success", `${Date.now() - t} ms, validity ${v.validity}, catch_all ${v.catch_all}`);
  await c.close();
  const d = await spawn(`sk_${"0".repeat(48)}`);
  const e = await d.callTool({ name: "verify_email", arguments: { email: emails[0] } });
  check("stdio: dummy key → isError bad_api_key (401)", e.isError === true && parse(e).error === "bad_api_key" && parse(e).http_status === 401);
  await d.close();
}

// ---- agent onboarding validation (no key, no side effects: invalid input is refused before anything is created) ----
{
  const r = await fetch(`${base}/api/agent/provision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner_email: "not-an-email", agent_id: "smoke" }) });
  const j = await r.json().catch(() => ({}));
  check("HTTP: provision with an invalid owner e-mail → 400", r.status === 400 && j.error === "invalid_owner_email", `status ${r.status}, error ${j.error}`);
  const s = await fetch(`${base}/api/agent/status?session_id=cs_does_not_exist`);
  check("HTTP: status for an unknown session → 404", s.status === 404, `status ${s.status}`);
}

// ---- 2.2 rate limit (optional; locks the key ~1 min) ----
if (process.env.SMOKE_RATE_LIMIT === "1") {
  let limited = 0;
  const statuses = await Promise.all(Array.from({ length: 125 }, (_, i) => post({ jsonrpc: "2.0", id: i, method: "ping" }, { authorization: `Bearer ${key}` }).then((r) => r.status)));
  limited = statuses.filter((s) => s === 429).length;
  const ok = statuses.filter((s) => s === 200).length;
  check("HTTP: 125 requests in a burst → 429 after the 120/min limit", limited > 0 && ok <= 120, `${ok} × 200, ${limited} × 429`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
