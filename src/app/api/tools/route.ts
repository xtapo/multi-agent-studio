import { route } from "@/server/api-helpers";
import { getToolRegistry } from "@/lib/tools/registry";

/** Tool catalogue for the Agent Builder and the Tools page. */
export const GET = route(async () => ({ tools: getToolRegistry().describe() }));
