// Tool definitions shared by the stdio server. The hosted endpoint https://coldleads.app/api/mcp exposes the same
// names, descriptions and input schemas (JSON Schema draft-07).
export const LEADS_MAX = 50;
export const LEADS_DEFAULT = 10;

export const TOOLS = [
  {
    name: "search_leads",
    title: "Search leads by company domain",
    description:
      "Search the leads already in your Cold Leads CRM for a target company domain: contact e-mail, name, company, phone, stage, tags, verification status and a do_not_contact flag. Covers only contacts in your own workspace (Cold Leads has no third-party lead database). Free, uses no credits.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", minLength: 3, maxLength: 253, description: "Company domain, e.g. acme.com. A URL or an e-mail address is reduced to its domain." },
        role: { type: "string", maxLength: 80, description: "Optional keyword such as sales, ceo or marketing, matched against the contact's name, e-mail local part, tags, notes and type." },
        limit: { type: "integer", minimum: 1, maximum: LEADS_MAX, default: LEADS_DEFAULT, description: `Maximum number of leads to return (1–${LEADS_MAX}, default ${LEADS_DEFAULT}).` },
      },
      required: ["domain"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "verify_email",
    title: "Verify an e-mail address",
    description:
      "Performs deep verification of an e-mail address (syntax, disposable domain, role account, MX records and a live SMTP mailbox check), returning validity status (valid, risky or invalid) and catch-all domain detection. Answers within 5 seconds; costs 1 credit.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", minLength: 3, maxLength: 254, description: "The e-mail address to verify, e.g. anna@acme.com." },
      },
      required: ["email"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
] as const;
