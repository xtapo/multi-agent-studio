import type { AgentOutput } from "@/types/run";
import type { RouterDecision, WorkflowNodeDefinition } from "@/types/workflow";
import { AppError } from "@/lib/errors";
import { ROUTER_DECISION_SCHEMA } from "@/lib/agents/prompts";
import type { EngineContext, StrategyResult } from "../engine";
import { resolveFinalOutput } from "../engine";
import { topologicalOrder } from "../graph";

/**
 * ROUTER — classify once, then run only the chosen branch.
 *
 * The router node returns { route, reason, confidence }. A branch is selected
 * by matching the route against, in order: an edge condition, the target node's
 * configured routeKey, then the agent name. Everything the router can choose
 * from is derived from the graph, so it is impossible to route to an agent that
 * is not actually wired up.
 *
 * Low confidence does not fail the run — it is surfaced as an event and, when
 * a default branch exists, we take it. Refusing to answer is worse UX than
 * answering with a visible "the classifier was unsure" note.
 */
const LOW_CONFIDENCE = 0.5;

function branchesFor(ctx: EngineContext, routerNode: WorkflowNodeDefinition) {
  const targets = ctx.index.outgoing.get(routerNode.id) ?? [];
  return targets
    .map((id) => ctx.index.byId.get(id))
    .filter((n): n is WorkflowNodeDefinition => Boolean(n?.agent))
    .map((node) => {
      const edge = ctx.workflow.edges.find((e) => e.sourceNodeId === routerNode.id && e.targetNodeId === node.id);
      const key = edge?.condition?.route ?? node.config.routeKey ?? node.agent!.name;
      return { node, key, description: node.agent!.role };
    });
}

export async function runRouter(ctx: EngineContext): Promise<StrategyResult> {
  const routerNode = ctx.entryNode;
  if (!routerNode.agent) throw new AppError("VALIDATION", "Router mode requires an agent on the entry node.");

  const branches = branchesFor(ctx, routerNode);
  if (branches.length === 0) {
    throw new AppError("VALIDATION", "Router node has no outgoing connections to route to.");
  }

  const routerTask = [
    `## Request to classify\n${ctx.state.task}`,
    `## Available routes\n${branches.map((b) => `- ${b.key}: ${b.description}`).join("\n")}`,
    "Return the single best route key.",
  ].join("\n\n");

  const decisionOutput = await ctx.runNode(routerNode, {
    task: routerTask,
    upstreamNodeIds: [],
    responseSchema: ROUTER_DECISION_SCHEMA as unknown as Record<string, unknown>,
  });

  const decision = decisionOutput.json as RouterDecision | undefined;
  if (!decision) throw new AppError("SCHEMA_VALIDATION", "Router returned no structured decision.");

  ctx.bus.emit("router.decision", { ...decision, availableRoutes: branches.map((b) => b.key) });

  const normalised = decision.route.trim().toLowerCase();
  const selected =
    branches.find((b) => b.key.toLowerCase() === normalised) ??
    branches.find((b) => b.key.toLowerCase().includes(normalised) || normalised.includes(b.key.toLowerCase())) ??
    branches[0];

  if (decision.confidence < LOW_CONFIDENCE) {
    ctx.bus.emit("log", {
      level: "warn",
      message: `Router confidence ${decision.confidence} is low; proceeding with "${selected.key}".`,
    });
  }

  ctx.state.variables.route = selected.key;
  ctx.state.variables.routeReason = decision.reason;

  // Run the selected branch and everything downstream of it, in order.
  const chain = topologicalOrder(ctx.index, selected.node.id).filter((n) => n.kind === "AGENT" && n.agent);

  let last: AgentOutput | null = null;
  let previous = routerNode.agent.name;

  for (const node of chain) {
    ctx.budget.assertWithinLimits();
    last = await ctx.runNode(node, {
      upstreamNodeIds: node.id === selected.node.id ? [] : undefined,
      fromAgent: previous,
      messageType: node.id === selected.node.id ? "delegation" : "handoff",
    });
    previous = node.agent!.name;
  }

  return { finalOutput: resolveFinalOutput({ workflow: ctx.workflow, state: ctx.state, fallback: last }) };
}
