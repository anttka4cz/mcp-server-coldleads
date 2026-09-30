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
  {
    name: "provision_account_and_get_payment_link",
    title: "Set up Cold Leads for the human owner",
    description:
      "Use only when no working Cold Leads API key is available (other Cold Leads tools return missing_api_key or bad_api_key) and the human wants to use Cold Leads. Creates a pending Cold Leads account for the human owner's e-mail and returns a Stripe payment link for the Business plan with API access (price in plan.price, billed monthly until cancelled). Show checkout_url to the human and let them decide; never open, pay or share the link yourself. Keep claim_token secret, then call check_provisioning_status until status is active to receive the API key once.",
    inputSchema: {
      type: "object",
      properties: {
        owner_email: { type: "string", minLength: 3, maxLength: 254, description: "E-mail address of the human who will own and pay for the Cold Leads account." },
        agent_id: { type: "string", minLength: 1, maxLength: 100, description: "Name of your agent or product; shown to the human on the payment page." },
        callback_url: { type: "string", maxLength: 500, pattern: "^https://", description: "Optional https URL that receives a signed POST when the owner has paid (no secrets in the payload)." },
      },
      required: ["owner_email"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "check_provisioning_status",
    title: "Check the owner's payment and get the API key",
    description:
      "Checks an account created with provision_account_and_get_payment_link. Returns status pending_payment, active, expired or suspended. When active, the first call with the claim_token returns api_key exactly once: store it securely as COLDLEADS_API_KEY and send it as Authorization: Bearer <key>. Poll every 15–30 seconds while pending_payment.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", minLength: 3, maxLength: 200, description: "session_id returned by provision_account_and_get_payment_link." },
        claim_token: { type: "string", minLength: 10, maxLength: 200, description: "claim_token returned by provision_account_and_get_payment_link." },
      },
      required: ["session_id", "claim_token"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
] as const;
