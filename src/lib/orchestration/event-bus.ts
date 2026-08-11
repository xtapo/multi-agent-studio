import type { RunEventType } from "@/types/run";
import { prisma } from "@/server/db";

/**
 * Append-only run event log.
 *
 * Architectural decision: events are persisted, not broadcast in memory.
 *
 * An EventEmitter would be simpler and lower latency, but it breaks the moment
 * you run more than one Node process (or a serverless deployment), and a client
 * that reloads mid-run loses the timeline forever. Writing to Postgres and
 * letting the SSE endpoint page by `seq` means: any instance can serve the
 * stream, reconnects resume exactly where they left off, and the full timeline
 * is replayable months later from the run detail page. Cost is one small insert
 * per event, which is negligible next to an LLM call.
 */
export class RunEventBus {
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly runId: string) {}

  /**
   * Emit is fire-and-forget but strictly ordered: writes are chained so `seq`
   * is monotonic even when parallel branches emit concurrently. Never awaited
   * on the hot path — logging must not slow down agent execution.
   */
  emit(type: RunEventType, payload: Record<string, unknown> = {}): void {
    const seq = ++this.seq;
    this.queue = this.queue.then(() =>
      prisma.runEvent
        .create({ data: { runId: this.runId, seq, type, payload: payload as object } })
        // A failed event write must never fail the run itself.
        .catch((err) => console.error(`[run ${this.runId}] event write failed`, err)),
    );
  }

  /** Awaited once at the end of a run so the terminal event is durable. */
  async flush(): Promise<void> {
    await this.queue;
  }
}
