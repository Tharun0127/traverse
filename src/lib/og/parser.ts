/**
 * Parser for the .og block syntax.
 *
 *   ::meta / ::end                        key: value pairs
 *   ::index / ::end                       id | type | scope | conf | keywords
 *   ::node[id= type= scope=] / ::end      contains the blocks below
 *     ::dense / ::end                     routing summary
 *     ::full / ::end                      verbatim content
 *     ::code[lang=] / ::end               code, repeatable
 *     ::edges / ::end                     ->[:type] target
 *     ::assertion / ::end                 trigger/check/on-pass/on-fail
 *
 * Line-oriented with a small block stack. Indentation is cosmetic and stripped,
 * except inside ::full and ::code where it is preserved relative to the block.
 */

import {
  EDGE_TYPES,
  isEdgeType,
  isNodeType,
  type NodeType,
  type OgAssertion,
  type OgDocument,
  type OgEdge,
  type OgIndexEntry,
  type OgNode,
} from "./types";

const BLOCK_OPEN = /^::(meta|index|node|dense|full|code|edges|assertion)\b(.*)$/;
const BLOCK_END = /^::end\s*$/;

/** Parse `[id=x type=y scope=z]` or `[lang=bash]` into a record. */
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner) return attrs;
  // key=value pairs, values may be quoted
  const re = /(\w[\w-]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    attrs[m[1]] = m[3] ?? m[4] ?? m[2];
  }
  return attrs;
}

/**
 * Parse an edge line: `->[:precedes] verify` or `->[:retry limit=2] install`.
 * Returns null if the line is not an edge.
 */
export function parseEdgeLine(line: string): OgEdge | null {
  const m = line.trim().match(/^->\s*\[\s*:\s*([\w-]+)([^\]]*)\]\s*(.+)$/);
  if (!m) return null;
  const rawType = m[1].trim();
  const attrs = parseAttrs(m[2] ?? "");
  const target = m[3].trim();
  if (!isEdgeType(rawType)) {
    // Unknown edge types are kept rather than dropped so a round-trip is lossless,
    // but they never auto-follow. See DECISIONS.md #6.
    return {
      type: rawType as OgEdge["type"],
      target,
      attrs: Object.keys(attrs).length ? attrs : undefined,
    };
  }
  return {
    type: rawType,
    target,
    attrs: Object.keys(attrs).length ? attrs : undefined,
  };
}

/** Strip the smallest common indentation across non-empty lines. */
function dedent(lines: string[]): string {
  const meaningful = lines.filter((l) => l.trim().length > 0);
  if (meaningful.length === 0) return "";
  const indent = Math.min(
    ...meaningful.map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0)
  );
  return lines.map((l) => l.slice(indent)).join("\n").replace(/\s+$/, "");
}

function parseIndexRows(lines: string[], warnings: string[]): OgIndexEntry[] {
  const out: OgIndexEntry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue; // header/comment row
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 5) {
      warnings.push(`index row has ${parts.length} columns, expected 5: "${line}"`);
      continue;
    }
    const [id, type, scope, conf, keywords] = parts;
    if (!isNodeType(type)) {
      warnings.push(`index row "${id}" has unknown type "${type}"`);
    }
    const confNum = Number(conf);
    out.push({
      id,
      type: (isNodeType(type) ? type : "concept") as NodeType,
      scope: scope || "all",
      conf: Number.isFinite(confNum) ? confNum : 0,
      keywords: keywords
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
    });
  }
  return out;
}

function parseAssertion(lines: string[]): OgAssertion {
  const a: OgAssertion = {};
  for (const raw of lines) {
    const line = raw.trim();
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    switch (key) {
      case "trigger":
        a.trigger = value;
        break;
      case "check":
        a.check = value;
        break;
      case "on-pass":
        a.onPass = value;
        break;
      case "on-fail":
        a.onFail = value;
        break;
      case "on-fail-after-retries":
        a.onFailAfterRetries = value;
        break;
      case "timeout":
        a.timeout = value;
        break;
    }
  }
  return a;
}

