import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ColdLeadsClient, type ApiFail } from "./api.js";
import { LEADS_DEFAULT, LEADS_MAX, TOOLS } from "./tools.js";

export const SERVER_INFO = { name: "coldleads", title: "Cold Leads", version: "1.0.0" };
const INSTRUCTIONS =
  "Cold Leads tools: search_leads finds contacts already in the user's Cold Leads CRM for a company domain (free); verify_email checks one address live (1 credit, < 5 s). Never e-mail leads with do_not_contact=true. Verification is not consent: the user needs a lawful basis to contact each person.";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (obj: unknown, isError = false): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(obj) }], ...(isError ? { isError: true } : {}) });
const toolError = (error: string, message: string, extra: Record<string, unknown> = {}) => text({ status: "error", error, message, ...extra }, true);

const MESSAGES: Record<string, string> = {
  missing_api_key: "COLDLEADS_API_KEY is not set. Create a secret key (sk_…) in Cold Leads → Settings → API keys (Business plan) and add it to the MCP server environment.",
  bad_api_key: "The Cold Leads API key was rejected. Check COLDLEADS_API_KEY (a secret key starting with sk_).",
  publishable_key_not_allowed: "A publishable key (lk_…) cannot call the API; use a secret key (sk_…).",
  api_not_in_plan: "This Cold Leads plan does not include the API (Business plan required).",
  account_suspended: "The Cold Leads account is suspended; contact support@coldleads.app.",
  no_credits: "No verification credits left this month; the account owner can add credits in Cold Leads settings.",
  rate_limited: "Rate limit reached (120 requests per minute per key). Wait a minute and retry.",
  timeout: "Cold Leads did not answer in time. Retry later.",
  network_error: "Cold Leads could not be reached.",
};

function fromApi(f: ApiFail): ToolResult {
  const extra: Record<string, unknown> = { http_status: f.status };
  if (f.hint) extra.hint = f.hint;
  if (f.error === "rate_limited") extra.retry_after_seconds = 60;
  return toolError(f.error, MESSAGES[f.error] ?? `Cold Leads API error (${f.error}).`, extra);
}

function objectArgs(a: unknown): Record<string, unknown> | null {
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : null;
}
function unknownKeys(a: Record<string, unknown>, allowed: string[]) {
  return Object.keys(a).filter((k) => !allowed.includes(k));
}

export async function callTool(client: ColdLeadsClient, name: string, rawArgs: unknown): Promise<ToolResult | null> {
  if (name !== "verify_email" && name !== "search_leads") return null;
  const args = objectArgs(rawArgs ?? {});
  if (!args) return toolError("invalid_arguments", "arguments must be an object");
  if (name === "verify_email") {
    const extra = unknownKeys(args, ["email"]);
    if (extra.length) return toolError("invalid_arguments", `unknown argument(s): ${extra.join(", ")}`);
    const email = typeof args.email === "string" ? args.email.trim() : "";
    if (email.length < 3 || email.length > 254) return toolError("invalid_arguments", "email is required (3–254 characters)");
    if (!client.hasKey()) return toolError("missing_api_key", MESSAGES.missing_api_key);
    const r = await client.verifyEmail(email);
    if (!r.ok) return fromApi(r);
    const d = r.data;
    const reasons = Array.isArray(d.reasons) ? (d.reasons as string[]) : [];
    return text({
      status: "success",
      email: d.email,
      validity: d.status,
      catch_all: reasons.includes("timeout") ? null : d.catch_all === true,
      score: d.score,
      reasons,
      disposable: d.disposable === true,
      role_account: d.role === true,
    });
  }
  const extra = unknownKeys(args, ["domain", "role", "limit"]);
  if (extra.length) return toolError("invalid_arguments", `unknown argument(s): ${extra.join(", ")}`);
  const domain = typeof args.domain === "string" ? args.domain.trim() : "";
  if (domain.length < 3 || domain.length > 253) return toolError("invalid_arguments", "domain is required, e.g. acme.com");
  if (args.role !== undefined && (typeof args.role !== "string" || args.role.length > 80)) return toolError("invalid_arguments", "role must be a string of up to 80 characters");
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > LEADS_MAX)) {
    return toolError("invalid_arguments", `limit must be an integer between 1 and ${LEADS_MAX}`);
  }
  if (!client.hasKey()) return toolError("missing_api_key", MESSAGES.missing_api_key);
  const r = await client.searchLeads(domain, args.role as string | undefined, (args.limit as number | undefined) ?? LEADS_DEFAULT);
  if (!r.ok) return r.error === "domain_required" ? toolError("invalid_arguments", "domain is not a valid company domain, e.g. acme.com") : fromApi(r);
  return text({ status: "success", domain: r.data.domain, count: r.data.count, source: r.data.source, leads: r.data.leads });
}

export function createServer(client: ColdLeadsClient): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as unknown as { name: string; inputSchema: { type: "object" } }[] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await callTool(client, req.params.name, req.params.arguments);
    if (!result) return toolError("unknown_tool", `Unknown tool: ${req.params.name}`);
    return result;
  });
  return server;
}
