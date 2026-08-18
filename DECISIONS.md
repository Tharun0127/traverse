# Decision log

Written as I went, including the things I got wrong and reversed. The numbered
entries are referenced from comments in the source.

---

## The shape of the project

### Why implement someone else's paper instead of inventing something

The brief was open-ended, which means the choice of problem is the first real
signal. I read the company's published work before choosing, and the ObjectGraph
paper had two properties that nothing I could invent would have:

1. **It is unimplemented.** No repo, no npm package, nothing in their own GitHub
   org — only one repository there, their website. So an implementation is
   genuinely useful rather than a re-run of something that exists.
2. **Its limitations section names an untested attack surface**, verbatim:
   *"We have not evaluated ObjectGraph against adversarial document authors who
   might craft misleading `::dense` blocks or `::index` entries to manipulate
   agent routing."*

That second point is what made me commit. An implementation alone is an artifact;
an implementation plus a measured finding about the thing is a contribution. I
would rather hand over a result than a demo.

### What I deliberately did not build

- **No embeddings, no vector store, no RAG.** The format's argument is that
  declared structure beats learned similarity, and the paper already benchmarks
  RAG as a baseline it beats. Adding semantic retrieval would have quietly
  reintroduced the thing being argued against, and any win I measured would have
  been unattributable.
- **No auth, database, or accounts.** Nothing in the question needs them.
- **Markdown only.** PDF and DOCX ingestion is where a week disappears.
- **No WebSockets.** Vercel functions do not hold them. SSE does the job.

---

## Format interpretation

The paper specifies the syntax and the two primitives, but leaves a lot to the
implementer. Each ambiguity below is a place I had to choose.

**#1 — Block nesting.** The syntax shows `::node` containing `::dense`, `::full`,
`::code`, `::edges`, each closed by `::end`, and the node itself closed by
`::end`. That is ambiguous to parse naively. I used a depth counter so nested
blocks consume the correct terminator. Round-trip fidelity is asserted in tests.

**#2 — What "keyword overlap" means.** Undefined in the paper. I used term
matching with a prefix fallback (`deploying` matches `deploy`), IDF-weighted,
scaled by the declared `conf`. See #15 for how this changed twice.

**#3 — Ranking ties.** Not addressed. I break them on node id so results are
stable and reproducible across runs.

**#4 — Which edges auto-follow.** The paper says `resolve_context` returns the
requested nodes "plus all nodes reachable via `:requires` edges within a declared
depth limit". So only `:requires` auto-follows. The other seven edge types are
navigational — surfaced to the agent as `related:` but never pulled implicitly.
Auto-following `:contains` or `:see-also` would have quietly reassembled the whole
document, which is the failure mode the format exists to avoid.

**#5 — Multi-role scope.** The paper shows single values (`scope=ops`). Real
documents need a node visible to two roles, so I allowed comma-separated scopes.
A superset of the spec, not a contradiction of it.

**#6 — Unknown edge types.** Kept rather than dropped, so a round-trip stays
lossless, but never auto-followed. Silently discarding data during a parse is how
formats lose trust.

**#7 — Node runtime, never Edge.** Edge functions on Vercel must begin responding
within 25 seconds, and a live multi-turn traversal can still be choosing nodes at
that point. Node with Fluid compute allows up to 300s. Decided on day one rather
than discovered on the last day.

**#8 — Tokenizer.** Counts use `cl100k_base`, because Anthropic does not publish
Claude's tokenizer. Every number is therefore a proxy. Both lanes are measured
with the identical tokenizer, so the *ratio* holds even though absolute counts
drift a few percent. Stated on the benchmark page rather than buried here.

**#9 — Transpiler staging.** The paper describes a three-stage hybrid where the
LLM generates *only* navigational metadata and content is copied verbatim by
deterministic parsers. I reproduced that split exactly, with a deterministic
keyword fallback so the whole toolchain runs with no API key. The split is not
just fidelity — it is the reason the attack works, so blurring it would have
destroyed the finding.

**#10 — Code bridge parser.** A lightweight structural parser, not the TypeScript
compiler API. It has to run inside a serverless bundle, and symbol extraction does
not need a type checker. It finds declarations and references; it does not resolve
overloads, re-exports, or dynamic dispatch, and the code page says so.

**#11 — Turn cap.** Live traversal is capped at 6 turns. Wall clock is the binding
constraint on a serverless platform, and an agent that has not converged in six
tool calls is not about to.

---

## Reversals

These are the ones where I was wrong and had to undo something.

**#12 — The demo must not depend on an API key.** My first design called the model
on every run. That means a public URL anyone can drain, and a demo that dies the
moment a key is rotated or a rate limit trips — during review, most likely. I
reversed it: the default path makes **zero API calls**. It runs the real
primitives and the real tokenizer and reports genuinely measured numbers; only
answer *synthesis* needs a model, and that is opt-in behind two environment
variables.

The thing I had to be careful about: not fabricating model output to fill the gap.
The deterministic path returns extracted sentences from whatever content the lane
actually retrieved, and the UI labels it. If traversal was poisoned into reading
the wrong node, the extract is from the wrong node — which is exactly the
behaviour under test.

**#13 — Scoring by keyword containment, not an LLM judge.** A judge introduces a
second model's variance into a measurement whose whole point is precision. Fixed
expected substrings are cruder but they are deterministic and anyone can re-run
them and get the same number.

