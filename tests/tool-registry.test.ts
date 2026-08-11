import { describe, expect, it } from "vitest";
import { getToolRegistry } from "@/lib/tools/registry";

describe("tool registry permissions", () => {
  const registry = getToolRegistry();

  it("registers the six built-in tools", () => {
    const names = registry.list().map((tool) => tool.name).sort();
    expect(names).toEqual(
      ["calculator", "code_executor", "database_query", "file_reader", "http_request", "web_search"].sort(),
    );
  });

  it("resolves only whitelisted, enabled tools", () => {
    const resolved = registry.resolve([
      { name: "calculator", enabled: true },
      { name: "web_search", enabled: false },
    ]);
    expect(resolved.map((r) => r.tool.name)).toEqual(["calculator"]);
  });

  it("ignores unknown tool names instead of trusting the config", () => {
    const resolved = registry.resolve([{ name: "definitely_not_a_tool", enabled: true }]);
    expect(resolved).toHaveLength(0);
  });

  it("exposes tool specs shaped for the LLM providers", () => {
    const specs = registry.toolSpecs(registry.resolve([{ name: "calculator", enabled: true }]));
    expect(specs[0]).toMatchObject({ name: "calculator" });
    expect(specs[0].inputSchema).toBeTypeOf("object");
  });
});
