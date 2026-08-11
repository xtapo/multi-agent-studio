import { createWorkflowSchema } from "@/lib/validation/schemas";
import { parseBody, route } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/rate-limit";
import * as workflowService from "@/server/services/workflow-service";

export const GET = route(async ({ workspaceId }) => ({
  workflows: await workflowService.listWorkflows(workspaceId),
}));

export const POST = route(
  async ({ workspaceId, req }) => ({
    workflow: await workflowService.createWorkflow(workspaceId, await parseBody(req, createWorkflowSchema)),
  }),
  { rateLimit: RATE_LIMITS.write, key: "workflows.create" },
);
