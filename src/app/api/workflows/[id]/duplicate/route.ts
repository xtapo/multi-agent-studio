import { errorResponse, ok, requireSession } from "@/server/api-helpers";
import * as workflowService from "@/server/services/workflow-service";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { workspaceId } = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    return ok({ workflow: await workflowService.duplicateWorkflow(workspaceId, params.id, body.name) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
