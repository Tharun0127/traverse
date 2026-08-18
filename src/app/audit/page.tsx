import benchmark from "@/data/benchmark.json";
import { ATTACKS, type AttackKind } from "@/lib/og/attacks";

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export default function AuditPage() {
  const a = benchmark.audit;

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-8">
      <p className="mono text-[10px] text-[var(--warn)] uppercase tracking-wider">
        adversarial audit
      </p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-tight">
        The index is the attack surface
      </h1>

      <blockquote className="mt-5 border-l-2 border-l-[var(--line)] pl-4 text-[14px] text-[var(--dim)] italic leading-relaxed max-w-3xl">
        &ldquo;We have not evaluated ObjectGraph against adversarial document authors who might
        craft misleading <span className="mono not-italic">::dense</span> blocks or{" "}
        <span className="mono not-italic">::index</span> entries to manipulate agent routing.&rdquo;
        <footer className="mt-2 text-[12px] not-italic text-[var(--dimmer)]">
          — arXiv:2604.27820, Limitations
        </footer>
      </blockquote>

      <p className="mt-5 text-[14px] text-[var(--dim)] leading-relaxed max-w-3xl">
        This page is that evaluation. It is not a new class of attack — it is the same shape as
        prompt injection and retrieval-corpus poisoning, untrusted text steering a control decision.
        What is new is only the measurement against this format.
      </p>

      {/* the trust boundary */}
      <div className="panel rounded-lg p-5 mt-6">
        <p className="mono text-[10px] text-[var(--dim)] uppercase tracking-wider mb-3">
          why it works
        </p>
        <div className="space-y-1.5 mono text-[11px]">
          <Row layer="::index" origin="LLM-generated" trust="UNTRUSTED" note="agent routes on this" bad />
          <Row layer="::dense" origin="LLM-generated" trust="UNTRUSTED" note="agent routes on this" bad />
          <Row layer="::full" origin="copied verbatim" trust="trusted" note="agent may never read it" />
        </div>
        <p className="mt-4 text-[13px] text-[var(--dim)] leading-relaxed">
          The transpiler copies content verbatim but <em>generates</em> the routing metadata. So the
          cheapest thing in the document to corrupt is also the only thing the agent trusts — and the
          evidence that would expose the lie sits in the layer the index exists to help you skip.
        </p>
      </div>

      {/* results */}
      <h2 className="mt-10 text-[16px] font-semibold">Results</h2>
      <p className="mt-2 text-[13px] text-[var(--dim)] max-w-3xl leading-relaxed">
        Each attack applied to every question in the benchmark ({a.attacks[0]?.n} applicable of{" "}
        {benchmark.method.questions}). &ldquo;Routing changed&rdquo; means the top-ranked node moved
        away from the correct one.
      </p>

      <div className="panel rounded-lg mt-4 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b hairline text-[var(--dim)] mono text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-2.5">Attack</th>
              <th className="text-right px-4 py-2.5">Routing changed</th>
              <th className="text-right px-4 py-2.5">Caught at query time</th>
              <th className="text-right px-4 py-2.5">Caught in CI</th>
            </tr>
          </thead>
          <tbody>
            {a.attacks.map((x) => (
              <tr key={x.kind} className="border-b hairline last:border-0">
                <td className="px-4 py-3">
                  <div className="mono text-[var(--text)]">{x.label}</div>
                  <div className="text-[11px] text-[var(--dimmer)] mt-0.5 max-w-md leading-snug">
                    {x.description}
                  </div>
                </td>
                <td className="px-4 py-3 text-right mono font-semibold"
                    style={{ color: x.routingChangedPct >= 0.9 ? "var(--inject)" : "var(--dim)" }}>
                  {pct(x.routingChangedPct)}
                </td>
                <td className="px-4 py-3 text-right mono font-semibold"
                    style={{ color: x.queryDetectedPct === 0 ? "var(--inject)" : x.queryDetectedPct > 0.9 ? "var(--traverse)" : "var(--warn)" }}>
                  {pct(x.queryDetectedPct)}
                </td>
                <td className="px-4 py-3 text-right mono font-semibold"
                    style={{ color: x.ciDetectedPct === 1 ? "var(--traverse)" : x.ciDetectedPct === 0 ? "var(--inject)" : "var(--warn)" }}>
                  {pct(x.ciDetectedPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* the finding */}
      <div className="panel rounded-lg p-5 mt-6 border-l-2 border-l-[var(--inject)]">
        <p className="mono text-[10px] text-[var(--inject)] uppercase tracking-wider">
          the finding
        </p>
        <p className="mt-2 text-[15px] text-[var(--text)] leading-relaxed">
          A keyword hijack changes routing on <strong>100%</strong> of the benchmark and is detected
          at query time <strong>0%</strong> of the time.
        </p>
        <p className="mt-3 text-[13px] text-[var(--dim)] leading-relaxed">
          There is no collision to spot, no implausible confidence, and the ranking is decisive.
          Every signal available in the cheap path reports a healthy document. This is a property of
          the format, not a gap in this implementation: the only disconfirming evidence lives in{" "}
          <span className="mono">::full</span>, which is exactly what the index exists to let you
          avoid reading.
        </p>
        <p className="mt-3 text-[13px] text-[var(--text)] leading-relaxed">
          <strong>So the trust boundary cannot be defended from inside the cheap path.</strong> It
          has to be defended at authoring or CI time, where reading the whole document once is
          affordable — and there, the same attack is caught 100% of the time.
        </p>
      </div>

      {/* top-K */}
      <h2 className="mt-10 text-[16px] font-semibold">The obvious mitigation does not work</h2>
      <p className="mt-2 text-[13px] text-[var(--dim)] max-w-3xl leading-relaxed">
        The first thing anyone reaches for is &ldquo;resolve the top few candidates instead of just
        the top one&rdquo;. Below is how often the <em>correct</em> node is still inside the top K
        after each attack. Breadth buys very little, and it never rescues an omission — a node
        removed from the index is unreachable at any K, because it is not there to rank.
      </p>
      <div className="panel rounded-lg mt-4 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b hairline text-[var(--dim)] mono text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-2.5">Attack</th>
              <th className="text-right px-4 py-2.5">K = 1</th>
              <th className="text-right px-4 py-2.5">K = 2</th>
              <th className="text-right px-4 py-2.5">K = 3</th>
            </tr>
          </thead>
          <tbody>
            {a.topKSurvival.map((r) => (
              <tr key={r.kind} className="border-b hairline last:border-0">
                <td className="px-4 py-2.5 mono">{r.label}</td>
                {[r.k1, r.k2, r.k3].map((v, i) => (
                  <td
                    key={i}
                    className="px-4 py-2.5 text-right mono font-semibold"
                    style={{ color: v === 0 ? "var(--inject)" : v >= 0.9 ? "var(--traverse)" : "var(--warn)" }}
                  >
                    {pct(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 mono text-[10px] text-[var(--dimmer)]">
        Reading more candidates costs more tokens to arrive at the same wrong answer.
      </p>

      {/* mitigation */}
      <h2 className="mt-10 text-[16px] font-semibold">The two defences</h2>
      <div className="grid gap-4 md:grid-cols-2 mt-3">
        <div className="panel rounded-lg p-4">
          <p className="mono text-[11px] text-[var(--text)]">Query time — confidence gating</p>
          <p className="mt-2 text-[12px] text-[var(--dim)] leading-relaxed">
            Escalates to reading <span className="mono">::full</span> when routing looks
            untrustworthy: no match, implausible uniform confidence, keyword collision, or a{" "}
            <span className="mono">::dense</span> block inconsistent with its own index row.
          </p>
          <div className="mt-3 pt-3 border-t hairline grid grid-cols-2 gap-3">
            <Mini value={pct(a.cleanFalsePositiveRate)} label="false positives" />
            <Mini value={`+${(a.defenceCost.overhead * 100).toFixed(1)}%`} label="token overhead" />
          </div>
          <p className="mt-3 text-[11px] text-[var(--dimmer)] leading-relaxed">
            Catches dense lies well. Catches hijacks not at all.
          </p>
        </div>

        <div className="panel rounded-lg p-4">
          <p className="mono text-[11px] text-[var(--text)]">CI time — content grounding</p>
          <p className="mt-2 text-[12px] text-[var(--dim)] leading-relaxed">
            Reads every node and checks that its routing metadata is actually grounded in its own
            content: orphaned nodes, phantom index rows, dense/full divergence, keywords that appear
            nowhere in the node they index.
          </p>
          <div className="mt-3 pt-3 border-t hairline grid grid-cols-2 gap-3">
            <Mini value={`${a.cleanCiFindings}`} label="findings on clean corpus" />
            <Mini value="100%" label="hijacks caught" />
          </div>
          <p className="mt-3 text-[11px] text-[var(--dimmer)] leading-relaxed">
            Runs once per commit, not once per query. The right place to pay for trust.
          </p>
        </div>
      </div>

      {/* open gaps */}
      <h2 className="mt-10 text-[16px] font-semibold">What is still unsolved</h2>
      <ul className="mt-3 space-y-2.5 text-[13px] text-[var(--dim)] leading-relaxed">
        <li className="flex gap-3">
          <span className="text-[var(--warn)] mono shrink-0">01</span>
          <span>
            <strong className="text-[var(--text)]">Confidence inflation is undetected by both
            layers.</strong> It is a weak attack — it only changes routing{" "}
            {pct(a.attacks.find((x) => x.kind === "confidence-inflation")!.routingChangedPct)} of the
            time — but nothing here catches it, because a self-declared confidence has no ground
            truth to check against. Removing <span className="mono">conf</span> from the ranking
            entirely may be the correct answer.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-[var(--warn)] mono shrink-0">02</span>
          <span>
            <strong className="text-[var(--text)]">Attack effect is measured on routing, not
            answers.</strong> A changed route usually means a wrong answer, but that link is inferred
            here rather than observed, because measuring it needs a model.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-[var(--warn)] mono shrink-0">03</span>
          <span>
            <strong className="text-[var(--text)]">CI-time defence assumes you trust the
            author.</strong> It catches a document whose metadata disagrees with its content. It
            cannot catch a document where both are consistently wrong.
          </span>
        </li>
      </ul>

      <div className="panel rounded-lg p-4 mt-8">
        <p className="mono text-[10px] text-[var(--dim)] uppercase tracking-wider mb-2">disclosure</p>
        <p className="text-[12px] text-[var(--dim)] leading-relaxed">
          Every attack here is applied to documents authored for this repository. Nothing targets a
          deployed system, and no live service was tested. This is an extension of a limitation the
          format&apos;s own authors published, not an unsolicited security disclosure.
        </p>
      </div>

      <details className="mt-6">
        <summary className="mono text-[11px] text-[var(--dim)] cursor-pointer hover:text-[var(--text)]">
          attack definitions
        </summary>
        <div className="mt-3 space-y-3">
          {(Object.keys(ATTACKS) as AttackKind[]).map((k) => (
            <div key={k} className="panel rounded p-3">
              <p className="mono text-[11px] text-[var(--text)]">{ATTACKS[k].label}</p>
              <p className="text-[12px] text-[var(--dim)] mt-1 leading-relaxed">{ATTACKS[k].description}</p>
              <p className="text-[11px] text-[var(--dimmer)] mt-1.5 leading-relaxed">
                <span className="mono">tell:</span> {ATTACKS[k].tell}
              </p>
            </div>
          ))}
        </div>
      </details>
    </main>
  );
}

function Row({
  layer,
  origin,
  trust,
  note,
  bad,
}: {
  layer: string;
  origin: string;
  trust: string;
  note: string;
  bad?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded border"
      style={{
        borderColor: bad ? "rgba(249,115,98,0.3)" : "var(--line)",
        background: bad ? "rgba(249,115,98,0.05)" : "transparent",
      }}
    >
      <span className="text-[var(--text)] w-[64px]">{layer}</span>
      <span className="text-[var(--dimmer)] w-[120px]">{origin}</span>
      <span style={{ color: bad ? "var(--inject)" : "var(--traverse)" }} className="w-[90px]">
        {trust}
      </span>
      <span className="text-[var(--dim)]">{note}</span>
    </div>
  );
}

function Mini({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="counter text-[17px] font-bold text-[var(--text)] leading-none">{value}</div>
      <div className="mono text-[9px] text-[var(--dimmer)] mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}
