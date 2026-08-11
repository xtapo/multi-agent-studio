import { describe, expect, it } from "vitest";
import { executionLayers, indexGraph, resolveEntryNode, topologicalOrder, upstreamOf } from "@/lib/orchestration/graph";
import type { WorkflowDefinition, WorkflowNodeDefinition } from "@/types/workflow";

const node = (id: string): WorkflowNodeDefinition => ({
  id,
  kind: "AGENT",
  label: id,
  position: { x: 0, y: 0 },
  agent: {
    id: `agent-${id}`,
    name: id,
    role: "role",
    systemPrompt: "prompt",
    model: "openai:gpt-4o-mini",
    temperature: 0.3,
    maxTokens: 1024,
    outputFormat: "MARKDOWN",
    tools: [],
    memoryConfig: { shortTerm: true, workflowMemory: false, userMemory: false },
    retryConfig: { maxRetries: 2 },
    isTemplate: false,
  },
  contextPolicy: {
    includeOriginalTask: true,
    includeUpstreamOutputs: true,
    includeVariables: [],
    includeSharedNotes: true,
  },
  config: {},
});

// a -> b -> d ; a -> c -> d  (diamond)
const workflow: WorkflowDefinition = {
  id: "wf",
  name: "diamond",
  executionMode: "PARALLEL",
  entryNodeId: "a",
  isTemplate: false,
  nodes: ["a", "b", "c", "d"].map(node),
  edges: [
    { id: "e1", sourceNodeId: "a", targetNodeId: "b" },
    { id: "e2", sourceNodeId: "a", targetNodeId: "c" },
    { id: "e3", sourceNodeId: "b", targetNodeId: "d" },
    { id: "e4", sourceNodeId: "c", targetNodeId: "d" },
  ],
};

describe("graph utilities", () => {
  const index = indexGraph(workflow);

  it("resolves the declared entry node", () => {
    expect(resolveEntryNode(workflow, index)?.id).toBe("a");
  });

  it("falls back to the node with no incoming edges", () => {
    const withoutEntry = { ...workflow, entryNodeId: undefined };
    expect(resolveEntryNode(withoutEntry, indexGraph(withoutEntry))?.id).toBe("a");
  });

  it("orders nodes topologically", () => {
    const order = topologicalOrder(index, "a").map((n) => n.id);
    expect(order[0]).toBe("a");
    expect(order.at(-1)).toBe("d");
    expect(order).toHaveLength(4);
  });

  it("groups independent nodes into the same layer", () => {
    const layers = executionLayers(index, "a").map((layer) => layer.map((n) => n.id).sort());
    expect(layers[0]).toEqual(["a"]);
    expect(layers[1]).toEqual(["b", "c"]);
    expect(layers[2]).toEqual(["d"]);
  });

  it("lists direct upstream nodes", () => {
    expect(upstreamOf(index, "d").sort()).toEqual(["b", "c"]);
  });
});
