import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttp, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Stage 2.2: the built binary as a real child process over stdio, against a local mock of the REST API.
// sk_ratelimited → 429, any other key → 401 (dummy key), so only graceful error paths are exercised here;
// the live API is exercised separately against the local Cold Leads dev server.
let http: HttpServer;
let base = "";
beforeAll(async () => {
  if (!existsSync("dist/index.js")) throw new Error("run `npm run build` first");
  http = createHttp((req, res) => {
    const key = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    res.setHeader("content-type", "application/json");
    if (key === "sk_ratelimited") {
      res.statusCode = 429;
      return res.end(JSON.stringify({ error: "rate_limited", limit_per_minute: 120 }));
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "bad_api_key" }));
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const addr = http.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => new Promise<void>((r) => http.close(() => r())));

async function spawn(key: string) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { PATH: process.env.PATH ?? "", COLDLEADS_API_KEY: key, COLDLEADS_API_BASE: base }, stderr: "pipe" });
  const client = new Client({ name: "stdio-e2e", version: "1.0.0" });
  await client.connect(transport);
  return client;
}
const parse = (r: unknown) => {
  const res = r as { content: { type: string; text: string }[]; isError?: boolean };
  return { isError: !!res.isError, data: JSON.parse(res.content[0].text) as Record<string, unknown> };
};

describe("stdio child process", () => {
  it("initialize handshake and tools/list over stdio", async () => {
    const client = await spawn("sk_dummy");
    expect(client.getServerVersion()).toMatchObject({ name: "coldleads" });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search_leads", "verify_email", "provision_account_and_get_payment_link", "check_provisioning_status"]);
    await client.close();
  });
  it("dummy key → 401 is reported as bad_api_key for both tools", async () => {
    const client = await spawn("sk_dummy");
    for (const [name, args] of [["verify_email", { email: "a@b.cz" }], ["search_leads", { domain: "acme.com" }]] as const) {
      const r = parse(await client.callTool({ name, arguments: args }));
      expect(r).toMatchObject({ isError: true, data: { status: "error", error: "bad_api_key", http_status: 401 } });
    }
    await client.close();
  });
  it("rate limit → 429 is reported as rate_limited with a retry hint", async () => {
    const client = await spawn("sk_ratelimited");
    const r = parse(await client.callTool({ name: "verify_email", arguments: { email: "a@b.cz" } }));
    expect(r).toMatchObject({ isError: true, data: { error: "rate_limited", http_status: 429, retry_after_seconds: 60 } });
    await client.close();
  });
  it("no key at all still starts and lists tools; calls explain the missing key", async () => {
    const client = await spawn("");
    expect((await client.listTools()).tools).toHaveLength(4);
    expect(parse(await client.callTool({ name: "search_leads", arguments: { domain: "acme.com" } })).data).toMatchObject({ error: "missing_api_key" });
    await client.close();
  });
});
