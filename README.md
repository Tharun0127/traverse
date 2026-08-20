# Traverse

**An implementation of the ObjectGraph document format ([arXiv:2604.27820](https://arxiv.org/abs/2604.27820)) — measured honestly against baseline injection, then broken in the one place the paper says was never tested.**

The paper argues a document should be a typed graph an agent *navigates*, not a string it *swallows*. Nobody had built it. So: build it, measure it without flattering it, and then attack the layer its own limitations section admits is unexamined.

**▶ Live demo — _link added once deployed_**

No API key needed. Every number on the site is computed at build time by the real primitives and a real tokenizer — nothing is estimated, nothing is hardcoded.

---

## 60 seconds

| Open | You'll see |
|---|---|
| **`/`** | Two agents race the same question. One gets the whole document as a string. One gets a ~30-token index and two tools. Two token counters climb. One stops at 339. The other doesn't. |
| **`/audit`** | The finding. Corrupt the index, watch routing flip, watch query-time detection fail to notice. |
| **`/benchmark`** | Where the savings actually come from, where they don't, and everything this doesn't prove. |
| **`/code`** | Does any of it survive on source code instead of prose? |

---

## The finding

> A **keyword hijack changes agent routing on 100%** of the benchmark and is caught at query time **0%** of the time — because the only evidence that would expose it lives inside the content the index exists to help you skip.

Move that same check to CI, where reading the whole document once is affordable, and it catches the attack **100%** of the time with **zero** false positives on a clean corpus.

That is the contribution: the format's trust boundary is inverted, and the fix is a scheduling decision, not a cryptographic one.

### Why it works

```
::index   <- LLM-generated  <- UNTRUSTED  <- the agent routes on this
::dense   <- LLM-generated  <- UNTRUSTED  <- the agent routes on this
::full    <- copied verbatim <- trusted   <- the agent may never read it
```

The cheapest thing in the document to corrupt is the only thing the agent trusts.

**Not a new class of attack** — it is prompt injection's shape: untrusted text steering a control decision. What's new is measuring it against this format. Every attack here runs against documents inside this repository. Nothing targets a deployed system.

### Attack results

| Attack | Routing changed | Caught at query time | Caught in CI |
|---|---|---|---|
| Keyword hijack | 100% | **0%** | 100% |
| Omission | 100% | 38% | 100% |
| Dense lie | 0% | 98% | 52% |
| Confidence inflation | 33% | 0% | 0% |

Confidence inflation is the honest embarrassment: neither defence catches it, because `conf` is author-declared and unverifiable. A document where every node claims `1.00` is not more trustworthy — it is less. I have no fix for that beyond ignoring the field.

---

## Numbers

| | |
|---|---|
| Mean token reduction | **64.6%** |
| Median | 76.0% |
| Range | −12.3% … 93.4% |
| Corpus | 6 documents, 52 questions, 8 task types |
| Tests | **61 passing** |

**This is not a reproduction of the paper's 92.0%, and I won't present it as one.** Their 240-document corpus isn't public. My figure is lower mostly because my documents are smaller — reduction correlates with document size at r = 0.52, running from 29.7% on the smallest document to 84.4% on the largest. On the worst document, traversal costs *more* than injection. That case is on `/benchmark` too.

---

## Architecture

```
src/lib/og/
  types.ts        node + edge types, role visibility
  parser.ts       .og block syntax -> document  (lossless round-trip)
  serializer.ts   document -> .og
  transpiler.ts   markdown -> .og, three-stage hybrid per the paper
  primitives.ts   search_index() and resolve_context()
  poison.ts       the adversarial audit + both defences
  codegraph.ts    the code bridge — same primitives over source symbols
  tokens.ts       token accounting
src/app/
  /               the race: injection vs traversal, side by side
  /benchmark      token economics, size scaling, limitations
  /audit          the adversarial results and the finding
  /code           does the result survive on source code?
scripts/
  build-corpus.ts inlines the corpus at build time
  benchmark.ts    regenerates every published number
  accuracy.ts     the answer-accuracy harness (needs a model)
```

### The two primitives

Exactly as specified in the paper:

```ts
search_index(file, query, role)          // ~30 tok — routing metadata, untrusted
resolve_context(file, nodeIds, depth)    // verbatim content + :requires closure
```

Only `:requires` auto-follows. The other seven edge types are surfaced as `related:` but never pulled implicitly — auto-following `:contains` would quietly reassemble the whole document, which is the exact failure mode the format exists to avoid.

### Progressive disclosure

| Pass | What | Cost |
|---|---|---|
| 1 | `::index` rows | ~30 tok |
| 2 | `::dense` summaries for candidates | ~10–15 tok/node |
| 3 | `::full` content, verbatim | ~100–300 tok/node |

---

## Run it

```bash
npm install
npm run build      # generates the corpus + benchmark, then builds
npm start          # http://localhost:3000
```

```bash
npm test           # 61 tests
npm run bench      # regenerates src/data/benchmark.json
```

The demo makes **zero API calls**. It runs the real primitives and the real tokenizer, so every figure shown is measured rather than described. Only answer *synthesis* needs a model, and that is opt-in:

```bash
ANTHROPIC_API_KEY=sk-...   # optional
ALLOW_LIVE_RUNS=1          # optional, off by default so a public URL can't be drained
```

---

## What this doesn't prove

1. n = 52 questions over 6 documents I wrote myself. Not the paper's corpus, so not a reproduction.
2. Token counts use `cl100k_base` as a proxy — Anthropic doesn't publish Claude's tokenizer. Both lanes use the same one, so the *ratio* holds even though the absolute counts drift.
3. **Answer accuracy is unmeasured.** A token reduction that broke correctness would be worthless, and nothing here rules that out. It needs a model. The harness exists (`scripts/accuracy.ts`); the section is marked *not measured* rather than filled with an estimate.
4. Attack effect is measured on routing, not on final answers. The link is inferred, not observed.
5. Traversal cost assumes the agent resolves its top two candidates — a model-independent floor, not a prediction of live behaviour.
6. Reduction is measured against single-turn injection. A real agent re-injects every turn, so this comparison is the conservative one.

Built in TypeScript on Next.js 15 / React 19. Not affiliated with or endorsed by the authors of the paper.
