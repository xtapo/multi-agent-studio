import type { AgentOutput } from "@/types/run";
import { AppError, toAppError } from "@/lib/errors";
import type { EngineContext, StrategyResult } from "../engine";
import { resolveFinalOutput } from "../engine";
import { executionLayers } from "../graph";

/**
 * PARALLEL — fan-out then fan-in.
 *
 *   A ↘
 *      C
 *   B ↗
 *
 * The graph is split into dependency layers; every node in a layer runs
 * concurrently, and the next layer starts only when the previous one settles.
 *
 * Failure policy: a layer uses allSettled and tolerates partial failure as long
 * as at least one node in it succeeded. Rationale — fan-out exists to gather
 * several independent perspectives, and losing one of three researchers should
 * degrade the answer, not kill the run. If an entire layer fails, the run stops
 * because the next layer would have no input at all.
 */
export async function runParallel(ctx: EngineContext): Promise<StrategyResult> {
  const layers = executionLayers(ctx.index, ctx.entryNode.id).map((layer) =>
    layer.filter((n) => n.kind === "AGENT" && n.agent),
  );

  let last: AgentOutput | null = null;

  for (const layer of layers) {
    if (layer.length === 0) continue;
    ctx.budget.assertWithinLimits();

    const settled = await Promise.allSettled(layer.map((node) => ctx.runNode(node, { messageType: "handoff" })));

    const succeeded = settled.filter((s): s is PromiseFulfilledResult<AgentOutput> => s.status === "fulfilled");
    const failed = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");

    for (const failure of failed) {
      const err = toAppError(failure.reason);
      ctx.bus.emit("log", { level: "warn", message: `Parallel branch failed: ${err.message}`, code: err.code });
      // A budget breach is global, not branch-local — never swallow it.
      if (err.code === "BUDGET_EXCEEDED" || err.code === "MAX_STEPS_EXCEEDED" || err.code === "CANCELLED") throw err;
    }

    if (succeeded.length === 0) {
      throw new AppError(
        "INTERNAL",
        `All ${layer.length} agent(s) in this parallel layer failed; there is no input for the next layer.`,
      );
    }

    last = succeeded[succeeded.length - 1].value;
  }

  return { finalOutput: resolveFinalOutput({ workflow: ctx.workflow, state: ctx.state, fallback: last }) };
}
