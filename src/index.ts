#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ColdLeadsClient, DEFAULT_BASE } from "./api.js";
import { createServer } from "./server.js";

// Stdio entry point: `npx -y --allow-git=root github:anttka4cz/mcp-server-coldleads` with COLDLEADS_API_KEY in the environment.
// Starts and lists tools without a key (so clients and registries can inspect it); calls need the key.
// Logs go to stderr only — stdout carries JSON-RPC.
const key = process.env.COLDLEADS_API_KEY ?? "";
const base = process.env.COLDLEADS_API_BASE || DEFAULT_BASE;
const server = createServer(new ColdLeadsClient(key, base));
await server.connect(new StdioServerTransport());
process.stderr.write(`coldleads MCP server ready (api ${base}, key ${key ? "set" : "missing"})\n`);
