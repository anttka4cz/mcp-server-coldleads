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
  it("lists the four tools with object input schemas; lookups are read-only, onboarding is not", async () => {
    const client = await setup(async () => json(200, {}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search_leads", "verify_email", "provision_account_and_get_payment_link", "check_provisioning_status"]);
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(tools.slice(0, 2).every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.slice(2).every((t) => t.annotations?.readOnlyHint === false)).toBe(true);
    expect(client.getServerVersion()).toMatchObject({ name: "coldleads", version: "1.0.0" });
  });

  it("discovers hosted CRM tools and forwards their calls using the secret API key", async () => {
    const data = { status: "success", added: 1, skipped: 0 };
    const client = await setup(async (_url, init) => {
      const rpc = JSON.parse(String(init.body)) as { method: string };
      if (rpc.method === "tools/list") return json(200, { result: { tools: [{ name: "import_contacts", description: "Import contacts", inputSchema: { type: "object", properties: { contacts: { type: "array" } }, required: ["contacts"], additionalProperties: false } }] } });
      return json(200, { result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
    });
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toContain("import_contacts");
    const result = parse(await client.callTool({ name: "import_contacts", arguments: { contacts: [{ email: "a@example.com" }] } }));
    expect(result.data).toEqual(data);
    expect(calls.some((c) => c.url === "https://api.test/api/mcp" && (c.init.headers as Record<string, string>).Authorization === "Bearer sk_test")).toBe(true);
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
  it("a mailbox that could not be checked (smtp_unreachable) reports catch_all=null", async () => {
    const client = await setup(async () => json(200, { email: "jane@firma.cz", status: "valid", score: 75, reasons: ["smtp_unreachable"], mx: "mx", catch_all: false, disposable: false, role: false }));
    expect(parse(await client.callTool({ name: "verify_email", arguments: { email: "jane@firma.cz" } })).data).toMatchObject({ validity: "valid", catch_all: null, reasons: ["smtp_unreachable"] });
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

describe("agent onboarding without a key", () => {
  it("provision_account_and_get_payment_link posts without Authorization and returns the payment payload", async () => {
    const payload = { status: "payment_required", checkout_url: "https://checkout.stripe.com/c/pay/cs_1", session_id: "cs_1", claim_token: "clt_abc", plan: { id: "business" } };
    const client = await setup(async () => json(200, payload), "");
    const r = parse(await client.callTool({ name: "provision_account_and_get_payment_link", arguments: { owner_email: "boss@acme.com", agent_id: "Scout" } }));
    expect(r).toEqual({ isError: false, type: "text", data: payload });
    expect(calls[0].url).toBe("https://api.test/api/agent/provision");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ owner_email: "boss@acme.com", agent_id: "Scout" });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
  it("defaults agent_id to the MCP client name", async () => {
    const client = await setup(async () => json(200, { status: "payment_required" }), "");
    await client.callTool({ name: "provision_account_and_get_payment_link", arguments: { owner_email: "boss@acme.com" } });
    expect(JSON.parse(String(calls[0].init.body)).agent_id).toBe("mcp:test");
  });
  it("maps refusals (409 account_exists, 429) to isError results", async () => {
    let n = 0;
    const client = await setup(async () => (n++ === 0 ? json(409, { error: "account_exists", hint: "ask the owner" }) : json(429, { error: "rate_limited" })), "");
    expect(parse(await client.callTool({ name: "provision_account_and_get_payment_link", arguments: { owner_email: "a@b.cz" } })).data).toMatchObject({ error: "account_exists", http_status: 409 });
    expect(parse(await client.callTool({ name: "provision_account_and_get_payment_link", arguments: { owner_email: "a@b.cz" } })).data).toMatchObject({ error: "rate_limited", http_status: 429 });
  });
  it("check_provisioning_status sends the claim token as a header; an issued key is used at once", async () => {
    let step = 0;
    const client = await setup(async (url) => {
      step++;
      if (url.includes("/api/agent/status")) return json(200, { status: "active", api_key: `sk_${"b".repeat(48)}`, api_key_prefix: "sk_…bbbb", message: "Shown once." });
      return json(200, { email: "x@acme.com", status: "valid", score: 97, reasons: ["ok"], catch_all: false, disposable: false, role: false });
    }, "");
    const r = parse(await client.callTool({ name: "check_provisioning_status", arguments: { session_id: "cs_1", claim_token: "clt_0123456789" } }));
    expect(r.data).toMatchObject({ status: "active", session_key_updated: true });
    expect(calls[0].url).toBe("https://api.test/api/agent/status?session_id=cs_1");
    expect((calls[0].init.headers as Record<string, string>)["X-Claim-Token"]).toBe("clt_0123456789");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    // verify_email now works with the key issued moments ago
    const v = parse(await client.callTool({ name: "verify_email", arguments: { email: "x@acme.com" } }));
    expect(v.isError).toBe(false);
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe(`Bearer sk_${"b".repeat(48)}`);
    expect(step).toBe(2);
  });
  it("pending status does not change the key; bad arguments never reach the API", async () => {
    const client = await setup(async () => json(200, { status: "pending_payment", session_id: "cs_1" }), "");
    expect(parse(await client.callTool({ name: "check_provisioning_status", arguments: { session_id: "cs_1", claim_token: "clt_0123456789" } })).data).toEqual({ status: "pending_payment", session_id: "cs_1" });
    calls = [];
    for (const [name, args] of [
      ["provision_account_and_get_payment_link", {}],
      ["provision_account_and_get_payment_link", { owner_email: "a@b.cz", callback_url: "http://x.test" }],
      ["check_provisioning_status", { session_id: "cs_1" }],
      ["check_provisioning_status", { session_id: "cs_1", claim_token: "short" }],
    ] as const) {
      expect(parse(await client.callTool({ name, arguments: args as Record<string, unknown> })).isError).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });
});

