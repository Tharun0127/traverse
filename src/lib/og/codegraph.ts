/**
 * THE CODE BRIDGE.
 *
 * ObjectGraph is a *document* format. Superbrain's TokenFold is a *code* context
 * engine. They share a thesis — traverse, don't inject — but not a domain, and a
 * result on documents does not automatically transfer to repositories.
 *
 * So this module applies the identical two primitives to source code. Nodes are
 * symbols (functions, classes, interfaces, types) instead of headings; `:requires`
 * edges are call and reference dependencies instead of prose ordering. Nothing
 * else changes: search_index and resolve_context work unmodified.
 *
 * The point is to test whether the traversal win survives the domain change, and
 * whether the poisoning attack does too. Both answers are on the /code page.
 *
 * Deliberately a lightweight structural parser rather than the TypeScript compiler
 * API: it must run in a serverless function inside the Vercel bundle budget, and a
 * full type-checker is far more machinery than symbol extraction needs.
 * See DECISIONS.md #10.
 */

import type { OgDocument, OgEdge, OgIndexEntry, OgNode } from "./types";

export interface CodeSymbol {
  id: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "import";
  name: string;
  signature: string;
  body: string;
  startLine: number;
  endLine: number;
  /** Symbols referenced from inside this one. */
  refs: string[];
  doc?: string;
}

const DECL = new RegExp(
  [
    // export? async? function name(
    /(?<fn>^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(?<fnName>\w+))/.source,
    // export? class Name
    /(?<cls>^\s*(?:export\s+)?(?:abstract\s+)?class\s+(?<clsName>\w+))/.source,
    // export? interface Name
    /(?<iface>^\s*(?:export\s+)?interface\s+(?<ifaceName>\w+))/.source,
    // export? type Name =
    /(?<ty>^\s*(?:export\s+)?type\s+(?<tyName>\w+)\s*=)/.source,
    // export? const name = (...) =>   /  export? const NAME =
    /(?<cst>^\s*(?:export\s+)?(?:const|let|var)\s+(?<cstName>\w+)\s*[:=])/.source,
  ].join("|"),
  "m"
);

const RESERVED = new Set(
  ("if else for while switch case return new typeof instanceof await async function class const let var " +
    "import export from as try catch finally throw this super null undefined true false void delete in of " +
    "string number boolean any unknown never object symbol bigint Promise Array Record Map Set Object JSON " +
    "console require module exports default extends implements interface type enum public private protected " +
    "static readonly abstract get set yield do break continue with debugger").split(/\s+/)
);

/** Count braces outside strings and comments so we can find a declaration's end. */
function scanBlockEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let started = false;
  let inBlockComment = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    let inString: string | null = null;

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const next = line[c + 1];

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          c++;
        }
        continue;
      }
      if (inString) {
        if (ch === "\\") c++;
        else if (ch === inString) inString = null;
        continue;
      }
      if (ch === "/" && next === "/") break; // line comment
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        c++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        continue;
      }
      if (ch === "{") {
        depth++;
        started = true;
      } else if (ch === "}") {
        depth--;
        if (started && depth === 0) return i;
      }
    }

    // Single-line declarations (type aliases, simple consts) end at the line.
    if (!started && /[;]\s*$/.test(line.trimEnd()) && i > startIdx - 1) return i;
  }
  return Math.min(startIdx + 40, lines.length - 1);
}

/** Grab a preceding JSDoc or // comment run. */
function precedingDoc(lines: string[], declIdx: number): string | undefined {
  const out: string[] = [];
  let i = declIdx - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  if (i >= 0 && lines[i].trim().endsWith("*/")) {
    while (i >= 0) {
      out.unshift(lines[i]);
      if (lines[i].trim().startsWith("/*")) break;
      i--;
    }
  } else {
    while (i >= 0 && lines[i].trim().startsWith("//")) {
      out.unshift(lines[i]);
      i--;
    }
  }
  const text = out
    .join("\n")
    .replace(/^\s*\/\*+|\*+\/\s*$/g, "")
    .replace(/^\s*\*\s?/gm, "")
    .replace(/^\s*\/\/\s?/gm, "")
    .trim();
  return text || undefined;
}

