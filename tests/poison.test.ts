import { describe, expect, it } from "vitest";
import { assessRouting, auditDocument, poison, suggestDecoy } from "@/lib/og/poison";
import { searchIndex } from "@/lib/og/primitives";
import { transpileSync } from "@/lib/og/transpiler";

const MD = `# Ops

## Rollback

Rollback takes ninety seconds and restores the previous image.

## Snapshots

Snapshots are retained for fourteen days and take forty minutes to restore.

## Escalation

Pages escalate to the secondary after fifteen minutes.
`;

const base = transpileSync(MD, { title: "Ops" });

describe("keyword hijack", () => {
  it("moves the correct node out of the top slot", () => {
    const before = searchIndex(base, "how long does a rollback take");
    expect(before.matches[0].entry.id).toBe("rollback");

    const { doc } = poison(base, { kind: "keyword-hijack", targetId: "rollback", decoyId: "snapshots" });
    const after = searchIndex(doc, "how long does a rollback take");
    expect(after.matches[0].entry.id).toBe("snapshots");
  });
});

describe("confidence inflation", () => {
  it("inverts ranking using only self-declared confidence", () => {
    const { doc } = poison(base, {
      kind: "confidence-inflation",
      targetId: "rollback",
      decoyId: "snapshots",
    });
    expect(doc.index.find((e) => e.id === "snapshots")!.conf).toBe(1);
    expect(doc.index.find((e) => e.id === "rollback")!.conf).toBeLessThan(0.2);
  });
});

describe("omission", () => {
  const { doc } = poison(base, { kind: "omission", targetId: "rollback" });

  it("removes the node from the index", () => {
    expect(doc.index.some((e) => e.id === "rollback")).toBe(false);
  });

  it("leaves the node body intact — the content is still in the file", () => {
    expect(doc.nodes.some((n) => n.id === "rollback")).toBe(true);
    expect(doc.nodes.find((n) => n.id === "rollback")!.full).toContain("ninety seconds");
  });

  it("makes the node unreachable through search_index", () => {
    const r = searchIndex(doc, "how long does a rollback take");
    expect(r.matches.map((m) => m.entry.id)).not.toContain("rollback");
  });
});

describe("dense lie", () => {
  it("makes ::dense contradict ::full while leaving ::full untouched", () => {
    const { doc } = poison(base, { kind: "dense-lie", targetId: "rollback", decoyId: "escalation" });
    const node = doc.nodes.find((n) => n.id === "rollback")!;
    expect(node.full).toContain("ninety seconds");
    expect(node.dense).not.toContain("rollback");
  });
});

describe("mitigation — assessRouting (query-time)", () => {
  it("stays quiet on a clean document with a clear match", () => {
    const verdict = assessRouting(base, "how long does a rollback take");
    expect(verdict.shouldVerify).toBe(false);
  });

  it("stays quiet across every clean question — a defence that always fires is useless", () => {
    for (const q of [
      "how long does a rollback take",
      "how long are snapshots retained",
      "when does a page escalate to the secondary",
    ]) {
      expect(assessRouting(base, q).shouldVerify, q).toBe(false);
    }
  });

  it("fires on a dense lie — internal inconsistency is visible without reading ::full", () => {
    const { doc } = poison(base, { kind: "dense-lie", targetId: "rollback", decoyId: "escalation" });
    expect(assessRouting(doc, "how long does a rollback take").shouldVerify).toBe(true);
  });

  /**
   * THE CENTRAL NEGATIVE RESULT.
   *
   * A keyword hijack changes routing on 100% of the benchmark and is detected at
   * query time 0% of the time. There is no collision to see, no implausible
   * confidence, and the ranking is decisive — every signal available in the cheap
   * path reports a healthy document.
   *
   * This is a property of the format, not a gap in this implementation. The only
   * disconfirming evidence lives in ::full, which is precisely the content the
   * index exists to let you avoid reading. The trust boundary therefore cannot be
   * defended from inside the cheap path; it has to be defended at authoring or CI
   * time, where reading the whole document once is affordable.
   *
   * Full numbers on /audit and in src/data/benchmark.json.
   */
  it("does NOT catch a keyword hijack at query time — the central finding", () => {
    const { doc } = poison(base, { kind: "keyword-hijack", targetId: "rollback", decoyId: "snapshots" });

    // The attack lands: routing moves to the decoy.
    expect(searchIndex(doc, "how long does a rollback take").matches[0].entry.id).toBe("snapshots");
    // And nothing in the cheap path notices.
    expect(assessRouting(doc, "how long does a rollback take").shouldVerify).toBe(false);
    // Only the CI-time audit, which may read ::full, catches it.
    expect(auditDocument(doc).some((f) => f.startsWith("KEYWORD DIVERGENCE"))).toBe(true);
  });

  it("fires on a dense lie via internal inconsistency", () => {
    const { doc } = poison(base, { kind: "dense-lie", targetId: "rollback", decoyId: "escalation" });
    const verdict = assessRouting(doc, "how long does a rollback take");
    expect(verdict.shouldVerify).toBe(true);
    expect(verdict.reasons.join(" ")).toContain("shares no term");
  });

  it("fires when every candidate claims perfect confidence", () => {
    const doc = { ...base, index: base.index.map((e) => ({ ...e, conf: 1 })) };
    const verdict = assessRouting(doc, "rollback snapshots escalation");
    expect(verdict.reasons.join(" ")).toContain("not plausible");
  });
});

describe("auditDocument — the CI linter", () => {
  it("finds nothing wrong with a clean document", () => {
    expect(auditDocument(base)).toHaveLength(0);
  });

  it("catches an omitted index row as an orphan", () => {
    const { doc } = poison(base, { kind: "omission", targetId: "rollback" });
    expect(auditDocument(doc).some((f) => f.startsWith("ORPHAN"))).toBe(true);
  });

  it("catches uniform confidence", () => {
    const doc = { ...base, index: base.index.map((e) => ({ ...e, conf: 1 })) };
    expect(auditDocument(doc).some((f) => f.startsWith("UNIFORM"))).toBe(true);
  });

  it("catches a dense lie by comparing ::dense against ::full", () => {
    const { doc } = poison(base, { kind: "dense-lie", targetId: "rollback", decoyId: "escalation" });
    expect(auditDocument(doc).some((f) => f.startsWith("DENSE DIVERGENCE"))).toBe(true);
  });

  it("catches a keyword hijack by comparing index keywords against ::full", () => {
    const { doc } = poison(base, { kind: "keyword-hijack", targetId: "rollback", decoyId: "snapshots" });
    expect(auditDocument(doc).some((f) => f.startsWith("KEYWORD DIVERGENCE"))).toBe(true);
  });
});

describe("suggestDecoy", () => {
  it("picks the least similar node", () => {
    const decoy = suggestDecoy(base, "rollback");
    expect(decoy).not.toBe("rollback");
    expect(base.index.some((e) => e.id === decoy)).toBe(true);
  });
});
