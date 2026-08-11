import { errorResponse, ok, requireSession } from "@/server/api-helpers";
import * as runService from "@/server/services/run-service";

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireSession();
    return ok({ run: await runService.getRun(workspaceId, params.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Cancel an in-flight run. */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireSession();
    return ok(await runService.cancelRun(workspaceId, params.id));
  } catch (err) {
    return errorResponse(err);
  }
}
