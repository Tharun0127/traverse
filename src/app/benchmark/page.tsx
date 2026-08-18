import benchmark from "@/data/benchmark.json";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString("en-US");

export default function BenchmarkPage() {
  const t = benchmark.tokenEconomics;
  const a = benchmark.audit;

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-8">
      <h1 className="text-[24px] font-semibold tracking-tight">Benchmark</h1>
      <p className="mt-2 text-[14px] text-[var(--dim)] leading-relaxed max-w-3xl">
        Every figure here is computed deterministically — real tokenizer, real primitives, no model
        and no estimation. The one thing a model is required for, end-to-end answer accuracy, is
        reported as unmeasured rather than filled in with a plausible number.
      </p>

      {/* the honest headline */}
      <div className="panel rounded-lg p-5 mt-6">
        <div className="grid gap-6 sm:grid-cols-4">
          <Metric value={pct(t.meanReduction)} label="mean reduction" />
          <Metric value={pct(t.medianReduction)} label="median" />
          <Metric value={pct(t.bestCase)} label="best case" />
          <Metric value={pct(t.worstCase)} label="worst case" warn={t.worstCase < 0} />
        </div>
        <p className="mt-4 pt-4 border-t hairline text-[13px] text-[var(--dim)] leading-relaxed">
          <strong className="text-[var(--text)]">This is not a reproduction of the paper.</strong>{" "}
          The paper reports a 92.0% mean (95.3% best case) over a 240-document corpus that is not
          public. This is an independent measurement on {benchmark.method.corpus}, with{" "}
          {benchmark.method.questions} questions. The gap is large and the reason is measurable —
          see below.
        </p>
      </div>

      {/* size scaling — the explanation for the gap */}
      <h2 className="mt-10 text-[16px] font-semibold">Why the gap: reduction scales with document size</h2>
      <p className="mt-2 text-[13px] text-[var(--dim)] leading-relaxed max-w-3xl">
        Traversal&apos;s cost is roughly flat — an index, a few dense summaries, two resolved nodes.
        Injection&apos;s cost grows linearly with the document. So reduction is not a fixed property
        of the format; it is a function of how much document you are <em>not</em> reading. Across
        questions, the correlation between document size and reduction is{" "}
        <span className="mono text-[var(--text)]">r = {t.sizeCorrelation.toFixed(2)}</span>.
      </p>

      <div className="panel rounded-lg mt-4 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b hairline text-[var(--dim)] mono text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-2.5">Document</th>
              <th className="text-left px-4 py-2.5">Class</th>
              <th className="text-right px-4 py-2.5">Size</th>
              <th className="text-right px-4 py-2.5">Injection</th>
              <th className="text-right px-4 py-2.5">Traversal</th>
              <th className="text-right px-4 py-2.5">Reduction</th>
              <th className="px-4 py-2.5 w-[130px]"></th>
            </tr>
          </thead>
          <tbody>
            {t.sizeScaling.map((s) => (
              <tr key={s.docId} className="border-b hairline last:border-0">
                <td className="px-4 py-2.5 mono">{s.docId}</td>
                <td className="px-4 py-2.5 text-[var(--dim)]">{s.cls}</td>
                <td className="px-4 py-2.5 text-right mono">{fmt(s.docTokens)}</td>
                <td className="px-4 py-2.5 text-right mono text-[var(--inject)]">{fmt(s.meanInjection)}</td>
                <td className="px-4 py-2.5 text-right mono text-[var(--traverse)]">{fmt(s.meanTraversal)}</td>
                <td className="px-4 py-2.5 text-right mono font-semibold">{pct(s.meanReduction)}</td>
                <td className="px-4 py-2.5">
                  <div className="h-1.5 rounded-full bg-[var(--panel-2)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--traverse)]"
                      style={{ width: `${Math.max(0, s.meanReduction) * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 mono text-[10px] text-[var(--dimmer)]">
        The largest document here is still only {fmt(t.sizeScaling[t.sizeScaling.length - 1].docTokens)} tokens.
        Real handbooks and API references run 10–50k. The trend suggests the paper&apos;s 92% is
        reachable, on documents larger than any in this corpus — but this benchmark does not
        demonstrate that, it only points at it.
      </p>

      {/* by task */}
      <h2 className="mt-10 text-[16px] font-semibold">By task type</h2>
      <div className="panel rounded-lg mt-3 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b hairline text-[var(--dim)] mono text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-2.5">Task</th>
              <th className="text-right px-4 py-2.5">n</th>
              <th className="text-right px-4 py-2.5">Mean reduction</th>
            </tr>
          </thead>
          <tbody>
            {t.byTask.map((row) => (
              <tr key={row.task} className="border-b hairline last:border-0">
                <td className="px-4 py-2.5 mono">{row.task}</td>
                <td className="px-4 py-2.5 text-right mono text-[var(--dim)]">{row.questions}</td>
                <td className="px-4 py-2.5 text-right mono">
                  {row.meanReduction === null ? "—" : pct(row.meanReduction)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* defence cost */}
      <h2 className="mt-10 text-[16px] font-semibold">Cost of the defence</h2>
      <div className="panel rounded-lg p-5 mt-3">
        <div className="grid gap-6 sm:grid-cols-3">
          <Metric value={pct(a.cleanFalsePositiveRate)} label="false positives on clean documents" />
          <Metric value={`+${pct(a.defenceCost.overhead)}`} label="token overhead when enabled" />
          <Metric value={`${a.defenceCost.firedOn}/${a.defenceCost.of}`} label="questions where it fired" />
        </div>
        <p className="mt-4 pt-4 border-t hairline text-[13px] text-[var(--dim)] leading-relaxed">
          Two earlier versions of this gate were discarded for firing on 38% and 28% of a clean
          corpus. A defence that fires constantly spends the token saving it exists to protect, so
          false-positive rate is the binding constraint here, not detection rate.
        </p>
      </div>

      {/* accuracy — deliberately empty */}
      <h2 className="mt-10 text-[16px] font-semibold">Answer accuracy</h2>
      <div className="panel rounded-lg p-5 mt-3 border-l-2 border-l-[var(--warn)]">
        <p className="mono text-[11px] text-[var(--warn)] uppercase tracking-wider">not measured</p>
        <p className="mt-2 text-[13px] text-[var(--dim)] leading-relaxed">
          {benchmark.answerAccuracy.reason}
        </p>
        <p className="mt-3 text-[13px] text-[var(--text)] leading-relaxed">
          This matters. A token reduction that quietly broke correctness would be worthless, and
          nothing on this page rules that out. It is the first thing I would measure with a key.
        </p>
      </div>

      {/* limitations */}
      <h2 className="mt-10 text-[16px] font-semibold">Limitations</h2>
      <ul className="mt-3 space-y-2.5">
        {benchmark.limitations.map((l, i) => (
          <li key={i} className="flex gap-3 text-[13px] text-[var(--dim)] leading-relaxed">
            <span className="mono text-[var(--dimmer)] shrink-0">{String(i + 1).padStart(2, "0")}</span>
            <span>{l}</span>
          </li>
        ))}
      </ul>

      <div className="panel rounded-lg p-4 mt-8">
        <p className="mono text-[10px] text-[var(--dim)] uppercase tracking-wider mb-2">method</p>
        <dl className="grid gap-2 sm:grid-cols-2 text-[12px]">
          {Object.entries(benchmark.method).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="mono text-[var(--dimmer)] shrink-0">{k}</dt>
              <dd className="text-[var(--dim)]">{String(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="mono text-[10px] text-[var(--dimmer)] mt-3">
          Regenerate with <span className="text-[var(--text)]">npm run bench</span>
        </p>
      </div>
    </main>
  );
}

function Metric({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  return (
    <div>
      <div
        className="counter text-[26px] font-bold leading-none"
        style={{ color: warn ? "var(--warn)" : "var(--traverse)" }}
      >
        {value}
      </div>
      <div className="text-[12px] text-[var(--dim)] mt-1.5 leading-snug">{label}</div>
    </div>
  );
}