export function parseOg(source: string): OgDocument {
  const warnings: string[] = [];
  const doc: OgDocument = { meta: {}, index: [], nodes: [], warnings };

  const lines = source.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const open = trimmed.match(BLOCK_OPEN);

    if (!open) {
      i++;
      continue;
    }

    const kind = open[1];
    const attrs = parseAttrs(open[2] ?? "");

    // Collect the body of this block, tracking nesting so a ::node containing
    // ::dense/::full/... consumes the right ::end.
    const body: string[] = [];
    let depth = 1;
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (BLOCK_OPEN.test(t)) depth++;
      if (BLOCK_END.test(t)) {
        depth--;
        if (depth === 0) break;
      }
      body.push(lines[i]);
      i++;
    }
    if (depth !== 0) warnings.push(`unterminated ::${kind} block`);
    i++; // consume ::end

    switch (kind) {
      case "meta": {
        for (const raw of body) {
          const l = raw.trim();
          const idx = l.indexOf(":");
          if (idx === -1) continue;
          doc.meta[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
        }
        break;
      }
      case "index": {
        doc.index.push(...parseIndexRows(body, warnings));
        break;
      }
      case "node": {
        doc.nodes.push(parseNodeBody(attrs, body, warnings));
        break;
      }
      default:
        warnings.push(`::${kind} found outside a ::node block, ignored`);
    }
  }

  // Cross-check: every index entry should have a node, and vice versa.
  const nodeIds = new Set(doc.nodes.map((n) => n.id));
  for (const e of doc.index) {
    if (!nodeIds.has(e.id)) warnings.push(`index lists "${e.id}" but no such node exists`);
  }
  const indexIds = new Set(doc.index.map((e) => e.id));
  for (const n of doc.nodes) {
    if (!indexIds.has(n.id)) {
      // This is the omission attack in R5 / the audit. Parsing must not repair it,
      // only report it, or the poisoning demo would be silently undone.
      warnings.push(`node "${n.id}" exists but is absent from ::index (unreachable via search_index)`);
    }
  }

  return doc;
}

function parseNodeBody(
  attrs: Record<string, string>,
  body: string[],
  warnings: string[]
): OgNode {
  const node: OgNode = {
    id: attrs.id ?? "",
    type: (isNodeType(attrs.type ?? "") ? attrs.type : "concept") as NodeType,
    scope: attrs.scope ?? "all",
    dense: "",
    full: "",
    code: [],
    edges: [],
  };
  if (!node.id) warnings.push("node without an id attribute");

  let i = 0;
  while (i < body.length) {
    const trimmed = body[i].trim();
    const open = trimmed.match(BLOCK_OPEN);
    if (!open) {
      i++;
      continue;
    }
    const kind = open[1];
    const subAttrs = parseAttrs(open[2] ?? "");
    const sub: string[] = [];
    let depth = 1;
    i++;
    while (i < body.length) {
      const t = body[i].trim();
      if (BLOCK_OPEN.test(t)) depth++;
      if (BLOCK_END.test(t)) {
        depth--;
        if (depth === 0) break;
      }
      sub.push(body[i]);
      i++;
    }
    i++;

    switch (kind) {
      case "dense":
        node.dense = dedent(sub).trim();
        break;
      case "full":
        node.full = dedent(sub);
        break;
      case "code":
        node.code.push({ lang: subAttrs.lang ?? "text", content: dedent(sub) });
        break;
      case "edges":
        for (const l of sub) {
          if (!l.trim()) continue;
          const e = parseEdgeLine(l);
          if (e) node.edges.push(e);
          else warnings.push(`unparsable edge line in "${node.id}": "${l.trim()}"`);
        }
        break;
      case "assertion":
        node.assertion = parseAssertion(sub);
        break;
      default:
        warnings.push(`unexpected ::${kind} inside node "${node.id}"`);
    }
  }

  return node;
}

export { EDGE_TYPES };
