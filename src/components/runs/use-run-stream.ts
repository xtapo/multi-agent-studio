"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Subscribes to /api/runs/:id/events over SSE.
 *
 * The cursor (`after`) is the sequence of the last event we processed, so a
 * dropped connection resumes exactly where it left off instead of replaying the
 * whole run. EventSource reconnects on its own; we only need to keep the cursor
 * in a ref so the retry uses the latest value.
 */
export interface RunEventMessage {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function useRunStream(runId: string, enabled: boolean) {
  const [events, setEvents] = useState<RunEventMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [finished, setFinished] = useState(false);
  const cursor = useRef(0);

  useEffect(() => {
    if (!enabled || finished) return;

    const source = new EventSource(`/api/runs/${runId}/events?after=${cursor.current}`);

    source.addEventListener("open", () => setConnected(true));
    source.onopen = () => setConnected(true);

    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as RunEventMessage;
        if (typeof parsed.seq !== "number") return;
        cursor.current = Math.max(cursor.current, parsed.seq);
        setEvents((prev) => [...prev, parsed]);
      } catch {
        /* heartbeats and comments are ignored */
      }
    };

    source.addEventListener("done", () => {
      setFinished(true);
      setConnected(false);
      source.close();
    });

    source.onerror = () => {
      setConnected(false);
      // EventSource retries automatically; nothing to do here.
    };

    return () => source.close();
  }, [enabled, finished, runId]);

  return { events, connected, finished };
}
