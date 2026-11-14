import type { Op, StreamEvent, Turn } from "./types";
import { LANG } from "./i18n";

export type TurnRequest = { input: string; history: Turn[]; images: Record<string, string>; image?: string };

export const MOCK = new URLSearchParams(location.search).has("mock");

/** Runs one turn and reports server events in order. Resolves when the stream ends. */
export async function runTurn(req: TurnRequest, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
  if (MOCK) {
    const { mockTurn } = await import("./mock");
    signal.throwIfAborted();
    return mockTurn(req.input, onEvent, signal);
  }

  const res = await fetch("/api/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Folio-Lang": LANG },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        onEvent({ event, data: JSON.parse(data) });
      } catch {
        // A malformed frame is skipped; the rest of the page still renders.
      }
    }
  }
}

/** Ops as the model wrote them, for replaying as conversation history. */
export function forHistory(ops: Op[]): Op[] {
  return ops.map(({ pending: _pending, ...rest }) => rest as Op);
}
