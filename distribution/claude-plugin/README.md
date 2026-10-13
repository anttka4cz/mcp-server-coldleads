# Cold Leads plugin for Claude Code

Connects Claude Code to [Cold Leads](https://coldleads.app), the B2B outreach CRM, through its hosted MCP server
(`https://coldleads.app/api/mcp`, OAuth sign-in, no API key to copy), and adds a skill with safe working rules.

## Install

```
/plugin marketplace add anttka4cz/mcp-server-coldleads
/plugin install coldleads@coldleads
```

Then run `/mcp`, choose `coldleads` and sign in to Cold Leads. Tool access requires a Cold Leads account on the
Business plan (a free trial is available).

## What you can ask

- "Who replied and needs an answer from me today?"
- "Import these contacts and verify their e-mail addresses."
- "Draft a follow-up campaign for leads tagged q4, but don't send it."
- "Remind me to follow up with Anna in two days."

Nothing is sent without your explicit approval. Opted-out, bounced and do-not-contact contacts are never e-mailed.

Privacy: https://coldleads.app/privacy · Terms: https://coldleads.app/terms · Support: support@coldleads.app
