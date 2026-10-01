// Thin client for the Cold Leads REST API v1 (https://coldleads.app/api/v1). No business logic here: limits,
// credits, verification and search all run on the server.
export type ApiOk = { ok: true; status: number; data: Record<string, unknown> };
export type ApiFail = { ok: false; status: number; error: string; hint?: string; data?: Record<string, unknown> };
export type ApiResult = ApiOk | ApiFail;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_BASE = "https://coldleads.app";
export const VERIFY_SERVER_BUDGET_MS = 4000;
export const VERIFY_CLIENT_TIMEOUT_MS = 4900;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const USER_AGENT = "coldleads-mcp-server/1.0.0";

export class ColdLeadsClient {
  private key: string;
  private hostedNames: Set<string> | null = null;

  constructor(
    apiKey: string,
    readonly baseUrl: string = DEFAULT_BASE,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
  ) {
    this.key = apiKey.trim();
  }

  get apiKey(): string {
    return this.key;
  }

  hasKey(): boolean {
    return this.key.length > 0;
  }

  // the key issued after the owner paid is used for the rest of this session (the agent should also persist it)
  setKey(apiKey: string): void {
    this.key = apiKey.trim();
  }

  async request(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS, auth = true, extraHeaders: Record<string, string> = {}): Promise<ApiResult> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${path}`;
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT, ...extraHeaders };
    if (auth) headers.Authorization = `Bearer ${this.key}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") return { ok: false, status: 0, error: "timeout", hint: `no answer from Cold Leads within ${timeoutMs} ms` };
      return { ok: false, status: 0, error: "network_error", hint: e instanceof Error ? e.message : String(e) };
    }
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    if (res.ok) return { ok: true, status: res.status, data };
    return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : `http_${res.status}`, hint: typeof data.hint === "string" ? data.hint : undefined, data };
  }

  verifyEmail(email: string): Promise<ApiResult> {
    return this.request("POST", "/api/v1/verify", { email, timeout_ms: VERIFY_SERVER_BUDGET_MS }, VERIFY_CLIENT_TIMEOUT_MS);
  }

  searchLeads(domain: string, role: string | undefined, limit: number): Promise<ApiResult> {
    const q = new URLSearchParams({ domain, limit: String(limit) });
    if (role) q.set("role", role);
    return this.request("GET", `/api/v1/leads?${q.toString()}`);
  }

  // agent onboarding without a key (no Authorization header)
  provision(ownerEmail: string, agentId: string, callbackUrl?: string): Promise<ApiResult> {
    return this.request("POST", "/api/agent/provision", { owner_email: ownerEmail, agent_id: agentId, ...(callbackUrl ? { callback_url: callbackUrl } : {}) }, DEFAULT_TIMEOUT_MS, false);
  }

  provisioningStatus(sessionId: string, claimToken: string): Promise<ApiResult> {
    return this.request("GET", `/api/agent/status?session_id=${encodeURIComponent(sessionId)}`, undefined, DEFAULT_TIMEOUT_MS, false, { "X-Claim-Token": claimToken });
  }

  async hostedTools(): Promise<Record<string, unknown>[]> {
    const r = await this.request("POST", "/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, DEFAULT_TIMEOUT_MS, this.hasKey());
    if (!r.ok) { this.hostedNames = new Set(); return []; }
    const result = r.data.result as { tools?: Record<string, unknown>[] } | undefined;
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    this.hostedNames = new Set(tools.map((t) => String(t.name ?? "")));
    return tools;
  }

  async callHostedTool(name: string, args: unknown): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.hasKey()) return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: "missing_api_key", message: "Set COLDLEADS_API_KEY to a secret key (sk_…) to use workspace tools." }) }], isError: true };
    if (!this.hostedNames && !(await this.hostedTools()).length) return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: "unknown_tool", message: `Unknown Cold Leads tool: ${name}` }) }], isError: true };
    if (!this.hostedNames?.has(name)) return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: "unknown_tool", message: `Unknown Cold Leads tool: ${name}` }) }], isError: true };
    const r = await this.request("POST", "/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, DEFAULT_TIMEOUT_MS);
    if (!r.ok) return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: r.error, message: r.hint ?? r.error, http_status: r.status }) }], isError: true };
    const rpc = r.data.result as { content?: { type: "text"; text: string }[]; isError?: boolean } | undefined;
    if (rpc?.content?.length) return { content: rpc.content, ...(rpc.isError ? { isError: true } : {}) };
    return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: "invalid_mcp_response" }) }], isError: true };
  }
}
