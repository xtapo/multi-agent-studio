/**
 * Standalone run worker.
 *
 *   npm run worker         # watch mode for development
 *   npm run worker:start   # production
 *
 * Runs in its own process so a Next.js deploy, restart or scale-down never
 * kills an in-flight multi-agent run. Scale it independently of the web tier;
 * pg-boss hands each job to exactly one worker.
 */
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { recoverOrphanedRuns, startRunWorker } from "@/server/queue/run-queue";
import { stopBoss } from "@/server/queue/boss";

const RECOVERY_INTERVAL_MS = 60_000;

async function main() {
  if (!env.RUN_QUEUE_ENABLED) {
    console.warn(
      "[worker] RUN_QUEUE_ENABLED is false — the web process is executing runs in-process.\n" +
        "          Set RUN_QUEUE_ENABLED=true so runs are dispatched to this worker.",
    );
  }

  // Anything left RUNNING by a previous process is dead on arrival: clean it up
  // before accepting new work, then keep sweeping on an interval.
  const reaped = await recoverOrphanedRuns();
  if (reaped > 0) console.log(`[worker] recovered ${reaped} interrupted run(s)`);

  const sweeper = setInterval(() => {
    void recoverOrphanedRuns().catch((err) => console.error("[worker] recovery sweep failed", err));
  }, RECOVERY_INTERVAL_MS);

  await startRunWorker();

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, draining...`);
    clearInterval(sweeper);
    // graceful stop lets in-flight runs finish before the process exits
    await stopBoss().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
