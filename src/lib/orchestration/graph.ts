import type { WorkflowDefinition, WorkflowNodeDefinition } from "@/types/workflow";
import { AppError } from "@/lib/errors";

/**
 * Graph utilities shared by the execution strategies.
 *
 * The workflow canvas can produce any directed graph, including invalid ones.
 * All validation lives here so every strategy inherits the same guarantees:
 * a resolvable entry point, no cycles (outside the intentionally cyclic
 * SUPERVISOR mode) and no orphan edges.
 */
export interface GraphIndex {
  byId: Map<string, WorkflowNodeDefinition>;
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  agentNodes: WorkflowNodeDefinition[];
}

export function indexGraph(workflow: WorkflowDefinition): GraphIndex {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of workflow.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of workflow.edges) {
    if (!byId.has(edge.sourceNodeId) || !byId.has(edge.targetNodeId)) continue;
    outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    incoming.get(edge.targetNodeId)!.push(edge.sourceNodeId);
  }

  return {
    byId,
    outgoing,
    incoming,
    agentNodes: workflow.nodes.filter((n) => n.kind === "AGENT" && n.agent),
  };
}

/** Entry node: explicit choice, else the only node with no inbound edge. */
export function resolveEntryNode(workflow: WorkflowDefinition, index: GraphIndex): WorkflowNodeDefinition {
  if (workflow.entryNodeId) {
    const node = index.byId.get(workflow.entryNodeId);
    if (node) return node;
  }

  const roots = index.agentNodes.filter((n) => (index.incoming.get(n.id) ?? []).length === 0);
  if (roots.length === 1) return roots[0];
  if (roots.length === 0) {
    throw new AppError("VALIDATION", "Workflow has no entry node: every node has an incoming connection.");
  }
  throw new AppError(
    "VALIDATION",
    `Workflow has ${roots.length} possible entry nodes. Select one explicitly in the builder.`,
  );
}

/**
 * Kahn topological sort restricted to nodes reachable from `from`.
 * Throws on a cycle — acyclic modes must fail loudly rather than loop.
 */
export function topologicalOrder(index: GraphIndex, from: string): WorkflowNodeDefinition[] {
  const reachable = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of index.outgoing.get(id) ?? []) stack.push(next);
  }

  const indegree = new Map<string, number>();
  for (const id of reachable) {
    indegree.set(id, (index.incoming.get(id) ?? []).filter((p) => reachable.has(p)).length);
  }

  const queue = [...reachable].filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: WorkflowNodeDefinition[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    const node = index.byId.get(id);
    if (node) order.push(node);
    for (const next of index.outgoing.get(id) ?? []) {
      if (!reachable.has(next)) continue;
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (order.length !== reachable.size) {
    throw new AppError(
      "VALIDATION",
      "Workflow graph contains a cycle. Only SUPERVISOR mode may loop; remove the cycle or switch mode.",
    );
  }

  return order;
}

/**
 * Group the reachable subgraph into dependency layers. Every node in layer N
 * depends only on layers < N, so a layer can be executed concurrently.
 */
export function executionLayers(index: GraphIndex, from: string): WorkflowNodeDefinition[][] {
  const order = topologicalOrder(index, from);
  const reachable = new Set(order.map((n) => n.id));
  const depth = new Map<string, number>();

  for (const node of order) {
    const parents = (index.incoming.get(node.id) ?? []).filter((p) => reachable.has(p));
    depth.set(node.id, parents.length === 0 ? 0 : Math.max(...parents.map((p) => (depth.get(p) ?? 0) + 1)));
  }

  const layers: WorkflowNodeDefinition[][] = [];
  for (const node of order) {
    const d = depth.get(node.id) ?? 0;
    (layers[d] ??= []).push(node);
  }
  return layers.filter(Boolean);
}

export function upstreamOf(index: GraphIndex, nodeId: string): string[] {
  return index.incoming.get(nodeId) ?? [];
}
