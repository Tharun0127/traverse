import { describe, expect, it } from "vitest";
import { parseOg, parseEdgeLine } from "@/lib/og/parser";
import { serializeOg } from "@/lib/og/serializer";
import type { OgDocument } from "@/lib/og/types";

const SAMPLE = `::meta
  title: Example Runbook
  version: 1.0
::end

::index
  # id | type | scope | conf | keywords
  deploy | step | all | 0.95 | deploy,release
  verify | step | ops | 0.80 | verify,check
::end

::node[id=deploy type=step scope=all]
  ::dense
  deploy|production|release
  ::end
  ::full
  Deploy application to production environment.
  Second line preserved.
  ::end
  ::code[lang=bash]
  ./deploy.sh --prod
  ::end
  ::edges
    ->[:precedes] verify
  ::end
::end

::node[id=verify type=step scope=ops]
  ::dense
  verify|check|health
  ::end
  ::full
  Verify the rollout.
  ::end
  ::edges
    ->[:requires] deploy
  ::end
  ::assertion
    trigger: after[deploy]
    check: command('curl -s /health') matches '200'
    on-pass: ->[:proceed] done
    on-fail: ->[:retry limit=2] deploy
    timeout: 30s
  ::end
::end
`;

describe("parser", () => {
  const doc = parseOg(SAMPLE);

  it("reads meta", () => {
    expect(doc.meta.title).toBe("Example Runbook");
    expect(doc.meta.version).toBe("1.0");
  });

  it("reads index rows and skips the comment header", () => {
    expect(doc.index).toHaveLength(2);
    expect(doc.index[0]).toMatchObject({ id: "deploy", type: "step", scope: "all", conf: 0.95 });
    expect(doc.index[0].keywords).toEqual(["deploy", "release"]);
  });

  it("reads nodes with all sub-blocks", () => {
    expect(doc.nodes).toHaveLength(2);
    const deploy = doc.nodes[0];
    expect(deploy.id).toBe("deploy");
    expect(deploy.dense).toBe("deploy|production|release");
    expect(deploy.full).toContain("Deploy application to production");
    expect(deploy.full).toContain("Second line preserved.");
    expect(deploy.code[0]).toEqual({ lang: "bash", content: "./deploy.sh --prod" });
    expect(deploy.edges).toEqual([{ type: "precedes", target: "verify" }]);
  });

  it("reads assertions", () => {
    const verify = doc.nodes[1];
    expect(verify.assertion?.trigger).toBe("after[deploy]");
    expect(verify.assertion?.check).toContain("curl");
    expect(verify.assertion?.timeout).toBe("30s");
    expect(verify.assertion?.onFail).toContain("deploy");
  });

  it("does not repair a missing index row, it reports it", () => {
    const noIndex = parseOg(SAMPLE.replace("  deploy | step | all | 0.95 | deploy,release\n", ""));
    expect(noIndex.warnings.some((w) => w.includes("absent from ::index"))).toBe(true);
  });

  it("round-trips losslessly", () => {
    const again = parseOg(serializeOg(doc));
    const strip = (d: OgDocument) => ({ meta: d.meta, index: d.index, nodes: d.nodes });
    expect(strip(again)).toEqual(strip(doc));
  });

  it("round-trips twice to the same text", () => {
    const once = serializeOg(doc);
    const twice = serializeOg(parseOg(once));
    expect(twice).toBe(once);
  });
});

describe("parseEdgeLine", () => {
  it("parses a plain edge", () => {
    expect(parseEdgeLine("->[:precedes] verify")).toEqual({ type: "precedes", target: "verify" });
  });
  it("parses edge attributes", () => {
    expect(parseEdgeLine("->[:requires limit=2] deploy")).toEqual({
      type: "requires",
      target: "deploy",
      attrs: { limit: "2" },
    });
  });
  it("tolerates spacing", () => {
    expect(parseEdgeLine("  -> [ : see-also ]  other-node ")).toEqual({
      type: "see-also",
      target: "other-node",
    });
  });
  it("returns null for a non-edge", () => {
    expect(parseEdgeLine("just some text")).toBeNull();
  });
});
