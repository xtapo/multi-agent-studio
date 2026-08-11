import { errorResponse, ok, requireSession } from "@/server/api-helpers";
import * as workflowService from "@/server/services/workflow-service";

/** Pre-flight check the builder calls before enabling the Run button. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { workspaceId } = await requireSession();
    return ok(await workflowService.validateWorkflow(workspaceId, params.id));
  } catch (err) {
    return errorResponse(err);
  }
}
