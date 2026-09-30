# Cold Leads MCP server

Model Context Protocol server for [Cold Leads](https://coldleads.app), the B2B outreach CRM. It lets AI agents (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code and any MCP client) verify e-mail addresses with catch-all detection and look up leads in your Cold Leads workspace — and, when there is no API key yet, ask the human owner to approve a subscription.

```bash
npx -y @coldleads/mcp-server
# before the first npm release: npx -y github:anttka4cz/mcp-server-coldleads
```

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `verify_email` | Deep verification of one address: syntax, disposable domain, role account, MX records and a live SMTP mailbox check. Returns `valid`, `risky` or `invalid` plus catch-all detection. Answers within 5 seconds. | 1 credit |
| `search_leads` | Contacts already in your Cold Leads CRM for a company domain, with an optional role keyword: e-mail, name, company, stage, tags, verification status and a `do_not_contact` flag. Cold Leads has no third-party lead database. | free |
| `provision_account_and_get_payment_link` | For agents without a key: creates a pending account for the human owner and returns a Stripe payment link for the Business plan. The human decides and pays. | — |
| `check_provisioning_status` | After the owner paid: returns the API key exactly once (with the `claim_token`). The server starts using it immediately. | — |

Responses are compact JSON in a text block:

```json
{"status":"success","email":"john@example.com","validity":"valid","catch_all":false,"score":97,"reasons":["ok"],"disposable":false,"role_account":false}
```

Errors come back as tool results with `isError: true`, for example `{"status":"error","error":"rate_limited","message":"…","http_status":429,"retry_after_seconds":60}`.

## Requirements

- A Cold Leads **secret API key** (`sk_…`) from **Settings → API keys**. The API is included in the **Business** plan (10,000 verification and API credits a month; extra packs available).
- Node.js 18.17 or newer.
- No key yet? Start the server without one and let your agent call `provision_account_and_get_payment_link` — see [Agent onboarding](#agent-onboarding-without-a-key).

## Setup

### Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "coldleads": {
      "command": "npx",
      "args": ["-y", "@coldleads/mcp-server"],
      "env": { "COLDLEADS_API_KEY": "sk_your_secret_key" }
    }
  }
}
```

### Cursor / Windsurf

`~/.cursor/mcp.json` (Cursor) or `~/.codeium/windsurf/mcp_config.json` (Windsurf) — the same `mcpServers` block as above.

### Claude Code

```bash
claude mcp add coldleads --env COLDLEADS_API_KEY=sk_your_secret_key -- npx -y @coldleads/mcp-server
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "coldleads": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@coldleads/mcp-server"],
      "env": { "COLDLEADS_API_KEY": "sk_your_secret_key" }
    }
  }
}
```

### Hosted endpoint (no install)

Clients that support remote servers with custom headers can connect directly:

```json
{
  "mcpServers": {
    "coldleads": {
      "url": "https://coldleads.app/api/mcp",
      "headers": { "Authorization": "Bearer sk_your_secret_key" }
    }
  }
}
```

The endpoint speaks MCP Streamable HTTP (JSON-RPC 2.0 over POST, protocol versions 2024-11-05 to 2025-11-25) and rejects requests without a key with HTTP 401. Clients that only support OAuth for remote servers (for example claude.ai web connectors) should use the local `npx` server instead.

### Docker

```bash
docker build -t coldleads-mcp-server .
docker run -i --rm -e COLDLEADS_API_KEY=sk_your_secret_key coldleads-mcp-server
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `COLDLEADS_API_KEY` | — | Secret API key (`sk_…`). Optional at start-up: without it the server still starts, lists tools and can run agent onboarding. |
| `COLDLEADS_API_BASE` | `https://coldleads.app` | API base URL (for local development against a Cold Leads dev server). |

## Agent onboarding without a key

1. The agent calls `provision_account_and_get_payment_link` with the owner's e-mail.
2. It shows the returned `checkout_url` to the human. The human reviews the plan and price on the secure Stripe page and decides whether to pay. The agent never pays.
3. The agent polls `check_provisioning_status` with `session_id` and `claim_token` every 15–30 seconds.
4. After payment the first call returns `api_key` once; this server switches to it immediately. Store it as `COLDLEADS_API_KEY` for the next start.
5. The owner receives an e-mail to open the Cold Leads web app, where they can manage the subscription or rotate the key.

Only the agent holding the `claim_token` can collect the key; looking up a status by e-mail never returns it.

## Responsible use

- A verified address is not consent. You need a lawful basis to contact each person.
- Never e-mail leads with `do_not_contact: true` (opted out, bounced or on the do-not-contact list).
- Limits: 120 requests per minute per key; each verification costs 1 credit.

## Development

```bash
npm ci
npm run build
npm test                      # schema, server and stdio child-process tests
COLDLEADS_API_KEY_FILE=path/to/key COLDLEADS_API_BASE=http://localhost:3000 node scripts/smoke.mjs   # live checks
```

## License

[MIT](LICENSE) © 2026 Anton Tkachenko
