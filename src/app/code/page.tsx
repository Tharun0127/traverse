import { CODE_SAMPLES } from "@/data/codesample.generated";
import { codeToOg } from "@/lib/og/codegraph";
import { searchIndex, resolveContext } from "@/lib/og/primitives";
import { poison, auditDocument, assessRouting } from "@/lib/og/poison";
import { countTokens } from "@/lib/og/tokens";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const QUERIES = [
  "how are index keywords scored against a query",
  "how does role scoping hide nodes",
  "where are requires edges followed",
  "how is markdown split into sections",
];

export default function CodePage() {
  const rows = CODE_SAMPLES.flatMap((sample) => {
    const og = codeToOg(sample.source, sample.label);
    const injectionTokens = countTokens(sample.source);

    return QUERIES.map((q) => {
      const seed = searchIndex(og, q, "all", { includeDense: false, limit: 12 });
      const dense = searchIndex(og, q, "all", { includeDense: true, limit: 5 });
      const picks = dense.matches.slice(0, 2).map((m) => m.entry.id);
      const resolved = resolveContext(og, picks, "all");
      const traversalTokens = seed.tokens + dense.tokens + resolved.tokens;

      return {
        file: sample.label,
        q,
        symbols: og.nodes.length,
        injectionTokens,
        traversalTokens,
        reduction: 1 - traversalTokens / injectionTokens,
        top: dense.matches[0]?.entry.id.split(":")[1] ?? "—",
        read: resolved.requested.length + resolved.followed.length,
      };
    });
  });

  const meanReduction = rows.reduce((a, b) => a + b.reduction, 0) / rows.length;

  // Does the attack transfer to code?
  const probe = codeToOg(CODE_SAMPLES[0].source, CODE_SAMPLES[0].label);
  const probeQ = QUERIES[0];
  const target = searchIndex(probe, probeQ).matches[0]?.entry.id;
  const hijacked = target ? poison(probe, { kind: "keyword-hijack", targetId: target }) : null;
  const afterTop = hijacked ? searchIndex(hijacked.doc, probeQ).matches[0]?.entry.id : undefined;
  const queryCaught = hijacked ? assessRouting(hijacked.doc, probeQ).shouldVerify : false;
  const ciCaught = hijacked ? auditDocument(hijacked.doc).length > 0 : false;

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-8">
      <p className="mono text-[10px] text-[var(--accent)] uppercase tracking-wider">the code bridge</p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-tight">
        Does the result survive the jump from documents to code?
      </h1>

      <p className="mt-4 text-[14px] text-[var(--dim)] leading-relaxed max-w-3xl">
        ObjectGraph is a document format. The problem it is adjacent to — an agent burning context on
        a repository it mostly does not need — is a code problem. A result on prose does not
        automatically transfer, so this page tests it directly: same two primitives, same format,
        but nodes are <strong className="text-[var(--text)]">symbols</strong> instead of headings,
        and <span className="mono">:requires</span> edges are reference dependencies instead of prose
        ordering.
      </p>
      <p className="mt-3 text-[14px] text-[var(--dim)] leading-relaxed max-w-3xl">
        Nothing in <span className="mono">search_index</span> or{" "}
        <span className="mono">resolve_context</span> changed to make this work. The input files are
        this project&apos;s own source.
      </p>

      <div className="panel rounded-lg p-5 mt-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <div className="counter text-[26px] font-bold text-[var(--traverse)] leading-none">
              {pct(meanReduction)}
            </div>
            <div className="text-[12px] text-[var(--dim)] mt-1.5">mean reduction on source files</div>
          </div>
          <div>
            <div className="counter text-[26px] font-bold text-[var(--text)] leading-none">
              {rows.length}
            </div>
            <div className="text-[12px] text-[var(--dim)] mt-1.5">
              queries across {CODE_SAMPLES.length} files
            </div>
          </div>
          <div>
            <div className="counter text-[26px] font-bold text-[var(--warn)] leading-none">
              {afterTop && afterTop !== target ? "yes" : "no"}
            </div>
            <div className="text-[12px] text-[var(--dim)] mt-1.5">the hijack transfers too</div>
          </div>
        </div>
      </div>

      <div className="panel rounded-lg mt-4 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b hairline text-[var(--dim)] mono text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-2.5">File</th>
              <th className="text-left px-4 py-2.5">Query</th>
              <th className="text-left px-4 py-2.5">Top symbol</th>
              <th className="text-right px-4 py-2.5">Whole file</th>
              <th className="text-right px-4 py-2.5">Traversal</th>
              <th className="text-right px-4 py-2.5">Reduction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b hairline last:border-0">
                <td className="px-4 py-2.5 mono text-[var(--dimmer)]">{r.file}</td>
                <td className="px-4 py-2.5 text-[var(--dim)] max-w-[280px] truncate">{r.q}</td>
                <td className="px-4 py-2.5 mono text-[var(--accent)]">{r.top}</td>
                <td className="px-4 py-2.5 text-right mono text-[var(--inject)]">{fmt(r.injectionTokens)}</td>
                <td className="px-4 py-2.5 text-right mono text-[var(--traverse)]">{fmt(r.traversalTokens)}</td>
                <td className="px-4 py-2.5 text-right mono font-semibold">{pct(r.reduction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-[16px] font-semibold">The attack transfers too</h2>
      <div className="panel rounded-lg p-5 mt-3">
        <div className="space-y-2 mono text-[12px]">
          <Line label="query" value={probeQ} />
          <Line label="correct symbol" value={target?.split(":")[1] ?? "—"} />
          <Line
            label="after hijack"
            value={afterTop?.split(":")[1] ?? "—"}
            bad={Boolean(afterTop && afterTop !== target)}
          />
          <Line label="caught at query time" value={queryCaught ? "yes" : "no"} bad={!queryCaught} />
          <Line label="caught in CI" value={ciCaught ? "yes" : "no"} good={ciCaught} />
        </div>
        <p className="mt-4 pt-4 border-t hairline text-[13px] text-[var(--dim)] leading-relaxed">
          Same conclusion as the document case, and it arrives for the same structural reason: the
          routing layer is derived metadata, the content is verbatim, and only the content can
          disconfirm the metadata. If anything the code case is worse — symbol names are far easier
          to impersonate than prose, and a repository has many more plausible decoys.
        </p>
      </div>

      <h2 className="mt-10 text-[16px] font-semibold">What this does and does not show</h2>
      <ul className="mt-3 space-y-2.5 text-[13px] text-[var(--dim)] leading-relaxed max-w-3xl">
        <li className="flex gap-3">
          <span className="mono text-[var(--traverse)] shrink-0">✓</span>
          <span>
            The two primitives work unmodified on source code. Symbol-level traversal gives a similar
            reduction to heading-level traversal on similarly sized inputs.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mono text-[var(--traverse)] shrink-0">✓</span>
          <span>The routing vulnerability is domain-independent — it transfers cleanly to code.</span>
        </li>
        <li className="flex gap-3">
          <span className="mono text-[var(--warn)] shrink-0">✗</span>
          <span>
            This is single-file. A real repository engine has to resolve symbols across files, which
            the format explicitly does not support yet — the paper lists cross-file edge resolution
            as an open limitation, and that is the first thing I would build next.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mono text-[var(--warn)] shrink-0">✗</span>
          <span>
            The symbol extractor is a lightweight structural parser, not a type-aware one. It finds
            declarations and references; it does not resolve overloads, re-exports, or dynamic
            dispatch.
          </span>
        </li>
      </ul>
    </main>
  );
}

function Line({
  label,
  value,
  bad,
  good,
}: {
  label: string;
  value: string;
  bad?: boolean;
  good?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="text-[var(--dimmer)] w-[170px] shrink-0">{label}</span>
      <span style={{ color: bad ? "var(--inject)" : good ? "var(--traverse)" : "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}
