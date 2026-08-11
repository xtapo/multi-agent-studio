import type { AgentOutput } from "@/types/run";
import type { EngineContext, StrategyResult } from "../engine";
import { topologicalOrder } from "../graph";
import { resolveFinalOutput } from "../engine";

/**
 * SEQUENTIAL — A → B → C.
 *
 * Runs the reachable subgraph in topological order, one node at a time. Each
 * node receives only its direct predecessors' outputs, so a five-agent chain
 * costs O(n) context rather than O(n²).
 *
 * A failed step aborts the chain: in a pipeline, every downstream agent would
 * otherwise be working from a hole in its input and produce confident nonsense.
 */
export async function runSequential(ctx: EngineContext): Promise<StrategyResult> {
  const order = topologicalOrder(ctx.index, ctx.entryNode.id).filter((n) => n.kind === "AGENT" && n.agent);

  let last: AgentOutput | null = null;
  let previousAgentName: string | undefined;

  for (const node of order) {
    ctx.budget.assertWithinLimits();
    last = await ctx.runNode(node, { fromAgent: previousAgentName, messageType: "handoff" });
    previousAgentName = node.agent!.name;
  }

  return { finalOutput: resolveFinalOutput({ workflow: ctx.workflow, state: ctx.state, fallback: last }) };
}