**#14 — Corpus as a generated module.** Documents are authored as markdown files,
but read at runtime through a build-time generated TS module. Reading `src/**`
with `fs` inside a Vercel function is not reliable — those files are not
guaranteed to be traced into the bundle. One source of truth, no runtime file
dependency.

**#15 — The verification gate, rebuilt twice.** This is the one I got most wrong,
and it is worth the detail.

*First version:* fire when the top match scores below an absolute threshold. It
fired on **38% of a clean corpus**. Cause: coverage is computed over query terms,
and a natural question is mostly function words — "how long does a rollback take"
scores 0.32 on a perfectly healthy document. I added stopword filtering, which
helped, and then found the deeper problem: absolute coverage is not a trust
signal at all.

*Second version:* fire when the top two candidates are close together. It fired on
**28%**. Cause: real documents legitimately have several sections about one
subject. "Rollback" and "Migration rollback" tie exactly, and they *should* — that
is a correct description of the document, not evidence of tampering.

*Also fixed along the way:* scores were tying constantly because ranking was too
coarse — same coverage, same confidence, identical score. Adding IDF weighting
made distinctive keywords outrank generic ones and gave the ranking something to
separate on.

*Third version, kept:* fire only on signals that have no innocent explanation —
no match at all, implausible uniform confidence, keyword collision between two
nodes, or a `::dense` block inconsistent with its own index row. Contested ranking
is still reported to the agent as "read both", but no longer triggers the
expensive path. False positives: **7.7%**. Overhead when enabled: **+2.6%**.

The general lesson, which I would apply again: for a defence protecting an
efficiency property, **false-positive rate is the binding constraint, not
detection rate.** A gate that fires constantly spends the entire saving it exists
to protect, and is worse than no gate because it also adds latency.

**#16 — Client bundle.** The playground imported attack metadata from the module
that also contains the audit logic, which imports the primitives, which import the
tokenizer. That dragged 340 kB of tokenizer into the client bundle — first load
was 441 kB. Split the metadata into a dependency-free module; first load is now
3.6 kB.

---

## Things the measurements changed my mind about

**The headline number is not the paper's.** I measure a 64.6% mean reduction. The
paper reports 92.0%. I initially assumed I had implemented something wrong.

I had not. Reduction is a function of document size — traversal's cost is roughly
flat (an index, a few summaries, two nodes) while injection's grows linearly. The
correlation across questions is r = 0.52, and per document it is stark: 29.7% on
the smallest document in the corpus, 84.4% on the largest, with a best case of
93.4%. My documents are 667–2160 tokens. Real handbooks are 10–50k.

So the honest statement is: **this is not a reproduction**, because the paper's
240-document corpus is not public, and my figure is lower primarily because my
documents are smaller. The trend points at their number without demonstrating it.
I would rather publish 64.6% with the explanation than quietly pick larger
documents until I matched 92%.

**The obvious mitigation does not work.** I assumed "resolve the top 2 instead of
the top 1" would blunt the hijack. Measured: after a hijack the correct node is in
the top 2 only **25%** of the time, and an omitted node is unreachable at **any**
K because it is not in the index to rank. Reading more candidates mostly costs
more tokens to reach the same wrong answer.

**The central finding is a negative one.** A keyword hijack changes routing on
**100%** of the benchmark and is caught at query time **0%** of the time. That is
not a weakness in my gate — it is a property of the format. The only disconfirming
evidence lives in `::full`, which is precisely the content the index exists to let
you skip. The trust boundary cannot be defended from inside the cheap path.

Moving the check to CI time, where reading the whole document once is affordable,
catches the same attack **100%** of the time with **zero** findings on the clean
corpus. That is the recommendation: trust in this format has to be established at
authoring time, not query time.

**One attack remains undefended.** Confidence inflation is caught by neither layer,
because a self-declared confidence has no ground truth to check against. It is a
weak attack — it only changes routing 33% of the time — but the honest conclusion
is that `conf` may not belong in the ranking function at all. I have not made that
change; it is a format-level proposal, not an implementation detail.

---

## What I would do next, in order

1. **Measure answer accuracy.** Everything here measures tokens and routing. A
   token reduction that broke correctness would be worthless and nothing in this
   repo rules that out. This is the first gap I would close.
2. **Cross-file federation.** The paper lists it as unsupported. Single-file
   traversal is a demo; a repository needs `file.og#node` edges with cycle
   detection. The code page is single-file for exactly this reason.
3. **Ship the CI linter as a real tool.** `auditDocument` is the finding's
   practical payload. It belongs in a pre-commit hook, not a web page.
4. **Signed index blocks.** If routing metadata is a trust boundary, it should be
   signable, so a consumer can verify the index was produced by a trusted
   transpiler rather than edited afterwards.
5. **Drop `conf` from ranking**, or require it to be derived rather than declared.

---

## What I cut, and why

- **MCP server.** Would have made the format consumable by any agent in one
  command, and it is the highest-value thing on the cutting-room floor. Cut for
  time; the primitives are already clean functions, so it is a thin wrapper.
- **Executable assertion nodes.** Parsed and round-tripped, but not executed.
  Running them safely means a sandbox, and a half-safe sandbox is worse than none.
- **Live model benchmark run.** No API key available. The harness exists and the
  section on the benchmark page is deliberately marked *not measured* rather than
  estimated.
- **A graph visualisation.** The node chips light up in traversal order, which
  carries the same information. A force-directed graph would have looked better
  and taught the viewer less.
