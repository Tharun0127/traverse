/**
 * The two runners.
 *
 * Both are async generators yielding RunEvent. The SSE route pipes them to the
 * browser; scripts/accuracy.ts drains them to score answers. One implementation,
 * two consumers — so what the benchmark measures is the same code path the demo
 * runs.
 *
 * These require an API key. The default path on the public deployment uses
 * simulate.ts instead, which runs the identical primitives and reports genuinely
 * measured token counts without calling a model. See DECISIONS.md #12.
 */

import Anthropic from "@anthropic-ai/sdk";
import { resolveContext, searchIndex, DEFAULT_DEPTH_LIMIT } from "../og/primitives";
import { assessRouting } from "../og/poison";
import { countTokens } from "../og/tokens";
import type { OgDocument } from "../og/types";
import {
  MODEL,
  SYSTEM_INJECTION,
  SYSTEM_TRAVERSAL,
  type RunEvent,
  type RunResult,
} from "./types";

const MAX_TURNS = 6; // hard cap: Vercel functions are wall-clock bound. DECISIONS.md #11

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

/* ------------------------------------------------------------------ */
/*  LANE A — injection (the status quo)                                */
/* ------------------------------------------------------------------ */

export async function* runInjection(
  markdown: string,
  question: string
): AsyncGenerator<RunEvent, RunResult> {
  const started = Date.now();
  const events: RunEvent[] = [];
  const emit = (e: RunEvent) => {
    events.push(e);
    return e;
  };

  yield emit({ t: "start", lane: "injection", label: "whole document -> model" });

  const prompt = `<document>\n${markdown}\n</document>\n\nQuestion: ${question}`;
  const contextTokens = countTokens(prompt);
  yield emit({
    t: "context",
    lane: "injection",
    tokens: contextTokens,
    note: `entire document (${contextTokens.toLocaleString()} tokens) in a single call`,
  });

  let answer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_INJECTION,
      messages: [{ role: "user", content: prompt }],
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        answer += chunk.delta.text;
        yield emit({ t: "delta", lane: "injection", text: chunk.delta.text });
      }
    }
    const final = await stream.finalMessage();
    inputTokens = final.usage.input_tokens;
    outputTokens = final.usage.output_tokens;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield emit({ t: "error", lane: "injection", message });
    return {
      lane: "injection",
      answer: "",
      inputTokens,
      outputTokens,
      turns: 1,
      nodesVisited: [],
      elapsedMs: Date.now() - started,
      events,
    };
  }

  yield emit({ t: "usage", lane: "injection", inputTokens, outputTokens, turns: 1 });
  const elapsedMs = Date.now() - started;
  yield emit({ t: "done", lane: "injection", answer, elapsedMs });

  return {
    lane: "injection",
    answer,
    inputTokens,
    outputTokens,
    turns: 1,
    nodesVisited: [],
    elapsedMs,
    events,
  };
}

/* ------------------------------------------------------------------ */
/*  LANE B — traversal                                                 */
/* ------------------------------------------------------------------ */

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_index",
    description:
      "Search the document index. Returns candidate node IDs with a short keyword summary of each. Cheap. This is routing metadata, not content.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you are looking for." },
      },
      required: ["query"],
    },
  },
  {
    name: "resolve_context",
    description:
      "Fetch verbatim content for specific node IDs, plus anything they declare a :requires dependency on. Costs tokens proportional to what you ask for.",
    input_schema: {
      type: "object",
      properties: {
        node_ids: {
          type: "array",
          items: { type: "string" },
          description: "Node IDs from search_index.",
        },
      },
      required: ["node_ids"],
    },
  },
];

export interface TraversalOptions {
  role?: string;
  /** Run the confidence-gated verification defence. */
  mitigate?: boolean;
  depthLimit?: number;
}

