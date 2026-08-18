/**
 * SSE endpoint driving the race.
 *
 * Node runtime, not Edge: Edge functions on Vercel must start responding within
 * 25 seconds, and a live multi-turn traversal can still be choosing nodes at that
 * point. Node with Fluid compute gives us up to 300s on Hobby. DECISIONS.md #7.
 *
 * Live model calls are OFF unless both ANTHROPIC_API_KEY and ALLOW_LIVE_RUNS are
 * set. The public deployment therefore cannot be drained by a stranger, and the
 * demo cannot die from a spent key. DECISIONS.md #12.
 */

import { getDoc } from "@/data/corpus.generated";
import { ogFor, poisonedFor } from "@/lib/docs";
import { simulateInjection, simulateTraversal } from "@/lib/agents/simulate";
import { runInjection, runTraversal } from "@/lib/agents/runners";
import type { RunEvent } from "@/lib/agents/types";
import type { AttackKind } from "@/lib/og/poison";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function liveEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.ALLOW_LIVE_RUNS === "1";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const docId = url.searchParams.get("doc") ?? "runbook";
  const question = url.searchParams.get("q") ?? "";
  const role = url.searchParams.get("role") ?? "all";
  const attack = url.searchParams.get("attack") as AttackKind | null;
  const mitigate = url.searchParams.get("mitigate") === "1";
  const wantLive = url.searchParams.get("live") === "1";

  const source = getDoc(docId);
  if (!source || !question) {
    return new Response("bad request", { status: 400 });
  }

  const live = wantLive && liveEnabled();
  const { doc } = attack
    ? poisonedFor(docId, question, attack, role)
    : { doc: ogFor(docId) };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: RunEvent | { t: "mode"; live: boolean } | { t: "end" }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      // First byte immediately, so the connection is established well inside any
      // platform response deadline.
      send({ t: "mode", live });

      try {
        const injection = live
          ? runInjection(source.markdown, question)
          : simulateInjection(source.markdown, question);
        const traversal = live
          ? runTraversal(doc, question, { role, mitigate })
          : simulateTraversal(doc, question, { role, mitigate });

        // Both lanes race concurrently — that is the point of the display.
        await Promise.all([
          (async () => {
            for await (const e of injection) send(e);
          })(),
          (async () => {
            for await (const e of traversal) send(e);
          })(),
        ]);
      } catch (err) {
        send({
          t: "error",
          lane: "injection",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        send({ t: "end" });
        controller.close();
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
}
