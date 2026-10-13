# Changelog

## 1.0.1 (2026-10-13)

- `serverInfo.version` and the `User-Agent` header now report the real package version from one constant; a test keeps it equal to `package.json`.
- Without `COLDLEADS_API_KEY`, the `missing_api_key` error and the server instructions point to the no-key demo server `https://coldleads.app/api/mcp/demo` (sample data, never sends e-mail).
- Published from GitHub Actions with npm trusted publishing (signed provenance, no stored npm token).

## 1.0.0 (2026-10-13)

- First npm release: stdio proxy for the hosted Cold Leads MCP tools (contacts, imports, verification, templates, campaign drafts and launch with approval, conversations, lead context, next actions, follow-ups, activity log, website capture) plus keyless agent onboarding.