export async function* runTraversal(
  doc: OgDocument,
  question: string,
  opts: TraversalOptions = {}
): AsyncGenerator<RunEvent, RunResult> {
  const { role = "all", mitigate = false, depthLimit = DEFAULT_DEPTH_LIMIT } = opts;
  const started = Date.now();
  const events: RunEvent[] = [];
  const emit = (e: RunEvent) => {
    events.push(e);
    return e;
  };

  yield emit({ t: "start", lane: "traversal", label: "index + 2 tools" });

  // Pass 1 — the index. This is the only thing given up front.
  const seed = searchIndex(doc, question, role, { includeDense: false, limit: 12 });
  const opening = `Document: ${doc.meta.title ?? "untitled"}\n\n${seed.text}\n\nQuestion: ${question}`;
  yield emit({
    t: "context",
    lane: "traversal",
    tokens: countTokens(opening),
    note: `index only (${countTokens(opening)} tokens) — content fetched on demand`,
  });

  let verification: RunResult["verification"];
  if (mitigate) {
    const verdict = assessRouting(doc, question, role);
    verification = { fired: verdict.shouldVerify, reasons: verdict.reasons, sampled: verdict.sample };
    yield emit({
      t: "verify",
      lane: "traversal",
      fired: verdict.shouldVerify,
      reasons: verdict.reasons,
      sampled: verdict.sample,
    });
  }

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opening }];

  // When the defence fires, hand the agent the verbatim content of the contested
  // nodes up front rather than letting it route on metadata it cannot trust.
  if (verification?.fired && verification.sampled.length) {
    const forced = resolveContext(doc, verification.sampled, role, depthLimit);
    messages.push({
      role: "user",
      content:
        `Routing check flagged this document as unreliable:\n- ${verification.reasons.join("\n- ")}\n\n` +
        `Verbatim content of the contested nodes follows. Trust this over the index summaries.\n\n${forced.text}`,
    });
    yield emit({
      t: "tool",
      lane: "traversal",
      name: "verify_sample",
      args: verification.sampled.join(", "),
      resultTokens: forced.tokens,
      note: "defence fired — read ::full before routing",
    });
  }

  const visited = new Set<string>();
  let answer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let turns = 0;

  try {
    const anthropic = client();

    for (turns = 1; turns <= MAX_TURNS; turns++) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_TRAVERSAL,
        tools: TOOLS,
        messages,
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          answer += chunk.delta.text;
          yield emit({ t: "delta", lane: "traversal", text: chunk.delta.text });
        }
      }

      const msg = await stream.finalMessage();
      inputTokens += msg.usage.input_tokens;
      outputTokens += msg.usage.output_tokens;

      const toolUses = msg.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (toolUses.length === 0) break;

      messages.push({ role: "assistant", content: msg.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        if (use.name === "search_index") {
          const q = (use.input as { query: string }).query;
          const r = searchIndex(doc, q, role);
          results.push({ type: "tool_result", tool_use_id: use.id, content: r.text });
          yield emit({
            t: "tool",
            lane: "traversal",
            name: "search_index",
            args: q,
            resultTokens: r.tokens,
            note: `${r.matches.length} candidates${r.hiddenByRole ? `, ${r.hiddenByRole} hidden by role` : ""}`,
          });
        } else if (use.name === "resolve_context") {
          const ids = (use.input as { node_ids: string[] }).node_ids ?? [];
          const r = resolveContext(doc, ids, role, depthLimit);
          [...r.requested, ...r.followed].forEach((id) => visited.add(id));
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: r.text || "No visible node matched those IDs.",
          });
          yield emit({
            t: "tool",
            lane: "traversal",
            name: "resolve_context",
            args: ids.join(", "),
            resultTokens: r.tokens,
            note:
              `${r.requested.length} requested` +
              (r.followed.length ? `, ${r.followed.length} via :requires` : "") +
              (r.denied.length ? `, ${r.denied.length} unavailable` : ""),
          });
          yield emit({ t: "nodes", lane: "traversal", visited: [...visited] });
        }
      }

      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield emit({ t: "error", lane: "traversal", message });
    return {
      lane: "traversal",
      answer,
      inputTokens,
      outputTokens,
      turns,
      nodesVisited: [...visited],
      elapsedMs: Date.now() - started,
      events,
      verification,
    };
  }

  yield emit({ t: "usage", lane: "traversal", inputTokens, outputTokens, turns });
  const elapsedMs = Date.now() - started;
  yield emit({ t: "done", lane: "traversal", answer, elapsedMs });

  return {
    lane: "traversal",
    answer,
    inputTokens,
    outputTokens,
    turns,
    nodesVisited: [...visited],
    elapsedMs,
    events,
    verification,
  };
}
