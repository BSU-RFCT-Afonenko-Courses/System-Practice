import { createMetrics as __createMetrics } from "../observability/bridge.ts";
const __metrics = __createMetrics("course-core");
import { dirname, resolve } from "stdlib/path";
import { commandInput, quartoExecutable } from "../infrastructure/process.ts";
import { diagnostic, type DiagnosticContext } from "../domain/diagnostics.ts";
import { isRecord, isNode, isCite, isContainer, isLink, isAttributes, isNodes, nodeAttributes, requireNodes } from "../document/native-ast.ts";
import type { Node, Attributes, CiteNode } from "../document/native-ast.ts";
import { decode, PandocDocumentSchema } from "../document/contracts.ts";

/** Resolve only a partitioned public fragment with the native bibliography engine.
 * Cite.content is supported only after citeproc and a matching generated entry.
 * A book's bibliography/nocite or another question never supplies public refs.
 */
async function resolveReferencesWork(
  blocks: Node[],
  document: unknown,
  root: string,
  context: DiagnosticContext,
  effectiveBase?: string,
): Promise<Node[]> {
  const citations = new Set<string>();
  const citationNodes: CiteNode[] = [];
  let reservedEntry = false;
  const walk = (v: unknown, f: (n: Record<string, unknown>) => void) => {
    if (Array.isArray(v)) {
      v.forEach((n) => walk(n, f));
      return;
    }
    if (isRecord(v)) {
      f(v);
      Object.values(v).forEach((n) => walk(n, f));
    }
  };
  walk(blocks, (n) => {
    if (n.t === "Cite") {
      if (!isCite(n)) throw diagnostic("BODY.CITATION_UNRESOLVED", "Повреждённый native Cite", context);
      citationNodes.push(n);
      for (const c of n.c[0]) citations.add(c.citationId);
    }
    if (isContainer(n) && n.t === "Div" && n.c[0][1].includes("csl-entry")) reservedEntry = true;
  });
  let resolved = blocks;
  if (citations.size) {
    const sourceBase = effectiveBase ?? dirname(resolve(root, context.source!));
    if (reservedEntry) {
      throw diagnostic(
        "BODY.BIBLIOGRAPHY_COLLISION",
        "Авторский csl-entry конфликтует с native библиографией",
        context,
      );
    }
    // Citeproc also scans metadata (including abstract). Only its citation
    // configuration/data belongs to this selected public question's input.
    if (!isRecord(document)) throw diagnostic("DOCUMENT_AST", "Нужен native document envelope", context);
    const input = decode(PandocDocumentSchema.omit({ blocks: true }), {
      "pandoc-api-version": document["pandoc-api-version"], meta: document.meta,
    }, "DOCUMENT_AST", context.source);
    const meta: Record<string, unknown> = {};
    for (
      const key of [
        "bibliography",
        "csl",
        "link-citations",
        "lang",
        "locale",
        "references",
        "citation-abbreviations",
      ]
    ) {
      if (input.meta[key] !== undefined) meta[key] = input.meta[key];
    }
    walk(meta, (n) => {
      if (n.t === "Cite") {
        throw diagnostic(
          "BODY.CITATION_UNRESOLVED",
          "Цитата в citation metadata не является публичным участником вопроса",
          context,
        );
      }
    });
    const args = [
      "pandoc",
      "--from=json",
      "--to=json",
      "--citeproc",
      "--resource-path=" + sourceBase,
    ];
    const witness: unknown = JSON.parse(
      await commandInput(
        quartoExecutable(),
        args,
        root,
        JSON.stringify({
          "pandoc-api-version": input["pandoc-api-version"],
          meta,
          blocks: [{ t: "Para", c: citationNodes }],
        }),
      ),
    );
    const entries = new Set<string>();
    const witnessDocument = decode(PandocDocumentSchema, witness, "DOCUMENT_AST", context.source);
    walk(witnessDocument.blocks, (n) => {
      if (isContainer(n) && n.t === "Div" && n.c[0][1].includes("csl-entry")) {
        entries.add(n.c[0][0]);
      }
    });
    if ([...citations].some((id) => !entries.has("ref-" + id))) {
      throw diagnostic(
        "BODY.CITATION_UNRESOLVED",
        "Native citeproc не создал библиографическую запись",
        context,
      );
    }
    // This witness contains no authored bibliography nodes. A successful
    // warning-only unknown citation cannot borrow a forged csl-entry.
    const output: unknown = JSON.parse(
      await commandInput(
        quartoExecutable(),
        args,
        root,
        JSON.stringify({
          "pandoc-api-version": input["pandoc-api-version"],
          meta,
          blocks,
        }),
      ),
    );
    function translate(v: unknown): unknown {
      if (Array.isArray(v)) {
        return v.flatMap((n) =>
          isCite(n) ? translate(n.c[1]) : [translate(n)]
        );
      }
      if (!isRecord(v)) return v;
      return Object.fromEntries(
        Object.entries(v).map(([k, n]) => [k, translate(n)]),
      );
    }
    const outputDocument = decode(PandocDocumentSchema, output, "DOCUMENT_AST", context.source);
    resolved = requireNodes(translate(outputDocument.blocks), context.source);
  }
  return resolved;
}

