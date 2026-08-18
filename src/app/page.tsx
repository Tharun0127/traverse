import Race, { type DocOption } from "@/components/Race";
import { CORPUS } from "@/data/corpus.generated";
import { QUESTIONS } from "@/data/questions";
import { ogFor } from "@/lib/docs";
import { countTokens } from "@/lib/og/tokens";
import benchmark from "@/data/benchmark.json";

export default function Home() {
  const docs: DocOption[] = CORPUS.map((c) => {
    const og = ogFor(c.id);
    return {
      id: c.id,
      title: c.title,
      cls: c.cls,
      blurb: c.blurb,
      tokens: countTokens(c.markdown),
      nodeCount: og.nodes.length,
      nodeIds: og.nodes.map((n) => n.id),
      questions: QUESTIONS.filter((q) => q.docId === c.id).map((q) => q.q),
    };
  }).filter((d) => d.questions.length > 0);

  const mean = benchmark.tokenEconomics.meanReduction;
  const best = benchmark.tokenEconomics.bestCase;

  return (
    <main>
      <section className="border-b hairline">
        <div className="mx-auto max-w-[1400px] px-5 py-8">
          <h1 className="text-[26px] font-semibold tracking-tight">
            Documents should be traversed, not swallowed.
          </h1>
          <p className="mt-2 text-[14px] text-[var(--dim)] max-w-3xl leading-relaxed">
            An implementation of the ObjectGraph format from{" "}
            <a href="https://arxiv.org/abs/2604.27820" target="_blank" rel="noreferrer">
              arXiv:2604.27820
            </a>
            , which proposes that an agent should navigate a document as a typed graph rather than
            paste the whole thing into its context. Two agents answer the same question below. One
            reads everything. One reads what it needs.
          </p>

          <div className="mt-5 flex flex-wrap gap-6">
            <Stat value={`${(mean * 100).toFixed(1)}%`} label="mean token reduction" sub={`${benchmark.method.questions} questions, ${benchmark.method.corpus}`} />
            <Stat value={`${(best * 100).toFixed(1)}%`} label="best case" sub="largest document" />
            <Stat value="100%" label="of keyword hijacks change routing" sub="0% detected at query time" warn />
            <Stat value="61" label="tests passing" sub="parser · primitives · transpiler · audit" />
          </div>
        </div>
      </section>

      <Race docs={docs} />

      <section className="mx-auto max-w-[1400px] px-5 pb-4">
        <div className="panel rounded-lg p-4">
          <p className="mono text-[10px] text-[var(--dim)] uppercase tracking-wider mb-2">
            what you are looking at
          </p>
          <div className="grid gap-4 md:grid-cols-3 text-[12px] leading-relaxed text-[var(--dim)]">
            <p>
              <strong className="text-[var(--text)]">Injection</strong> is the status quo: the whole
              document goes into the prompt on every turn. Cost scales with the document, not with
              the question.
            </p>
            <p>
              <strong className="text-[var(--text)]">Traversal</strong> starts with a ~30 token index
              and two tools — <span className="mono">search_index</span> and{" "}
              <span className="mono">resolve_context</span> — and pulls only the nodes it needs, plus
              anything they declare a <span className="mono">:requires</span> dependency on.
            </p>
            <p>
              <strong className="text-[var(--warn)]">Break it</strong> corrupts the routing metadata
              the traversal agent trusts. The content is untouched; only the index lies. See{" "}
              <a href="/audit">the audit</a> for what that costs and what catches it.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({
  value,
  label,
  sub,
  warn,
}: {
  value: string;
  label: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div
        className="counter text-[24px] font-bold leading-none"
        style={{ color: warn ? "var(--warn)" : "var(--traverse)" }}
      >
        {value}
      </div>
      <div className="text-[12px] text-[var(--text)] mt-1">{label}</div>
      <div className="mono text-[10px] text-[var(--dimmer)] mt-0.5">{sub}</div>
    </div>
  );
}
