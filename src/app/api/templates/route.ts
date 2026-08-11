import { z } from "zod";
import { parseBody, route } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/rate-limit";
import * as workflowService from "@/server/services/workflow-service";

const instantiateSchema = z.object({
  templateKey: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
});

export const GET = route(async () => ({ templates: workflowService.listTemplates() }));

/** Materialises a built-in template into editable agents and a workflow. */
export const POST = route(
  async ({ workspaceId, req }) => {
    const body = await parseBody(req, instantiateSchema);
    return { workflow: await workflowService.instantiateTemplate(workspaceId, body.templateKey, body.name) };
  },
  { rateLimit: RATE_LIMITS.write, key: "templates.instantiate" },
);
