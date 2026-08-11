import { describe, expect, it } from "vitest";
import { extractJson, formatIssues, validateAgainstSchema } from "@/lib/validation/json-schema";

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          evidence: { type: "string" },
          source: { type: "string" },
        },
        required: ["claim", "evidence"],
      },
    },
    summary: { type: "string" },
  },
  required: ["findings", "summary"],
} as const;

describe("validateAgainstSchema", () => {
  it("accepts a well-formed research payload", () => {
    const result = validateAgainstSchema(
      { findings: [{ claim: "c", evidence: "e", source: "s" }], summary: "ok" },
      RESEARCH_SCHEMA,
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("reports missing required properties with a path", () => {
    const result = validateAgainstSchema({ findings: [] }, RESEARCH_SCHEMA);
    expect(result.valid).toBe(false);
    expect(formatIssues(result.issues)).toMatch(/summary/);
  });

  it("reports type mismatches inside array items", () => {
    const result = validateAgainstSchema(
      { findings: [{ claim: 42, evidence: "e" }], summary: "ok" },
      RESEARCH_SCHEMA,
    );
    expect(result.valid).toBe(false);
    expect(formatIssues(result.issues)).toMatch(/findings/);
  });

  it("enforces enum values", () => {
    const result = validateAgainstSchema(
      { action: "explode" },
      { type: "object", properties: { action: { type: "string", enum: ["delegate", "retry", "finish"] } } },
    );
    expect(result.valid).toBe(false);
  });
});

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON wrapped in a fenced code block", () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```\nThanks!')).toEqual({ a: 1 });
  });

  it("parses JSON surrounded by prose", () => {
    expect(extractJson('Sure. {"route":"research","confidence":0.9} Done.')).toEqual({
      route: "research",
      confidence: 0.9,
    });
  });

  it("returns undefined when there is no JSON", () => {
    expect(extractJson("no structured data here")).toBeUndefined();
  });
});
