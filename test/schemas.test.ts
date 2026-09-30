import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { TOOLS } from "../src/tools.js";

// Stage 2.1: every tool input schema is valid JSON Schema draft-07 and accepts/rejects the expected arguments.
const ajv = new Ajv({ strict: true, allErrors: true });
const DRAFT7 = "http://json-schema.org/draft-07/schema#";

describe("tool input schemas (JSON Schema draft-07)", () => {
  it("ajv's default meta-schema is draft-07", () => {
    expect(ajv.getSchema(DRAFT7)).toBeTruthy();
  });
  for (const tool of TOOLS) {
    it(`${tool.name}: validates against the draft-07 meta-schema and compiles in strict mode`, () => {
      expect(ajv.validateSchema({ $schema: DRAFT7, ...tool.inputSchema }), JSON.stringify(ajv.errors)).toBe(true);
      expect(() => ajv.compile(tool.inputSchema)).not.toThrow();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });
  }
  it("search_leads accepts and rejects the right arguments", () => {
    const v = ajv.compile(TOOLS[0].inputSchema);
    expect(v({ domain: "acme.com" })).toBe(true);
    expect(v({ domain: "acme.com", role: "sales", limit: 5 })).toBe(true);
    for (const bad of [{}, { domain: "ac" }, { domain: "acme.com", limit: 0 }, { domain: "acme.com", limit: 51 }, { domain: "acme.com", limit: 1.5 }, { domain: "acme.com", x: 1 }]) expect(v(bad)).toBe(false);
  });
  it("verify_email accepts and rejects the right arguments", () => {
    const v = ajv.compile(TOOLS[1].inputSchema);
    expect(v({ email: "anna@acme.com" })).toBe(true);
    for (const bad of [{}, { email: 5 }, { email: "a" }, { email: "a@b.cz", extra: true }]) expect(v(bad)).toBe(false);
  });
});
