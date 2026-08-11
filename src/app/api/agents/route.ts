import { createAgentSchema } from "@/lib/validation/schemas";
import { parseBody, route } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/rate-limit";
import * as agentService from "@/server/services/agent-service";

export const GET = route(async ({ workspaceId }) => ({
  agents: await agentService.listAgents(workspaceId),
}));

export const POST = route(
  async ({ workspaceId, req }) => ({
    agent: await agentService.createAgent(workspaceId, await parseBody(req, createAgentSchema)),
  }),
  { rateLimit: RATE_LIMITS.write, key: "agents.create" },
);
