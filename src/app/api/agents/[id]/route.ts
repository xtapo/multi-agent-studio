import { updateAgentSchema } from "@/lib/validation/schemas";
import { errorResponse, ok, parseBody, requireSession } from "@/server/api-helpers";
import * as agentService from "@/server/services/agent-service";

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireSession();
    return ok({ agent: await agentService.getAgent(workspaceId, params.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireSession();
    const body = await parseBody(req, updateAgentSchema);
    return ok({ agent: await agentService.updateAgent(workspaceId, params.id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireSession();
    return ok(await agentService.deleteAgent(workspaceId, params.id));
  } catch (err) {
    return errorResponse(err);
  }
}
