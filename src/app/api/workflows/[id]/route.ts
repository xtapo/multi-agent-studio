import { updateWorkflowSchema } from "@/lib/validation/schemas";
import { errorResponse, ok, parseBody, requireSession } from "@/server/api-helpers";
import * as workflowService from "@/server/services/workflow-service";

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireSession();
    return ok({ workflow: await workflowService.getWorkflow(workspaceId, params.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireSession();
    const body = await parseBody(req, updateWorkflowSchema);
    return ok({ workflow: await workflowService.updateWorkflow(workspaceId, params.id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireSession();
    return ok(await workflowService.deleteWorkflow(workspaceId, params.id));
  } catch (err) {
    return errorResponse(err);
  }
}
