import { runWorkflowSchema } from "@/lib/validation/schemas";
import { errorResponse, ok, parseBody, requireSession } from "@/server/api-helpers";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";
import * as runService from "@/server/services/run-service";

/**
 * Starts a run and returns immediately with a runId.
 *
 * The request never waits for the agents: a four-agent workflow can take
 * minutes, which no HTTP timeout or serverless function budget tolerates. The
 * client subscribes to /api/runs/:id/events for the timeline.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { workspaceId, userId } = await requireSession();
    rateLimit(`run:${userId}`, RATE_LIMITS.runWorkflow);

    const body = await parseBody(req, runWorkflowSchema);
    const { runId } = await runService.startRun({
      workspaceId,
      userId,
      workflowId: params.id,
      input: body.input,
      variables: body.variables,
      budget: body.budget,
    });

    return ok({ runId, status: "QUEUED" }, 202);
  } catch (err) {
    return errorResponse(err);
  }
}
