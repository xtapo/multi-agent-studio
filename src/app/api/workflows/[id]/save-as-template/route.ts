import { saveTemplateSchema } from "@/lib/validation/schemas";
import { errorResponse, ok, parseBody, requireSession } from "@/server/api-helpers";
import * as workflowService from "@/server/services/workflow-service";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { workspaceId } = await requireSession();
    const body = await parseBody(req, saveTemplateSchema);
    return ok({ workflow: await workflowService.saveAsTemplate(workspaceId, params.id, body.name) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
