import { describe, expect, it } from "vitest";
import { resolveContext, searchIndex, scoreEntry } from "@/lib/og/primitives";
import type { OgDocument } from "@/lib/og/types";

function doc(): OgDocument {
  return {
    meta: { title: "T" },
    index: [
      { id: "a", type: "step", scope: "all", conf: 0.9, keywords: ["deploy", "release"] },
      { id: "b", type: "step", scope: "ops", conf: 0.9, keywords: ["rollback", "revert"] },
      { id: "c", type: "concept", scope: "all", conf: 0.5, keywords: ["deploy", "canary"] },
      { id: "d", type: "concept", scope: "all", conf: 0.9, keywords: ["unrelated"] },
    ],
    nodes: [
      { id: "a", type: "step", scope: "all", dense: "deploy|release", full: "Deploy it.", code: [], edges: [{ type: "requires", target: "d" }] },
      { id: "b", type: "step", scope: "ops", dense: "rollback|revert", full: "Roll it back.", code: [], edges: [] },
      { id: "c", type: "concept", scope: "all", dense: "deploy|canary", full: "Canary explained.", code: [], edges: [] },
      { id: "d", type: "concept", scope: "all", dense: "unrelated", full: "Dependency body.", code: [], edges: [{ type: "requires", target: "a" }] },
    ],
    warnings: [],
  };
}

describe("searchIndex", () => {
  it("matches on keyword overlap", () => {
    const r = searchIndex(doc(), "how do I deploy");
    expect(r.matches.map((m) => m.entry.id)).toContain("a");
  });

  it("ranks higher confidence first when coverage ties", () => {
    const r = searchIndex(doc(), "deploy");
    expect(r.matches[0].entry.id).toBe("a"); // conf 0.9 beats c's 0.5
  });

  it("hides nodes outside the caller's role", () => {
    const r = searchIndex(doc(), "rollback", "all");
    expect(r.matches.map((m) => m.entry.id)).not.toContain("b");
    expect(r.hiddenByRole).toBe(1);
  });

  it("reveals role-scoped nodes to the right role", () => {
    const r = searchIndex(doc(), "rollback", "ops");
    expect(r.matches.map((m) => m.entry.id)).toContain("b");
  });

  it("never dead-ends on a no-match query", () => {
    const r = searchIndex(doc(), "zzzz nothing matches");
    expect(r.matches).toHaveLength(0);
    expect(r.text).toContain("no index entry matched");
    expect(r.text.length).toBeGreaterThan(20);
  });

  it("is cheap — Pass 1 stays small", () => {
    const r = searchIndex(doc(), "deploy");
    expect(r.tokens).toBeLessThan(120);
  });
});

describe("scoreEntry", () => {
  it("scores prefix matches", () => {
    const e = { id: "x", type: "step" as const, scope: "all", conf: 1, keywords: ["deploy"] };
    expect(scoreEntry(e, ["deploying"])).toBeGreaterThan(0);
  });
  it("scores zero with no overlap", () => {
    const e = { id: "x", type: "step" as const, scope: "all", conf: 1, keywords: ["deploy"] };
    expect(scoreEntry(e, ["banana"])).toBe(0);
  });
});

describe("resolveContext", () => {
  it("returns requested node content", () => {
    const r = resolveContext(doc(), ["a"]);
    expect(r.text).toContain("Deploy it.");
    expect(r.requested).toEqual(["a"]);
  });

  it("follows :requires edges", () => {
    const r = resolveContext(doc(), ["a"]);
    expect(r.followed).toContain("d");
    expect(r.text).toContain("Dependency body.");
  });

  it("respects the depth limit", () => {
    const r = resolveContext(doc(), ["a"], "all", 0);
    expect(r.followed).toHaveLength(0);
  });

  it("survives a :requires cycle", () => {
    // a -> d -> a
    const r = resolveContext(doc(), ["a"], "all", 5);
    expect(r.requested.concat(r.followed).sort()).toEqual(["a", "d"]);
  });

  it("does not leak nodes outside the role, and reports them as denied", () => {
    const r = resolveContext(doc(), ["b"], "all");
    expect(r.text).not.toContain("Roll it back.");
    expect(r.denied).toContain("b");
  });

  it("treats an unknown id the same as a forbidden one", () => {
    const unknown = resolveContext(doc(), ["nope"], "all");
    const forbidden = resolveContext(doc(), ["b"], "all");
    expect(unknown.denied).toEqual(["nope"]);
    expect(forbidden.denied).toEqual(["b"]);
    expect(unknown.text).toBe(forbidden.text);
  });

  it("does not auto-follow non-requires edges", () => {
    const d = doc();
    d.nodes[0].edges = [{ type: "see-also", target: "c" }];
    const r = resolveContext(d, ["a"]);
    expect(r.followed).not.toContain("c");
    expect(r.text).toContain("related: c (see-also)");
  });
});
