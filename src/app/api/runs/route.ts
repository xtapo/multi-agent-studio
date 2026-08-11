import { route } from "@/server/api-helpers";
import * as runService from "@/server/services/run-service";

export const GET = route(async ({ workspaceId, req }) => {
  const url = new URL(req.url);
  return {
    runs: await runService.listRuns(workspaceId, {
      workflowId: url.searchParams.get("workflowId") ?? undefined,
      limit: Number(url.searchParams.get("limit")) || 50,
    }),
  };
});
