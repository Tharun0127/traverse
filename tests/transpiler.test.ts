import { describe, expect, it } from "vitest";
import { extractSections, inferNodeType, transpileSync } from "@/lib/og/transpiler";
import { parseOg } from "@/lib/og/parser";
import { serializeOg } from "@/lib/og/serializer";

const MD = `# Guide

Intro paragraph.

## Install

Run the installer.

\`\`\`bash
npm install
\`\`\`

## Configure

Then configure it. See [Install](#install).

### Warning

Never commit the config file.
`;

describe("stage 1 — structure", () => {
  const sections = extractSections(MD);

  it("makes a node per heading", () => {
    expect(sections.map((s) => s.id)).toEqual(["guide", "install", "configure", "warning"]);
  });

  it("nests by heading level", () => {
    expect(sections.find((s) => s.id === "warning")?.parentId).toBe("configure");
    expect(sections.find((s) => s.id === "install")?.parentId).toBe("guide");
  });

  it("lifts fenced code out of the body", () => {
    const install = sections.find((s) => s.id === "install")!;
    expect(install.code).toHaveLength(1);
    expect(install.code[0]).toEqual({ lang: "bash", content: "npm install" });
  });

  it("captures intra-document links", () => {
    expect(sections.find((s) => s.id === "configure")?.links).toContain("install");
  });
});

describe("stage 1 — content is verbatim", () => {
  it("copies body text byte-for-byte, never paraphrased", () => {
    const doc = transpileSync(MD);
    const warning = doc.nodes.find((n) => n.id === "warning")!;
    expect(warning.full).toContain("Never commit the config file.");
  });

  it("preserves every non-code line of the source across all nodes", () => {
    const doc = transpileSync(MD);
    const joined = doc.nodes.map((n) => n.full).join("\n");
    const sourceLines = MD.split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("```") && l !== "npm install")
      .map((l) => l.replace(/^#+\s*/, ""));
    for (const line of sourceLines) {
      expect(joined).toContain(line);
    }
  });
});

describe("stage 2 — metadata", () => {
  it("generates dense summaries and index keywords", () => {
    const doc = transpileSync(MD);
    for (const n of doc.nodes) expect(n.dense.length).toBeGreaterThan(0);
    for (const e of doc.index) expect(e.keywords.length).toBeGreaterThan(0);
  });

  it("keeps dense short — Pass 2 must stay cheap", () => {
    const doc = transpileSync(MD);
    for (const n of doc.nodes) expect(n.dense.length).toBeLessThan(120);
  });

  it("runs with no API key — deterministic fallback", () => {
    const a = transpileSync(MD);
    const b = transpileSync(MD);
    expect(serializeOg(a)).toBe(serializeOg(b));
  });
});

describe("stage 3 — edges", () => {
  const doc = transpileSync(MD);

  it("adds :contains from nesting", () => {
    const warning = doc.nodes.find((n) => n.id === "warning")!;
    expect(warning.edges).toContainEqual({ type: "contains", target: "configure" });
  });

  it("adds :see-also from links", () => {
    const configure = doc.nodes.find((n) => n.id === "configure")!;
    expect(configure.edges).toContainEqual({ type: "see-also", target: "install" });
  });

  it("adds :precedes between siblings", () => {
    const configure = doc.nodes.find((n) => n.id === "configure")!;
    expect(configure.edges.some((e) => e.type === "precedes" && e.target === "install")).toBe(true);
  });
});

describe("inferNodeType", () => {
  const t = (title: string, body: string) =>
    inferNodeType({ id: "x", title, level: 2, body, code: [], links: [] });

  it("detects warnings", () => expect(t("Warning", "Never do this.")).toBe("warning"));
  it("detects steps from code", () =>
    expect(
      inferNodeType({ id: "x", title: "Setup", level: 2, body: "", code: [{ lang: "sh", content: "ls" }], links: [] })
    ).toBe("step"));
  it("detects examples", () => expect(t("Example usage", "like so")).toBe("example"));
  it("falls back to concept", () => expect(t("Background", "Some prose about things.")).toBe("concept"));
});

describe("end to end", () => {
  it("transpiles then parses back identically", () => {
    const doc = transpileSync(MD, { title: "Guide" });
    const reparsed = parseOg(serializeOg(doc));
    expect(reparsed.nodes.map((n) => n.id)).toEqual(doc.nodes.map((n) => n.id));
    expect(reparsed.index.map((e) => e.id)).toEqual(doc.index.map((e) => e.id));
    expect(reparsed.warnings.filter((w) => w.includes("absent from ::index"))).toHaveLength(0);
  });
});
