import { errorResponse, requireSession } from "@/server/api-helpers";
import { getRunEvents, getRunStatus } from "@/server/repositories/run-repo";
import { assertRunAccess } from "@/server/services/run-service";

/**
 * Realtime run timeline over Server-Sent Events.
 *
 * SSE rather than WebSocket: the stream is strictly one-directional, it works
 * over plain HTTP with no extra server, and the browser reconnects on its own.
 *
 * The stream is a cursor over the RunEvent table rather than an in-memory
 * emitter. That is what makes it correct in a multi-instance deployment (the
 * reader is usually not the process executing the run) and replayable — a
 * client that connects late, or reconnects, receives the complete timeline from
 * seq 0. `?after=` resumes from a known cursor.
 *
 * Cost: up to POLL_MS of latency per event. At 250ms that is invisible next to
 * multi-second LLM calls.
 */
const POLL_MS = 250;
const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = 15 * 60_000;

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { workspaceId } = await requireSession();
    await assertRunAccess(workspaceId, params.id);

    const runId = params.id;
    const url = new URL(req.url);
    let cursor = Number(url.searchParams.get("after")) || 0;

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const startedAt = Date.now();
        let closed = false;
        let lastPing = Date.now();

        const send = (event: string, data: unknown, id?: number) => {
          const idLine = id !== undefined ? `id: ${id}\n` : "";
          controller.enqueue(encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        };

        req.signal.addEventListener("abort", close);

        // Tell proxies not to buffer, and give the client its cursor origin.
        send("open", { runId, after: cursor });

        while (!closed) {
          try {
            const events = await getRunEvents(runId, cursor, 200);
            for (const event of events) {
              send(event.type, { seq: event.seq, type: event.type, createdAt: event.createdAt, ...(event.payload as object) }, event.seq);
              cursor = event.seq;
            }

            if (events.length === 0) {
              const status = await getRunStatus(runId);
              const terminal = status && ["COMPLETED", "FAILED", "CANCELLED"].includes(status.status);
              if (terminal) {
                send("done", { runId, status: status!.status, output: status!.output, error: status!.error });
                close();
                break;
              }
              if (Date.now() - lastPing > HEARTBEAT_MS) {
                controller.enqueue(encoder.encode(": ping\n\n"));
                lastPing = Date.now();
              }
            }

            if (Date.now() - startedAt > MAX_STREAM_MS) {
              send("timeout", { runId, after: cursor });
              close();
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          } catch (err) {
            send("error", { message: (err as Error).message });
            close();
            break;
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
