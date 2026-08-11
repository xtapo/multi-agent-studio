import PgBoss from "pg-boss";
import { env } from "@/lib/env";

/**
 * pg-boss instance.
 *
 * Why pg-boss and not BullMQ/SQS: we already run Postgres, and a workflow run
 * is a low-volume, long-lived, expensive job. Adding Redis or a cloud queue for
 * a handful of jobs per minute buys throughput we do not need and costs an
 * extra piece of infrastructure to operate. pg-boss gives us the property that
 * actually matters here — the job survives a process restart — with zero new
 * services.
 *
 * pg-boss creates its own `pgboss` schema on first start; no Prisma migration
 * is involved.
 *
 * Pinned to pg-boss 9.x: v10 changed the worker signature to batches and
 * requires queues to be created explicitly.
 */
let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  bossPromise ??= (async () => {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      // Keep finished jobs around long enough to debug a bad night.
      archiveCompletedAfterSeconds: 60 * 60 * 24,
      retentionDays: 7,
    });

    boss.on("error", (error) => console.error("[pg-boss]", error));

    await boss.start();
    return boss;
  })();

  return bossPromise;
}

export async function stopBoss(): Promise<void> {
  if (!bossPromise) return;
  const boss = await bossPromise;
  bossPromise = null;
  await boss.stop({ graceful: true });
}