/** Pandoc Table semantic components carry Attr without a tagged node. */
export function nativeAttributes(node: unknown): Attributes[] {
  if (!isNode(node)) return [];
  if (node.t !== "Table") {
    const attr = nodeAttributes(node);
    if (node.t === "Figure") {
      if (!Array.isArray(node.c) || node.c.length !== 3 || !isAttributes(node.c[0]) || !isNodes(node.c[2])) throw diagnostic("DOCUMENT_AST", "Повреждённый Figure", {});
      return [node.c[0]];
    }
    return attr ? [attr] : [];
  }
  const malformed = (): never => { throw diagnostic("DOCUMENT_AST", "Повреждённый native Table/Attr", {}); };
  if (!Array.isArray(node.c) || node.c.length !== 6 || !isAttributes(node.c[0])) return malformed();
  const result: Attributes[] = [node.c[0]];
  const rowLists: unknown[] = [];
  function rows(value: unknown) {
    if (!Array.isArray(value)) return malformed();
    for (const row of value) {
      if (!Array.isArray(row) || row.length !== 2 || !isAttributes(row[0]) || !Array.isArray(row[1])) return malformed();
      result.push(row[0]);
      for (const cell of row[1]) {
        if (!Array.isArray(cell) || cell.length !== 5 || !isAttributes(cell[0]) || !isNode(cell[1]) || typeof cell[2] !== "number" || typeof cell[3] !== "number" || !isNodes(cell[4])) return malformed();
        result.push(cell[0]);
      }
    }
  }
  function edge(value: unknown) {
    if (!Array.isArray(value) || value.length !== 2 || !isAttributes(value[0])) return malformed();
    result.push(value[0]);
    rowLists.push(value[1]);
  }
  edge(node.c[3]);
  const bodies: unknown = node.c[4];
  if (!Array.isArray(bodies)) return malformed();
  for (const body of bodies) {
    if (!Array.isArray(body) || body.length !== 4 || !isAttributes(body[0]) || typeof body[1] !== "number") return malformed();
    result.push(body[0]);
    rowLists.push(body[2], body[3]);
  }
  edge(node.c[5]);
  rowLists.forEach(rows);
  return result;
}

/** Fragment links must resolve inside the complete standalone public question. */
function assertReferenceTargetsWork(
  blocks: Node[],
  context: DiagnosticContext,
) {
  const walk = (v: unknown, f: (n: Record<string, unknown>) => void) => {
    if (Array.isArray(v)) {
      v.forEach((n) => walk(n, f));
      return;
    }
    if (isRecord(v)) {
      f(v);
      Object.values(v).forEach((n) => walk(n, f));
    }
  };
  const ids = new Set<string>(), targets: string[] = [];
  walk(blocks, (n) => {
    for (const attr of nativeAttributes(n)) {
      if (attr?.[0]) {
        if (ids.has(attr[0])) {
          throw diagnostic(
            "BODY.REFERENCE_TARGET_DUPLICATE",
            "Повторная цель в самостоятельном вопросе: " + attr[0],
            context,
          );
        }
        ids.add(attr[0]);
      }
    }
    if (isLink(n) && n.t === "Link" && n.c[2][0].startsWith("#")) {
      targets.push(n.c[2][0].slice(1));
    }
  });
  if (targets.some((id) => !ids.has(id))) {
    throw diagnostic(
      "BODY.REFERENCE_TARGET_MISSING",
      "Ссылка не имеет цели в самостоятельном вопросе",
      context,
    );
  }
}

export const resolveReferences = __metrics.wrapAsync({
  id: "course-core.body-export.references.resolveReferences", kind: "phase",
}, resolveReferencesWork);
export const assertReferenceTargets = __metrics.wrapSync({
  id: "course-core.body-export.references.assertReferenceTargets", kind: "phase",
}, assertReferenceTargetsWork);
