import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ColdLeadsClient, VERIFY_CLIENT_TIMEOUT_MS, type FetchLike } from "../src/api.js";
import { createServer } from "../src/server.js";

// The MCP server over an in-memory transport with a fake HTTP layer: list, success mappings, every error path.
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function connect(fetchImpl: FetchLike, key = "sk_test") {
  calls = [];
  const spy: FetchLike = (url, init) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
  const server = createServer(new ColdLeadsClient(key, "https://api.test", spy));
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}
const parse = (r: unknown) => {
  const res = r as { content: { type: string; text: string }[]; isError?: boolean };
  return { isError: !!res.isError, type: res.content[0].type, data: JSON.parse(res.content[0].text) as Record<string, unknown> };
};
let open: { client: Client }[] = [];
afterEach(async () => {
  await Promise.all(open.map((o) => o.client.close()));
  open = [];
});
const setup = async (f: FetchLike, key?: string) => {
  const c = await connect(f, key);
  open.push(c);
  return c.client;
};

describe("tools/list", () => {
  it("lists search_leads and verify_email with object input schemas and read-only annotations", async () => {
    const client = await setup(async () => json(200, {}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search_leads", "verify_email"]);
    expect(tools.every((t) => t.inputSchema.type === "object" && t.annotations?.readOnlyHint === true)).toBe(true);
    expect(client.getServerVersion()).toMatchObject({ name: "coldleads", version: "1.0.0" });
  });
});

describe("verify_email", () => {
  it("returns the compact success JSON and sends a 4 s server budget with a Bearer key", async () => {
    const client = await setup(async () => json(200, { email: "john@example.com", status: "valid", score: 97, reasons: ["ok"], mx: "mx", catch_all: false, disposable: false, role: false }));
    const r = parse(await client.callTool({ name: "verify_email", arguments: { email: "john@example.com" } }));
    expect(r).toEqual({ isError: false, type: "text", data: { status: "success", email: "john@example.com", validity: "valid", catch_all: false, score: 97, reasons: ["ok"], disposable: false, role_account: false } });
    expect(calls[0].url).toBe("https://api.test/api/v1/verify");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "john@example.com", timeout_ms: 4000 });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
  });
  it("parses catch-all domains; a server-side timeout reports catch_all=null", async () => {
    let n = 0;
    const client = await setup(async () =>
      n++ === 0
        ? json(200, { email: "x@acme.com", status: "risky", score: 60, reasons: ["catch_all"], catch_all: true, disposable: false, role: false })
        : json(200, { email: "x@slow.com", status: "risky", score: 50, reasons: ["timeout"], catch_all: false, disposable: false, role: false }),
    );
    expect(parse(await client.callTool({ name: "verify_email", arguments: { email: "x@acme.com" } })).data).toMatchObject({ validity: "risky", catch_all: true });
    expect(parse(await client.callTool({ name: "verify_email", arguments: { email: "x@slow.com" } })).data).toMatchObject({ validity: "risky", catch_all: null });
  });
  it("a hanging API is abandoned before 5 s with a timeout error (Stage 2.4)", async () => {
    const client = await setup((_u, init) => new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(init.signal?.reason ?? new DOMException("aborted", "TimeoutError")))));
    const t = Date.now();
    const r = parse(await client.callTool({ name: "verify_email", arguments: { email: "x@hang.com" } }));
    const ms = Date.now() - t;
    expect(ms).toBeLessThan(5000);
    expect(ms).toBeGreaterThanOrEqual(VERIFY_CLIENT_TIMEOUT_MS - 50);
    expect(r).toMatchObject({ isError: true, data: { status: "error", error: "timeout" } });
  }, 10_000);
  it.each([
    [401, { error: "bad_api_key" }, "bad_api_key"],
    [401, { error: "missing_api_key" }, "missing_api_key"],
    [402, { error: "no_credits" }, "no_credits"],
    [403, { error: "api_not_in_plan", hint: "Business plan includes the API" }, "api_not_in_plan"],
    [429, { error: "rate_limited", limit_per_minute: 120 }, "rate_limited"],
    [500, {}, "http_500"],
  ])("HTTP %i is returned gracefully as an isError result (%s)", async (status, body, code) => {
    const client = await setup(async () => json(status, body));
    const r = parse(await client.callTool({ name: "verify_email", arguments: { email: "a@b.cz" } }));
    expect(r.isError).toBe(true);
    expect(r.data).toMatchObject({ status: "error", error: code, http_status: status });
    expect(typeof r.data.message).toBe("string");
    if (status === 429) expect(r.data.retry_after_seconds).toBe(60);
  });
  it("a network failure is an isError result, not a crash", async () => {
    const client = await setup(async () => {
      throw new TypeError("fetch failed");
    });
    expect(parse(await client.callTool({ name: "verify_email", arguments: { email: "a@b.cz" } })).data).toMatchObject({ error: "network_error" });
  });
  it("without a key: explains how to set COLDLEADS_API_KEY and makes no request", async () => {
    const client = await setup(async () => json(200, {}), "");
    const r = parse(await client.callTool({ name: "verify_email", arguments: { email: "a@b.cz" } }));
    expect(r).toMatchObject({ isError: true, data: { error: "missing_api_key" } });
    expect(String(r.data.message)).toContain("COLDLEADS_API_KEY");
    expect(calls).toHaveLength(0);
  });
});

describe("search_leads", () => {
  it("queries /api/v1/leads with domain, role and limit and returns the compact result", async () => {
    const client = await setup(async () => json(200, { domain: "acme.com", count: 1, source: "crm", leads: [{ email: "anna@acme.com", stage: "lead", do_not_contact: false }] }));
    const r = parse(await client.callTool({ name: "search_leads", arguments: { domain: "acme.com", role: "sales", limit: 5 } }));
    expect(r.data).toEqual({ status: "success", domain: "acme.com", count: 1, source: "crm", leads: [{ email: "anna@acme.com", stage: "lead", do_not_contact: false }] });
    expect(calls[0].url).toBe("https://api.test/api/v1/leads?domain=acme.com&limit=5&role=sales");
    expect(calls[0].init.method).toBe("GET");
  });
  it("defaults the limit to 10; invalid arguments never reach the API", async () => {
    const client = await setup(async () => json(200, { domain: "acme.com", count: 0, source: "crm", leads: [] }));
    await client.callTool({ name: "search_leads", arguments: { domain: "acme.com" } });
    expect(calls[0].url).toContain("limit=10");
    calls = [];
    for (const args of [{}, { domain: "ab" }, { domain: "acme.com", limit: 0 }, { domain: "acme.com", limit: 99 }, { domain: "acme.com", role: 5 }, { domain: "acme.com", foo: 1 }]) {
      expect(parse(await client.callTool({ name: "search_leads", arguments: args as Record<string, unknown> })).isError).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });
  it("an API domain_required answer becomes invalid_arguments", async () => {
    const client = await setup(async () => json(400, { error: "domain_required" }));
    expect(parse(await client.callTool({ name: "search_leads", arguments: { domain: "not.valid-" } })).data).toMatchObject({ error: "invalid_arguments" });
  });
  it("an unknown tool is an isError result", async () => {
    const client = await setup(async () => json(200, {}));
    expect(parse(await client.callTool({ name: "nope", arguments: {} })).data).toMatchObject({ error: "unknown_tool" });
  });
});
