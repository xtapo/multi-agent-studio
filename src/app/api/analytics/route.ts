import { route } from "@/server/api-helpers";
import { getAnalytics } from "@/server/services/analytics-service";

export const GET = route(async ({ workspaceId, req }) => {
  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  return getAnalytics(workspaceId, Math.min(365, Math.max(1, days)));
});
