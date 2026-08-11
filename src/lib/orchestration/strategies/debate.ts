import type { AgentOutput } from "@/types/run";
import type { DebateRole, WorkflowNodeDefinition } from "@/types/workflow";
import { AppError } from "@/lib/errors";
import type { EngineContext, StrategyResult } from "../engine";
import { addSharedNote } from "../state";

/**
 * DEBATE — structured adversarial reasoning.
 *
 *   Proponent → Opponent → Judge → Synthesizer
 *
 * Ordering is by the node's debateRole, not by graph edges, because the value
 * of this mode comes from the roles being played in the right sequence. Context
 * flow is asymmetric on purpose:
 *   - the Opponent sees the proposal (it must attack something concrete);
 *   - the Judge sees both sides but not each side's private framing;
 *   - the Synthesizer sees everything, including the Judge's verdict.
 *
 * Giving every participant everything collapses the debate: agents converge on
 * each other's wording within one round and produce agreeable mush.
 */
const ROLE_ORDER: DebateRole[] = ["PROPONENT", "OPPONENT", "JUDGE", "SYNTHESIZER"];

const ROLE_DIRECTIVE: Record<DebateRole, string> = {
  PROPONENT: "Argue FOR the strongest viable position on this task. State your proposal, your three best supporting arguments, and the assumptions each depends on.",
  OPPONENT: "Argue AGAINST the proposal above. Attack its weakest assumptions and evidence, not a strawman version of it. Offer a concrete alternative where you have one.",
  JUDGE: "Evaluate both positions impartially. For each contested point, say which side is better supported and why. Do not split the difference to appear balanced — name a winner per point.",
  SYNTHESIZER: "Produce the final answer for the user. Integrate what survived the debate, state the remaining uncertainties plainly, and give a clear recommendation.",
};

function rolesFor(ctx: EngineContext): Map<DebateRole, WorkflowNodeDefinition[]> {
  const map = new Map<DebateRole, WorkflowNodeDefinition[]>();
  for (const node of ctx.index.agentNodes) {
    const role = node.config.debateRole;
    if (!role) continue;
    map.set(role, [...(map.get(role) ?? []), node]);
  }
  return map;
}

export async function runDebate(ctx: EngineContext): Promise<StrategyResult> {
  const byRole = rolesFor(ctx);

  if (byRole.size === 0) {
    throw new AppError(
      "VALIDATION",
      "Debate mode requires each node to be assigned a debate role (proponent, opponent, judge or synthesizer).",
    );
  }

  const produced = new Map<DebateRole, string[]>();
  let last: AgentOutput | null = null;

  for (const role of ROLE_ORDER) {
    const nodes = byRole.get(role);
    if (!nodes?.length) continue;

    for (const node of nodes) {
      ctx.budget.assertWithinLimits();

      // Asymmetric visibility — see the file header.
      const visibleRoles: DebateRole[] =
        role === "PROPONENT"
          ? []
          : role === "OPPONENT"
            ? ["PROPONENT"]
            : role === "JUDGE"
              ? ["PROPONENT", "OPPONENT"]
              : ["PROPONENT", "OPPONENT", "JUDGE"];

      const visibleNodeIds = visibleRoles.flatMap((r) => (byRole.get(r) ?? []).map((n) => n.id));

      last = await ctx.runNode(node, {
        task: `${ctx.state.task}\n\n## Your debate role: ${role}\n${ROLE_DIRECTIVE[role]}`,
        upstreamNodeIds: visibleNodeIds,
        messageType: role === "OPPONENT" ? "critique" : "handoff",
        fromAgent: visibleRoles.length ? "debate" : undefined,
      });

      produced.set(role, [...(produced.get(role) ?? []), node.agent!.name]);
      addSharedNote(ctx.state, `${role}: ${node.agent!.name} contributed.`);
    }
  }

  const synthesizers = byRole.get("SYNTHESIZER") ?? [];
  const finalNode = synthesizers[synthesizers.length - 1];
  const finalOutput = finalNode ? ctx.state.agentOutputs[finalNode.id] ?? last : last;

  return { finalOutput };
}
