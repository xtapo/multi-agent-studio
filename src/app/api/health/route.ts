import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { env } from "@/lib/env";
import { getProviderRegistry } from "@/lib/providers/registry";

/**
 * Liveness / readiness probe.
 *
 * Deliberately unauthenticated — a load balancer cannot sign in — so it must
 * leak nothing: no versions, no connection strings, no key material. It answers
 * one question, "can this instance serve traffic", plus two booleans an
 * operator needs when a deploy looks wrong.
 *
 * Returns 503 when the database is unreachable so orchestrators stop routing
 * to this instance instead of serving broken pages.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }

  const providersConfigured = getProviderRegistry()
    .list()
    .some((provider) => provider.isConfigured());

  const body = {
    status: database ? "ok" : "degraded",
    database,
    providersConfigured,
    queueEnabled: env.RUN_QUEUE_ENABLED,
    time: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: database ? 200 : 503 });
}
