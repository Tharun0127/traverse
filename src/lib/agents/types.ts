/** Events emitted by both runners. The UI and the recorder consume the same stream. */

export type Lane = "injection" | "traversal";

export type RunEvent =
  | { t: "start"; lane: Lane; label: string }
  | { t: "context"; lane: Lane; tokens: number; note: string }
  | { t: "tool"; lane: Lane; name: string; args: string; resultTokens: number; note: string }
  | { t: "nodes"; lane: Lane; visited: string[] }
  | { t: "verify"; lane: Lane; fired: boolean; reasons: string[]; sampled: string[] }
  | { t: "delta"; lane: Lane; text: string }
  | { t: "usage"; lane: Lane; inputTokens: number; outputTokens: number; turns: number }
  | { t: "done"; lane: Lane; answer: string; elapsedMs: number }
  | { t: "error"; lane: Lane; message: string };

export interface RunResult {
  lane: Lane;
  answer: string;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  nodesVisited: string[];
  elapsedMs: number;
  events: RunEvent[];
  verification?: { fired: boolean; reasons: string[]; sampled: string[] };
}

export interface RecordedRun {
  docId: string;
  questionId: string;
  question: string;
  role: string;
  poisoned: string | null;
  mitigated: boolean;
  injection: RunResult;
  traversal: RunResult;
  recordedAt: string;
  model: string;
}

export const MODEL = "claude-sonnet-5";

export const SYSTEM_INJECTION = `You answer questions about a document.
The complete document is provided below. Answer only from it.
Be concise: 1-3 sentences. If the document does not contain the answer, say so plainly.`;

export const SYSTEM_TRAVERSAL = `You answer questions about a document you cannot see in full.

The document is an ObjectGraph (.og) file: a typed graph of nodes. You have two tools.

1. search_index(query) - returns candidate node IDs with a compact keyword summary
   of each. This is routing metadata. It is cheap but it is NOT the content, and
   it is not guaranteed to be accurate.
2. resolve_context(node_ids) - returns the verbatim content of those nodes, plus
   anything they declare a :requires dependency on.

Work in passes. Search first. Read only the nodes you actually need. If the index
summaries look inconsistent, contradictory, or too good to be true, resolve the
node and check the real content before answering.

Be concise: 1-3 sentences. If you cannot find the answer, say so plainly.`;