export function extractSymbols(source: string, filename = "module"): CodeSymbol[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const symbols: CodeSymbol[] = [];
  const taken = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DECL);
    if (!m || !m.groups) continue;

    const g = m.groups;
    let kind: CodeSymbol["kind"] = "const";
    let name = "";
    if (g.fnName) {
      kind = "function";
      name = g.fnName;
    } else if (g.clsName) {
      kind = "class";
      name = g.clsName;
    } else if (g.ifaceName) {
      kind = "interface";
      name = g.ifaceName;
    } else if (g.tyName) {
      kind = "type";
      name = g.tyName;
    } else if (g.cstName) {
      kind = "const";
      name = g.cstName;
    }
    if (!name) continue;

    const endIdx = scanBlockEnd(lines, i);
    const body = lines.slice(i, endIdx + 1).join("\n");

    let id = name;
    let n = 2;
    while (taken.has(id)) id = `${name}-${n++}`;
    taken.add(id);

    symbols.push({
      id,
      kind,
      name,
      signature: lines[i].trim().replace(/\s*\{\s*$/, ""),
      body,
      startLine: i + 1,
      endLine: endIdx + 1,
      refs: [],
      doc: precedingDoc(lines, i),
    });

    i = endIdx;
  }

  // Second pass: which symbols does each one reference?
  const names = new Map(symbols.map((s) => [s.name, s.id]));
  for (const sym of symbols) {
    const found = new Set<string>();
    for (const token of sym.body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const t = token[1];
      if (RESERVED.has(t) || t === sym.name) continue;
      const targetId = names.get(t);
      if (targetId) found.add(targetId);
    }
    sym.refs = [...found];
  }

  return symbols.map((s) => ({ ...s, id: `${filename}:${s.id}`, refs: s.refs.map((r) => `${filename}:${r}`) }));
}

/** Build an .og document from source code. Same format, same primitives. */
export function codeToOg(source: string, filename: string): OgDocument {
  const symbols = extractSymbols(source, filename);
  const nodes: OgNode[] = [];
  const index: OgIndexEntry[] = [];

  const typeFor = (k: CodeSymbol["kind"]): OgNode["type"] =>
    k === "interface" || k === "type" ? "concept" : k === "function" ? "step" : "concept";

  for (const sym of symbols) {
    const edges: OgEdge[] = sym.refs.map((r) => ({ type: "requires", target: r }));

    // Routing keywords come from the identifier, split on camelCase and snake_case,
    // plus any words in the doc comment. Deterministic — no model involved.
    const identWords = sym.name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((w) => w.toLowerCase());
    const docWords = (sym.doc ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .slice(0, 6);
    const keywords = [...new Set([...identWords, sym.kind, ...docWords])].slice(0, 8);

    nodes.push({
      id: sym.id,
      type: typeFor(sym.kind),
      scope: "all",
      dense: [sym.kind, ...identWords].join("|"),
      full:
        `${sym.signature}\n` +
        `// ${filename}:${sym.startLine}-${sym.endLine}` +
        (sym.doc ? `\n// ${sym.doc.split("\n").join("\n// ")}` : ""),
      code: [{ lang: "typescript", content: sym.body }],
      edges,
    });

    index.push({
      id: sym.id,
      type: typeFor(sym.kind),
      scope: "all",
      conf: sym.doc ? 0.95 : 0.8,
      keywords,
    });
  }

  return {
    meta: {
      title: filename,
      version: "1.0",
      generator: "traverse-codegraph",
      symbols: String(symbols.length),
    },
    index,
    nodes,
    warnings: [],
  };
}
