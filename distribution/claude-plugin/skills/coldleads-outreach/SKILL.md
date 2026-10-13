---
name: coldleads-outreach
description: Work a B2B sales pipeline in Cold Leads (contacts, e-mail verification, templates, campaign drafts, replies, follow-ups). Use when the user asks about their leads, who replied, follow-ups, importing or verifying contacts, or preparing or sending outreach in Cold Leads.
---

# Working with Cold Leads

Cold Leads is the user's own outreach CRM. The `coldleads` MCP server signs in with OAuth the first time a tool is used
(run `/mcp` and authenticate if asked).

## Start of a session

1. `get_workspace_info` for the plan, mailbox status and counts.
2. `get_sales_next_actions` when the user asks what to do today: replies waiting for an answer come first, then due follow-ups.

## Rules

- **Never send without explicit approval.** Show the exact recipient, subject and text (or the template and the
  recipient estimate for a campaign) and wait for the user to say yes. Only then call `send_contact_message` with
  `confirm_send: true` or `launch_campaign` with `confirm_launch: true`.
- Cold Leads has no lead database and does not find new people. If asked to find contacts, offer to import or verify a
  list the user already has.
- Never try to contact opted-out, bounced or do-not-contact people; the server refuses them anyway.
- E-mail verification is not consent. The user needs a lawful basis to contact each person.

## Common tasks

- Import: `import_contacts` (duplicates and do-not-contact addresses are skipped; importing never sends e-mail),
  then `verify_email` for addresses the user wants checked. `smtp_unreachable` means the mailbox itself was not checked.
- Before acting on one person: `get_lead_context`, then `get_conversation` for the full thread.
- Campaigns: `save_template`, then `create_campaign_draft` with a tag or stage filter; report the recipient estimate
  and stop there unless the user approves the launch.
- Follow-ups: `schedule_follow_up` with `in_days` or `due_at` and a short note.
- Audit: `get_agent_activity` lists recent calls.

If a result contains `"sandbox": true`, the account is a sandbox: messages are recorded but never delivered.
