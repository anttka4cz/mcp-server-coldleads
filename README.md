# Cold Leads MCP server

Model Context Protocol server for [Cold Leads](https://coldleads.app), the B2B outreach CRM. It exposes the hosted workspace tools to local MCP clients (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code): contacts, imports, synced conversations, templates, campaigns, website capture, lead search, and verification. Without an API key, it can also ask the human owner to approve a subscription.

```bash
npx -y --allow-git=root github:anttka4cz/mcp-server-coldleads
```

The package is not on npm; npx installs and builds it straight from GitHub. npm 12 blocks installs from git unless you allow them, which `--allow-git=root` does for this command; npm 10 accepts the flag too.

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `verify_email` | Verification of one address: syntax, disposable domain, role account and MX records, plus an SMTP mailbox and catch-all check when Cold Leads can open an SMTP connection to the recipient's mail server (otherwise `reasons` contains `smtp_unreachable` and `catch_all` is `null`). Returns `valid`, `risky` or `invalid`. Answers within 5 seconds. | 1 credit |
| `search_leads` | Contacts already in your Cold Leads CRM for a company domain, with an optional role keyword: e-mail, name, company, stage, tags, verification status and a `do_not_contact` flag. Cold Leads has no third-party lead database. | free |
| `list_contacts`, `import_contacts`, `update_contact` | List, import up to 100 parsed contact rows per call, and update contacts in your own workspace. Imports deduplicate, skip global DNC entries and do not send e-mail. CSV/XLSX parsing is done by the assistant. | free |
| `get_conversation`, `send_contact_message` | Read mailbox-synced contact conversations or send one e-mail after explicit approval of recipient and content. Opt-outs, bounces and DNC are blocked. | sender/provider limits |
| `list_templates`, `save_template` | Review, create and update workspace templates; content screening applies. | free |
| `list_campaigns`, `create_campaign_draft`, `launch_campaign` | Inspect campaigns, prepare drafts and audience estimates, and launch only after human review and explicit confirmation. | plan and recipient limits |
| `get_workspace_info`, `setup_website_lead_capture` | Read non-secret workspace/mailbox status or generate a public-only form key/snippet for your website. Website submissions are inquiry leads, not automatic cold-outreach consent. | free |
| `provision_account_and_get_payment_link` | For agents without a key: creates a pending account for the human owner and returns a Stripe payment link for the Business plan. The human decides and pays. | — |
| `check_provisioning_status` | After the owner paid: returns the API key exactly once (with the `claim_token`). The server starts using it immediately. | — |

Responses are compact JSON in a text block. An illustrative result for an address whose mailbox could not be checked (example.com is reserved for documentation):

```json
{"status":"success","email":"jane.doe@example.com","validity":"valid","catch_all":null,"score":75,"reasons":["smtp_unreachable"],"disposable":false,"role_account":false}
```

Errors come back as tool results with `isError: true`, for example `{"status":"error","error":"rate_limited","message":"…","http_status":429,"retry_after_seconds":60}`.

## Requirements

- A Cold Leads **secret API key** (`sk_…`) from **Settings → API keys**. The API is included in the **Business** plan (10,000 verification and API credits a month; extra packs available).
- Node.js 20 or newer (CI tests 20 and 22).
- No key yet? Start the server without one and let your agent call `provision_account_and_get_payment_link` — see [Agent onboarding](#agent-onboarding-without-a-key).

## Setup

### Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "coldleads": {
      "command": "npx",
      "args": ["-y", "--allow-git=root", "github:anttka4cz/mcp-server-coldleads"],
      "env": { "COLDLEADS_API_KEY": "sk_your_secret_key" }
    }
  }
}
```

### Cursor / Windsurf

`~/.cursor/mcp.json` (Cursor) or `~/.codeium/windsurf/mcp_config.json` (Windsurf) — the same `mcpServers` block as above.

### Claude Code

```bash
claude mcp add coldleads --env COLDLEADS_API_KEY=sk_your_secret_key -- npx -y --allow-git=root github:anttka4cz/mcp-server-coldleads
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "coldleads": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--allow-git=root", "github:anttka4cz/mcp-server-coldleads"],
      "env": { "COLDLEADS_API_KEY": "sk_your_secret_key" }
    }
  }
}
```

### Hosted endpoint (no install)

Clients that support remote servers can connect directly with a secret key:

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

The stdio server discovers workspace tools from `https://coldleads.app/api/mcp` and forwards their calls to the hosted MCP service, so the hosted and local tools use the same account, policy and sending safeguards. It also includes keyless onboarding tools. ChatGPT connects to the hosted endpoint with OAuth 2.1; enable Developer mode in ChatGPT, add the endpoint, sign in to Cold Leads and review the requested access. Other remote MCP clients can use the API-key header shown above.

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
2. It shows the returned `checkout_url` to the human. The human reviews the plan and price on the secure Stripe page and decides whether to pay. The API gives the agent no way to pay, and the agent is told never to open or pay the link.
3. The agent polls `check_provisioning_status` with `session_id` and `claim_token` every 15–30 seconds.
4. After payment the first call returns `api_key` once; this server switches to it immediately. Store it as `COLDLEADS_API_KEY` for the next start.
5. The owner receives an e-mail to open the Cold Leads web app, where they can manage the subscription or rotate the key.

Only a request that carries the `claim_token` can collect the key; a status lookup without it never returns the key.

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
