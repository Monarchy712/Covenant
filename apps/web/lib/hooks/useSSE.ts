"use client";

import { useEffect, useRef } from "react";
import { API_BASE } from "@/lib/api";

export interface StreamEvent {
  type?: string;
  name?: string;
  txHash?: `0x${string}`;
  block?: number;
  [k: string]: unknown;
}

/**
 * Subscribe to the vault's live event stream. EventSource auto-reconnects and
 * auto-sends Last-Event-ID on resume; SSE heartbeat comments are ignored by it.
 * `onEvent` fires for every real decoded event (drive pulses + query invalidation).
 */
export function useSSE(vault: string | undefined, onEvent: (ev: StreamEvent) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!vault || typeof window === "undefined") return;
    let es: EventSource | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource(`${API_BASE}/stream/${vault}`);
      es.onmessage = (e) => {
        try {
          cb.current(JSON.parse(e.data) as StreamEvent);
        } catch {
          /* ignore non-JSON (heartbeat) */
        }
      };
      es.onerror = () => {
        // EventSource reconnects on its own; if the browser gave up, re-open.
        if (es && es.readyState === EventSource.CLOSED && !closed) {
          setTimeout(connect, 2000);
        }
      };
    };
    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, [vault]);
}
