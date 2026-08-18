"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunEvent } from "@/lib/agents/types";
import { ATTACKS, type AttackKind } from "@/lib/og/attacks";

const fmt = (n: number) => n.toLocaleString("en-US");
const money = (n: number) => (n < 0.0001 ? "<$0.0001" : `$${n.toFixed(4)}`);
const cost = (i: number, o: number) => (i / 1e6) * 3 + (o / 1e6) * 15;

interface LaneState {
  started: boolean;
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  answer: string;
  tools: Array<{ name: string; args: string; tokens: number; note: string }>;
  nodes: string[];
  done: boolean;
  elapsedMs: number;
  error?: string;
  note?: string;
  verify?: { fired: boolean; reasons: string[]; sampled: string[] };
}

const EMPTY: LaneState = {
  started: false,
  contextTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  answer: "",
  tools: [],
  nodes: [],
  done: false,
  elapsedMs: 0,
};

export interface DocOption {
  id: string;
  title: string;
  cls: string;
  blurb: string;
  tokens: number;
  nodeCount: number;
  nodeIds: string[];
  questions: string[];
}

export default function Race({ docs }: { docs: DocOption[] }) {
  const [docId, setDocId] = useState(docs[0].id);
  const doc = docs.find((d) => d.id === docId)!;
  const [question, setQuestion] = useState(docs[0].questions[0]);
  const [role, setRole] = useState("all");
  const [attack, setAttack] = useState<AttackKind | "">("");
  const [mitigate, setMitigate] = useState(false);

  const [injection, setInjection] = useState<LaneState>(EMPTY);
  const [traversal, setTraversal] = useState<LaneState>(EMPTY);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  const onDocChange = (id: string) => {
    const d = docs.find((x) => x.id === id)!;
    setDocId(id);
    setQuestion(d.questions[0]);
    setInjection(EMPTY);
    setTraversal(EMPTY);
  };

  const run = useCallback(() => {
    esRef.current?.close();
    setInjection({ ...EMPTY, started: true });
    setTraversal({ ...EMPTY, started: true });
    setRunning(true);

    const params = new URLSearchParams({ doc: docId, q: question, role });
    if (attack) params.set("attack", attack);
    if (mitigate) params.set("mitigate", "1");

    const es = new EventSource(`/api/race?${params}`);
    esRef.current = es;

    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as RunEvent | { t: "mode"; live: boolean } | { t: "end" };

      if (e.t === "mode") {
        setLive(e.live);
        return;
      }
      if (e.t === "end") {
        setRunning(false);
        es.close();
        return;
      }

      const set = e.lane === "injection" ? setInjection : setTraversal;
      set((s) => {
        switch (e.t) {
          case "start":
            return { ...s, started: true, note: e.label };
          case "context":
            return { ...s, contextTokens: e.tokens, inputTokens: e.tokens, note: e.note };
          case "tool":
            return {
              ...s,
              inputTokens: s.inputTokens + e.resultTokens,
              tools: [...s.tools, { name: e.name, args: e.args, tokens: e.resultTokens, note: e.note }],
            };
          case "nodes":
            return { ...s, nodes: e.visited };
          case "verify":
            return { ...s, verify: { fired: e.fired, reasons: e.reasons, sampled: e.sampled } };
          case "delta":
            return { ...s, answer: s.answer + e.text };
          case "usage":
            return { ...s, inputTokens: e.inputTokens, outputTokens: e.outputTokens };
          case "done":
            return { ...s, done: true, elapsedMs: e.elapsedMs, answer: e.answer || s.answer };
          case "error":
            return { ...s, error: e.message, done: true };
          default:
            return s;
        }
      });
    };

    es.onerror = () => {
      setRunning(false);
      es.close();
    };
  }, [docId, question, role, attack, mitigate]);

  const iTok = injection.inputTokens + injection.outputTokens;
  const tTok = traversal.inputTokens + traversal.outputTokens;
  const reduction = iTok > 0 && tTok > 0 ? 1 - tTok / iTok : 0;
  const maxTok = Math.max(iTok, tTok, 1);
  const settled = injection.done && traversal.done;

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      {/* controls */}
      <div className="panel rounded-lg p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_auto] items-end">
          <label className="block">
            <span className="mono text-[10px] text-[var(--dim)] uppercase tracking-wider">Document</span>
            <select
              value={docId}
              onChange={(e) => onDocChange(e.target.value)}
              className="mt-1 w-full bg-[var(--panel-2)] border hairline rounded px-2 py-2 text-[13px] outline-none focus:border-[var(--accent)]"
            >
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} — {d.cls} ({fmt(d.tokens)} tok)
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mono text-[10px] text-[var(--dim)] uppercase tracking-wider">Question</span>
            <select
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="mt-1 w-full bg-[var(--panel-2)] border hairline rounded px-2 py-2 text-[13px] outline-none focus:border-[var(--accent)]"
            >
              {doc.questions.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={run}
            disabled={running}
            className="h-[38px] px-5 rounded mono text-[12px] font-semibold bg-[var(--traverse)] text-[#06231a] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {running ? "running…" : "▶  Run the race"}
          </button>
        </div>

        <div className="mt-3 pt-3 border-t hairline flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="mono text-[10px] text-[var(--dim)] uppercase tracking-wider">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-[var(--panel-2)] border hairline rounded px-2 py-1 mono text-[11px] outline-none"
            >
              <option value="all">all</option>
              <option value="ops">ops</option>
              <option value="manager">manager</option>
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="mono text-[10px] text-[var(--warn)] uppercase tracking-wider">⚡ Break it</span>
            <select
              value={attack}
              onChange={(e) => setAttack(e.target.value as AttackKind | "")}
              className="bg-[var(--panel-2)] border hairline rounded px-2 py-1 mono text-[11px] outline-none"
              style={attack ? { borderColor: "var(--warn)", color: "var(--warn)" } : undefined}
            >
              <option value="">none (clean document)</option>
              {Object.values(ATTACKS).map((a) => (
                <option key={a.kind} value={a.kind}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mitigate}
              onChange={(e) => setMitigate(e.target.checked)}
              className="accent-[var(--traverse)]"
            />
            <span className="mono text-[11px] text-[var(--dim)]">defence on</span>
          </label>

          {live === false && (
            <span className="ml-auto mono text-[10px] text-[var(--dimmer)]">
              deterministic mode — token counts are real, answers are extractive (no API key)
            </span>
          )}
          {live && (
            <span className="ml-auto mono text-[10px] text-[var(--traverse)]">live model</span>
          )}
        </div>

        {attack && (
          <div className="mt-3 p-3 rounded bg-[#2a1d0c] border border-[var(--warn)]/30">
            <p className="mono text-[11px] text-[var(--warn)] font-semibold">{ATTACKS[attack].label}</p>
            <p className="text-[12px] text-[var(--dim)] mt-1 leading-relaxed">{ATTACKS[attack].description}</p>
          </div>
        )}
      </div>

      {/* headline */}
      {settled && reduction > 0 && (
        <div className="panel rounded-lg p-4 mb-4 text-center pulse-in">
          <div className="counter text-[36px] font-bold text-[var(--traverse)] leading-none">
            {(reduction * 100).toFixed(1)}%
          </div>
          <div className="mono text-[11px] text-[var(--dim)] mt-1">
            fewer tokens · {fmt(iTok)} → {fmt(tTok)} · saved {money(cost(iTok, 0) - cost(tTok, 0))} on this one question
          </div>
        </div>
      )}

      {/* lanes */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Lane
          title="Injection"
          subtitle="whole document → model"
          color="var(--inject)"
          state={injection}
          totalTokens={iTok}
          maxTokens={maxTok}
        />
        <Lane
          title="Traversal"
          subtitle="index + 2 tools"
          color="var(--traverse)"
          state={traversal}
          totalTokens={tTok}
          maxTokens={maxTok}
          nodeIds={doc.nodeIds}
        />
      </div>
    </div>
  );
}

function Lane({
  title,
  subtitle,
  color,
  state,
  totalTokens,
  maxTokens,
  nodeIds,
}: {
  title: string;
  subtitle: string;
  color: string;
  state: LaneState;
  totalTokens: number;
  maxTokens: number;
  nodeIds?: string[];
}) {
  const pct = maxTokens > 0 ? (totalTokens / maxTokens) * 100 : 0;

  return (
    <div className="panel rounded-lg overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b hairline flex items-baseline gap-3">
        <span className="mono text-[12px] font-semibold" style={{ color }}>
          {title}
        </span>
        <span className="mono text-[10px] text-[var(--dimmer)]">{subtitle}</span>
        {state.done && (
          <span className="ml-auto mono text-[10px] text-[var(--dimmer)]">
            {(state.elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* counter */}
      <div className="px-4 pt-4">
        <div className="flex items-end justify-between">
          <div className="counter text-[30px] font-bold leading-none" style={{ color }}>
            {fmt(totalTokens)}
          </div>
          <div className="mono text-[11px] text-[var(--dim)]">
            {money(cost(state.inputTokens, state.outputTokens))}
          </div>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-[var(--panel-2)] overflow-hidden">
          <div className="bar h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div className="mono text-[10px] text-[var(--dimmer)] mt-1.5">{state.note ?? "idle"}</div>
      </div>

      {/* verification */}
      {state.verify && (
        <div className="mx-4 mt-3 p-2.5 rounded border" style={{ borderColor: state.verify.fired ? "var(--warn)" : "var(--line)" }}>
          <p className="mono text-[10px]" style={{ color: state.verify.fired ? "var(--warn)" : "var(--dimmer)" }}>
            {state.verify.fired ? "⚠ defence fired" : "✓ routing looks clean"}
          </p>
          {state.verify.reasons.map((r, i) => (
            <p key={i} className="text-[11px] text-[var(--dim)] mt-1 leading-snug">
              {r}
            </p>
          ))}
        </div>
      )}

      {/* tool calls */}
      {state.tools.length > 0 && (
        <div className="px-4 mt-3 space-y-1.5">
          {state.tools.map((t, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] pulse-in">
              <span className="mono text-[var(--accent)] shrink-0">{t.name}</span>
              <span className="text-[var(--dimmer)] truncate flex-1">{t.args}</span>
              <span className="mono text-[var(--dim)] shrink-0">+{fmt(t.tokens)}</span>
            </div>
          ))}
        </div>
      )}

      {/* nodes */}
      {nodeIds && nodeIds.length > 0 && (
        <div className="px-4 mt-3">
          <p className="mono text-[9px] text-[var(--dimmer)] uppercase tracking-wider mb-1.5">
            nodes read — {state.nodes.length}/{nodeIds.length}
          </p>
          <div className="flex flex-wrap gap-1">
            {nodeIds.map((id) => {
              const on = state.nodes.includes(id);
              return (
                <span
                  key={id}
                  title={id}
                  className="node-chip mono text-[9px] px-1.5 py-0.5 rounded border max-w-[120px] truncate"
                  style={{
                    borderColor: on ? "var(--traverse)" : "var(--line)",
                    color: on ? "var(--traverse)" : "var(--dimmer)",
                    background: on ? "rgba(74,222,155,0.08)" : "transparent",
                  }}
                >
                  {id}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* answer */}
      <div className="px-4 py-4 mt-3 border-t hairline flex-1">
        <p className="mono text-[9px] text-[var(--dimmer)] uppercase tracking-wider mb-1.5">answer</p>
        {state.error ? (
          <p className="text-[12px] text-[var(--inject)]">{state.error}</p>
        ) : (
          <p className="text-[13px] leading-relaxed text-[var(--text)]">
            {state.answer || (state.started ? <span className="blink text-[var(--dimmer)]">▌</span> : "—")}
          </p>
        )}
      </div>
    </div>
  );
}
