# Traverse

**A working implementation of the ObjectGraph document format ([arXiv:2604.27820](https://arxiv.org/abs/2604.27820)), measured against baseline markdown injection — plus the first adversarial audit of its routing layer.**

The paper argues that a document should be a typed graph an agent *navigates*, not a string it *swallows*. Nobody had built it. This builds it, measures it honestly, and then tests the one thing the paper's own limitations section says was never tested.

---

## The finding in one line

> A keyword hijack changes agent routing on **100%** of the benchmark and is detected at query time **0%** of the time — because the only evidence that would expose it lives in the content the index exists to help you skip.

Moving that check to CI time, where reading the whole document once is affordable, catches the same attack **100%** of the time with **zero** false positives on a clean corpus.

---

## Numbers

Every figure is computed deterministically — real tokenizer, real primitives, no model, no estimation.

| | |
|---|---|
| Mean token reduction | **64.6%** |
| Median | 76.0% |
| Range | −12.3% … 93.4% |
| Corpus | 6 documents, 52 questions, 8 task types |
| Tests | 61 passing |

**This is not a reproduction of the paper's 92.0%.** Their 240-document corpus is not public. My figure is lower mostly because my documents are smaller — reduction correlates with document size at r = 0.52, from 29.7% on the smallest document to 84.4% on the largest. Details and full limitations on `/benchmark`.

### Attack results

| Attack | Routing changed | Caught at query time | Caught in CI |
|---|---|---|---|
| Keyword hijack | 100% | **0%** | 100% |
| Omission | 100% | 38% | 100% |
| Dense lie | 0% | 98% | 52% |
| Confidence inflation | 33% | 0% | 0% |

---

## Run it

```bash
npm install
npm run build      # generates the corpus, then builds
npm start          # http://localhost:3000
```

```bash
npm test           # 61 tests
npm run bench      # regenerates src/data/benchmark.json
```

**No API key is needed.** The deployed demo makes zero API calls: it runs the real primitives and the real tokenizer, so every number shown is measured. Only answer *synthesis* needs a model, and that is opt-in:

```bash
ANTHROPIC_API_KEY=sk-...   # optional
ALLOW_LIVE_RUNS=1          # optional, off by default so a public URL can't be drained
```

---

## What's here

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
```

### The two primitives

Exactly as specified in the paper:

```ts
search_index(file, query, role)          // ~30 tok — routing metadata, untrusted
resolve_context(file, nodeIds, depth)    // verbatim content + :requires closure
```

Only `:requires` auto-follows. The other seven edge types are surfaced as `related:` but never pulled implicitly — auto-following `:contains` would quietly reassemble the whole document, which is the failure mode the format exists to avoid.

### Progressive disclosure

| Pass | What | Cost |
|---|---|---|
| 1 | `::index` rows | ~30 tok |
| 2 | `::dense` summaries for candidates | ~10–15 tok/node |
| 3 | `::full` content, verbatim | ~100–300 tok/node |

---

## Why the attack works

The paper's own transpiler design creates the boundary:

```
::index   <- LLM-generated  <- UNTRUSTED  <- the agent routes on this
::dense   <- LLM-generated  <- UNTRUSTED  <- the agent routes on this
::full    <- copied verbatim <- trusted   <- the agent may never read it
```

The cheapest thing in the document to corrupt is also the only thing the agent trusts.

**This is not a new class of attack.** It is the same shape as prompt injection and retrieval-corpus poisoning: untrusted text steering a control decision. What is new is only the measurement against this format. Every attack here is applied to documents inside this repository; nothing targets a deployed system.

---

## Honest limitations

1. n = 52 questions over 6 documents I wrote myself. Not the paper's corpus, so not a reproduction.
2. Token counts use `cl100k_base` as a proxy — Anthropic does not publish Claude's tokenizer. Both lanes use the same one, so the ratio holds.
3. **Answer accuracy is unmeasured.** A token reduction that broke correctness would be worthless and nothing here rules that out. It needs a model; the harness exists, the section is marked *not measured* rather than estimated.
4. Attack effect is measured on routing, not on final answers. The link is inferred, not observed.
5. Traversal cost assumes the agent resolves its top two candidates — a model-independent floor, not a prediction of live behaviour.
6. Reduction is measured against single-turn injection. A real agent re-injects every turn, so this is the conservative comparison.

---

`DECISIONS.md` has the full reasoning, including the two defences I built and threw away, and the measurement that changed my mind about the headline number.

Not affiliated with or endorsed by the authors of the paper.
