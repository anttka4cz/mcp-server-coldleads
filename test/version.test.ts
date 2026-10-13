import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { SERVER_INFO } from "../src/server.js";
import { USER_AGENT } from "../src/api.js";

// serverInfo and the User-Agent report the published package version.
describe("VERSION", () => {
  it("matches package.json everywhere it is reported", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(SERVER_INFO.version).toBe(pkg.version);
    expect(USER_AGENT).toBe(`coldleads-mcp-server/${pkg.version}`);
  });
});
