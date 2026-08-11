import { errorResponse, ok, requireSession } from "@/server/api-helpers";
import * as agentService from "@/server/services/agent-service";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { workspaceId } = await requireSession();
    return ok({ agent: await agentService.duplicateAgent(workspaceId, params.id) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
