/**
 * Serializer for .og. parseOg(serializeOg(doc)) must equal doc, which is what
 * tests/parser.test.ts asserts. Round-trip fidelity is the property that makes
 * the format safe to edit by hand and by tool.
 */

import type { OgDocument, OgNode } from "./types";

const IND = "  ";

function indentBlock(text: string, pad: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

function serializeNode(node: OgNode): string {
  const out: string[] = [];
  out.push(`::node[id=${node.id} type=${node.type} scope=${node.scope}]`);

  if (node.dense) {
    out.push(`${IND}::dense`);
    out.push(indentBlock(node.dense, IND + IND));
    out.push(`${IND}::end`);
  }

  if (node.full) {
    out.push(`${IND}::full`);
    out.push(indentBlock(node.full, IND + IND));
    out.push(`${IND}::end`);
  }

  for (const c of node.code) {
    out.push(`${IND}::code[lang=${c.lang}]`);
    out.push(indentBlock(c.content, IND + IND));
    out.push(`${IND}::end`);
  }

  if (node.edges.length) {
    out.push(`${IND}::edges`);
    for (const e of node.edges) {
      const attrs = e.attrs
        ? " " +
          Object.entries(e.attrs)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")
        : "";
      out.push(`${IND}${IND}->[:${e.type}${attrs}] ${e.target}`);
    }
    out.push(`${IND}::end`);
  }

  if (node.assertion) {
    const a = node.assertion;
    out.push(`${IND}::assertion`);
    if (a.trigger) out.push(`${IND}${IND}trigger: ${a.trigger}`);
    if (a.check) out.push(`${IND}${IND}check: ${a.check}`);
    if (a.onPass) out.push(`${IND}${IND}on-pass: ${a.onPass}`);
    if (a.onFail) out.push(`${IND}${IND}on-fail: ${a.onFail}`);
    if (a.onFailAfterRetries)
      out.push(`${IND}${IND}on-fail-after-retries: ${a.onFailAfterRetries}`);
    if (a.timeout) out.push(`${IND}${IND}timeout: ${a.timeout}`);
    out.push(`${IND}::end`);
  }

  out.push("::end");
  return out.join("\n");
}

export function serializeOg(doc: OgDocument): string {
  const out: string[] = [];

  out.push("::meta");
  for (const [k, v] of Object.entries(doc.meta)) out.push(`${IND}${k}: ${v}`);
  out.push("::end");
  out.push("");

  out.push("::index");
  out.push(`${IND}# id | type | scope | conf | keywords`);
  for (const e of doc.index) {
    out.push(
      `${IND}${e.id} | ${e.type} | ${e.scope} | ${e.conf.toFixed(2)} | ${e.keywords.join(",")}`
    );
  }
  out.push("::end");
  out.push("");

  for (const n of doc.nodes) {
    out.push(serializeNode(n));
    out.push("");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
