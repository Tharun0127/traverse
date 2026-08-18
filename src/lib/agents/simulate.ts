/**
 * Deterministic run — no model, no API key, no network.
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT.
 *
 * The claim under test is about *token economics and routing*: how much context
 * each strategy pulls in, and which nodes it pulls. Both are fully determined by
 * the document, the query, and the primitives. None of it needs a language model.
 *
 * So this module runs the real search_index and resolve_context, counts real
 * tokens with the real tokenizer, and emits the same event stream the live
 * runners emit. Every number it produces is measured, not invented.
 *
 * What it does NOT do is generate an answer. Answer quality needs a model, and
 * fabricating one would poison the only thing this project is for. In this mode
 * the answer slot carries the retrieved content and is labelled as such in the
 * UI. Set ANTHROPIC_API_KEY and ALLOW_LIVE_RUNS=1 for real model answers.
 *
 * This is the default path on the public deployment, so the demo cannot break
 * from a spent key or a rate limit. See DECISIONS.md #12.
 */

import { resolveContext, searchIndex, DEFAULT_DEPTH_LIMIT } from "../og/primitives";
import { assessRouting } from "../og/poison";
import { countTokens } from "../og/tokens";
import type { OgDocument } from "../og/types";
import type { RunEvent, RunResult } from "./types";

const STEP_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the sentences most likely to answer the query out of retrieved text. */
function extractive(text: string, question: string, max = 2): string {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  const sentences = text
    .replace(/^##.*$/gm, "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 25);
  const scored = sentences
    .map((s) => {
      const l = s.toLowerCase();
      return { s, n: terms.filter((t) => l.includes(t)).length };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (scored.length === 0) return sentences.slice(0, 1).join(" ") || "(no matching content retrieved)";
  return scored.slice(0, max).map((x) => x.s).join(" ");
}

async function* stream(text: string, lane: "injection" | "traversal", events: RunEvent[]) {
  const words = text.split(/(\s+)/);
  let buf = "";
  for (const w of words) {
    buf += w;
    if (buf.length >= 14) {
      const e: RunEvent = { t: "delta", lane, text: buf };
      events.push(e);
      yield e;
      buf = "";
      await sleep(18);
    }
  }
  if (buf) {
    const e: RunEvent = { t: "delta", lane, text: buf };
    events.push(e);
    yield e;
  }
}

export async function* simulateInjection(
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
  await sleep(STEP_MS);

  const prompt = `<document>\n${markdown}\n</document>\n\nQuestion: ${question}`;
  const inputTokens = countTokens(prompt);
  yield emit({
    t: "context",
    lane: "injection",
    tokens: inputTokens,
    note: `entire document (${inputTokens.toLocaleString()} tokens) in a single call`,
  });
  await sleep(STEP_MS * 2);

  // Injection sees everything, so its answer is drawn from the whole document.
  const answer = extractive(markdown, question);
  for await (const e of stream(answer, "injection", events)) yield e;

  const outputTokens = countTokens(answer);
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

export async function* simulateTraversal(
  doc: OgDocument,
  question: string,
  opts: { role?: string; mitigate?: boolean; depthLimit?: number } = {}
): AsyncGenerator<RunEvent, RunResult> {
  const { role = "all", mitigate = false, depthLimit = DEFAULT_DEPTH_LIMIT } = opts;
  const started = Date.now();
  const events: RunEvent[] = [];
  const emit = (e: RunEvent) => {
    events.push(e);
    return e;
  };

  yield emit({ t: "start", lane: "traversal", label: "index + 2 tools" });
  await sleep(STEP_MS);

  // Pass 1 — index only.
  const seed = searchIndex(doc, question, role, { includeDense: false, limit: 12 });
  const opening = `Document: ${doc.meta.title ?? "untitled"}\n\n${seed.text}\n\nQuestion: ${question}`;
  let inputTokens = countTokens(opening);
  yield emit({
    t: "context",
    lane: "traversal",
    tokens: inputTokens,
    note: `index only (${inputTokens} tokens) — content fetched on demand`,
  });
  await sleep(STEP_MS);

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
    await sleep(STEP_MS);
  }

  // Pass 2 — dense summaries for the candidates.
  const dense = searchIndex(doc, question, role, { includeDense: true, limit: 5 });
  inputTokens += dense.tokens;
  yield emit({
    t: "tool",
    lane: "traversal",
    name: "search_index",
    args: question,
    resultTokens: dense.tokens,
    note: `${dense.matches.length} candidates${dense.hiddenByRole ? `, ${dense.hiddenByRole} hidden by role` : ""}`,
  });
  await sleep(STEP_MS * 1.5);

  // Pass 3 — resolve. Take the top candidates, plus anything the defence flagged.
  const picks = [
    ...(verification?.fired ? verification.sampled : []),
    ...dense.matches.slice(0, 2).map((m) => m.entry.id),
  ];
  const chosen = [...new Set(picks)].slice(0, 3);
  const resolved = resolveContext(doc, chosen, role, depthLimit);
  inputTokens += resolved.tokens;

  yield emit({
    t: "tool",
    lane: "traversal",
    name: "resolve_context",
    args: chosen.join(", "),
    resultTokens: resolved.tokens,
    note:
      `${resolved.requested.length} requested` +
      (resolved.followed.length ? `, ${resolved.followed.length} via :requires` : "") +
      (resolved.denied.length ? `, ${resolved.denied.length} unavailable` : ""),
  });
  const visited = [...resolved.requested, ...resolved.followed];
  yield emit({ t: "nodes", lane: "traversal", visited });
  await sleep(STEP_MS * 1.5);

  // The answer is drawn ONLY from what traversal actually retrieved. If routing
  // was poisoned, the wrong content is here, and the answer is wrong — which is
  // the behaviour the audit measures.
  const answer = extractive(resolved.text, question);
  for await (const e of stream(answer, "traversal", events)) yield e;

  const outputTokens = countTokens(answer);
  yield emit({ t: "usage", lane: "traversal", inputTokens, outputTokens, turns: 3 });
  const elapsedMs = Date.now() - started;
  yield emit({ t: "done", lane: "traversal", answer, elapsedMs });

  return {
    lane: "traversal",
    answer,
    inputTokens,
    outputTokens,
    turns: 3,
    nodesVisited: visited,
    elapsedMs,
    events,
    verification,
  };
}
