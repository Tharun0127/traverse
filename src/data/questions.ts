/**
 * Benchmark question set.
 *
 * 40 questions across the paper's five document classes and eight agent task
 * types. `expect` holds substrings that must appear in a correct answer — scoring
 * is keyword containment, not an LLM judge, because a judge introduces a second
 * model's variance into a measurement whose entire point is precision.
 * See DECISIONS.md #13.
 *
 * `poisonTarget` marks the node an attacker would want to hide for that question.
 * It is filled in at load time from the transpiled document, not hardcoded, so it
 * stays correct if the corpus changes.
 */

export type TaskType =
  | "information-lookup"
  | "procedure-execution"
  | "multi-step-planning"
  | "role-conditional-access"
  | "cross-node-reasoning"
  | "update-detection"
  | "assertion-verification"
  | "multi-agent-handoff";

export interface Question {
  id: string;
  docId: string;
  task: TaskType;
  q: string;
  /** All must appear (case-insensitive) for the answer to score correct. */
  expect: string[];
  /** Any one of these appearing marks the answer as wrong-but-confident. */
  wrongIf?: string[];
  role?: string;
}

export const QUESTIONS: Question[] = [
  // ---------- runbook ----------
  { id: "rb-1", docId: "runbook", task: "information-lookup", q: "What is the canary threshold for error rate?", expect: ["0.5"], wrongIf: [] },
  { id: "rb-2", docId: "runbook", task: "procedure-execution", q: "What command rolls back production to the previous version?", expect: ["rollback.sh"] },
  { id: "rb-3", docId: "runbook", task: "information-lookup", q: "How long does a rollback take?", expect: ["ninety", "90"] },
  { id: "rb-4", docId: "runbook", task: "cross-node-reasoning", q: "If a deploy included a contract migration and production is broken, can I just roll back the code?", expect: ["no", "snapshot", "restore"] },
  { id: "rb-5", docId: "runbook", task: "information-lookup", q: "How long until an unacknowledged page escalates to the secondary?", expect: ["fifteen", "15"] },
  { id: "rb-6", docId: "runbook", task: "multi-step-planning", q: "What are the steps to deploy to production, in order?", expect: ["approval", "canary"] },
  { id: "rb-7", docId: "runbook", task: "assertion-verification", q: "What does the verify script check?", expect: ["version", "health"] },
  { id: "rb-8", docId: "runbook", task: "information-lookup", q: "What counts as a SEV1?", expect: ["outage", "data loss"] },
  { id: "rb-9", docId: "runbook", task: "update-detection", q: "Where do the canary thresholds live?", expect: ["canary.yaml"] },
  { id: "rb-10", docId: "runbook", task: "cross-node-reasoning", q: "Elevated 500s just after a deploy — what do I do first?", expect: ["roll back", "rollback"] },

  // ---------- techdoc ----------
  { id: "td-1", docId: "techdoc", task: "information-lookup", q: "How do I send ten dollars and fifty cents?", expect: ["1050"] },
  { id: "td-2", docId: "techdoc", task: "cross-node-reasoning", q: "What happens if I reuse an idempotency key with a different body?", expect: ["409"] },
  { id: "td-3", docId: "techdoc", task: "information-lookup", q: "What is the write rate limit?", expect: ["20"] },
  { id: "td-4", docId: "techdoc", task: "assertion-verification", q: "Should I retry a 409 concurrent_write?", expect: ["yes", "retry"] },
  { id: "td-5", docId: "techdoc", task: "procedure-execution", q: "How do I verify a webhook signature correctly?", expect: ["raw", "before"] },
  { id: "td-6", docId: "techdoc", task: "information-lookup", q: "How many accounts can one snapshot call return?", expect: ["500"] },
  { id: "td-7", docId: "techdoc", task: "cross-node-reasoning", q: "Can I use the snapshot endpoint to authorize a payment?", expect: ["no", "live"] },
  { id: "td-8", docId: "techdoc", task: "information-lookup", q: "How do I correct a mistaken event?", expect: ["compensating"] },
  { id: "td-9", docId: "techdoc", task: "information-lookup", q: "How long do cursors last?", expect: ["one hour", "1 hour"] },
  { id: "td-10", docId: "techdoc", task: "multi-agent-handoff", q: "Summarise for another agent: what scope is needed to close an account?", expect: ["admin"] },

  // ---------- plan ----------
  { id: "pl-1", docId: "plan", task: "information-lookup", q: "What is the target p95 latency?", expect: ["250"] },
  { id: "pl-2", docId: "plan", task: "multi-step-planning", q: "What are the four phases in order?", expect: ["shadow", "dark", "canary", "cutover"] },
  { id: "pl-3", docId: "plan", task: "cross-node-reasoning", q: "What is the critical path item and why?", expect: ["holdout", "experimentation"] },
  { id: "pl-4", docId: "plan", task: "information-lookup", q: "When does the November freeze begin?", expect: ["15"] },
  { id: "pl-5", docId: "plan", task: "cross-node-reasoning", q: "Why can't Phase 2 start before Phase 1 is stable?", expect: ["stale", "meaningless"] },
  { id: "pl-6", docId: "plan", task: "information-lookup", q: "Is personalised ranking part of this migration?", expect: ["no", "out of scope", "follow-on"] },
  { id: "pl-7", docId: "plan", task: "assertion-verification", q: "What is the exit criterion for shadow indexing?", expect: ["99.9"] },
  { id: "pl-8", docId: "plan", task: "multi-step-planning", q: "What is the latest date Phase 3 must begin?", expect: ["october 20", "20th"] },

  // ---------- skillfile ----------
  { id: "sf-1", docId: "skillfile", task: "procedure-execution", q: "What should I read first in an unfamiliar repository?", expect: ["manifest", "package.json"] },
  { id: "sf-2", docId: "skillfile", task: "information-lookup", q: "What share of context budget should triage cost?", expect: ["fifteen", "15"] },
  { id: "sf-3", docId: "skillfile", task: "cross-node-reasoning", q: "Why prefer changes at the leaves?", expect: ["cheap", "blast"] },
  { id: "sf-4", docId: "skillfile", task: "information-lookup", q: "Should I list every file recursively first?", expect: ["no", "never"] },
  { id: "sf-5", docId: "skillfile", task: "multi-step-planning", q: "What are the five triage steps?", expect: ["entry", "test"] },
  { id: "sf-6", docId: "skillfile", task: "assertion-verification", q: "Should I run the test suite before my change?", expect: ["yes", "first"] },

  // ---------- kb ----------
  { id: "kb-1", docId: "kb", task: "information-lookup", q: "How long are debug logs kept?", expect: ["seventy-two", "72"] },
  { id: "kb-2", docId: "kb", task: "information-lookup", q: "Can I run a load test against production?", expect: ["no"] },
  { id: "kb-3", docId: "kb", task: "cross-node-reasoning", q: "My build failed with workspace not clean. What do I do?", expect: ["generator"] },
  { id: "kb-4", docId: "kb", task: "role-conditional-access", q: "How do I get billing dashboard access?", expect: ["finance", "manager"], role: "all" },
  { id: "kb-5", docId: "kb", task: "information-lookup", q: "How often are secrets rotated?", expect: ["ninety", "90"] },
  { id: "kb-6", docId: "kb", task: "update-detection", q: "What is the maximum duration for a production database credential?", expect: ["seven", "7"] },

  // ---------- handbook (large document — tests size scaling) ----------
  { id: "hb-1", docId: "handbook", task: "information-lookup", q: "What is the pull request size limit?", expect: ["400"] },
  { id: "hb-2", docId: "handbook", task: "information-lookup", q: "How long does a flaky test get before deletion?", expect: ["one week", "week"] },
  { id: "hb-3", docId: "handbook", task: "information-lookup", q: "How many approvals does a shared library change need?", expect: ["two", "2"] },
  { id: "hb-4", docId: "handbook", task: "cross-node-reasoning", q: "Can one service read another service's database directly?", expect: ["no", "never", "api"] },
  { id: "hb-5", docId: "handbook", task: "information-lookup", q: "Which languages are supported?", expect: ["typescript", "go", "python"] },
  { id: "hb-6", docId: "handbook", task: "information-lookup", q: "How quickly must critical vulnerabilities be patched?", expect: ["three", "3"] },
  { id: "hb-7", docId: "handbook", task: "procedure-execution", q: "What day does the on-call rotation hand over?", expect: ["wednesday"] },
  { id: "hb-8", docId: "handbook", task: "multi-step-planning", q: "What happens to feature flags older than ninety days?", expect: ["reported", "removed"] },
  { id: "hb-9", docId: "handbook", task: "assertion-verification", q: "Does a refactor need new tests?", expect: ["no"] },
  { id: "hb-10", docId: "handbook", task: "information-lookup", q: "How much learning time does each engineer get?", expect: ["one day", "fortnight"] },
  { id: "hb-11", docId: "handbook", task: "cross-node-reasoning", q: "Why is suite duration described as a correctness property?", expect: ["skipped", "ten minutes"] },
  { id: "hb-12", docId: "handbook", task: "multi-agent-handoff", q: "Summarise the rollback expectation for another agent.", expect: ["five minutes", "5 minutes"] },
];

export const TASK_TYPES: TaskType[] = [
  "information-lookup",
  "procedure-execution",
  "multi-step-planning",
  "role-conditional-access",
  "cross-node-reasoning",
  "update-detection",
  "assertion-verification",
  "multi-agent-handoff",
];

/** Containment scoring. Any one `expect` term present counts as correct. */
export function scoreAnswer(answer: string, q: Question): boolean {
  const a = answer.toLowerCase();
  if (q.wrongIf?.some((w) => a.includes(w.toLowerCase()))) return false;
  return q.expect.some((e) => a.includes(e.toLowerCase()));
}
