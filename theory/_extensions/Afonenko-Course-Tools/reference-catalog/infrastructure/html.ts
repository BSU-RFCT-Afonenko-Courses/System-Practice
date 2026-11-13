import { createMetrics as __createMetrics } from "../observability/bridge.ts";
const __metrics = __createMetrics("reference-catalog");
// @deno-types="../types/parse5/dist/index.d.ts"
import { parse, defaultTreeAdapter } from "../vendor/parse5/dist/index.js";
// Тип дерева принадлежит parse5; адаптер не поддерживает параллельную модель HTML.
import type {
  Element as ParseElement,
  Node as ParseNode,
  ChildNode as ParseChildNode,
} from "../types/parse5/dist/tree-adapters/default.d.ts";
export type Element = ParseElement;
export type Node = ParseNode;
export type ChildNode = ParseChildNode;
export function elements(node: Node): Element[] {
  const out: Element[] = [];
  const visit = (item: Node) => {
    if ("tagName" in item) out.push(item);
    if ("childNodes" in item) item.childNodes.forEach(visit);
  };
  visit(node);
  return out;
}
export function attr(node: Element, name: string): string | undefined {
  return node.attrs.find((a) => a.name === name)?.value;
}
export function hasClass(node: Element, name: string): boolean {
  return (attr(node, "class") ?? "").split(/\s+/).includes(name);
}
export function content(node: Node): string {
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(content).join("") : "";
}
export function inner(html: string, node: Element): string {
  const loc = node.sourceCodeLocation;
  if (!loc?.startTag || !loc.endTag)
    throw new Error(`QRC отсутствуют позиции HTML-элемента ${node.tagName}`);
  return html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
}
export function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
export interface Edit {
  start: number;
  end: number;
  value: string;
}
function replaceImpl(html: string, edits: Edit[]): string {
  edits.sort((a, b) => b.start - a.start);
  let end = html.length;
  for (const edit of edits) {
    if (edit.end > end) throw new Error("QRC пересекающиеся изменения HTML");
    html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
    end = edit.start;
  }
  return html;
}
function parseHtmlImpl(html: string) {
  return parse(html, { sourceCodeLocationInfo: true });
}

export const replace = __metrics.wrapSync(
  { id: "reference-catalog.infrastructure.html.replace", kind: "io" },
  replaceImpl,
);
export const parseHtml = __metrics.wrapSync(
  { id: "reference-catalog.infrastructure.html.parseHtml", kind: "io" },
  parseHtmlImpl,
);

/** Изменения сохраняют реальное дерево parse5, включая двусторонние связи. */
export function textNode(value: string): ChildNode {
  return defaultTreeAdapter.createTextNode(value);
}
export function span(parent: Element, className: string, children: ChildNode[]): Element {
  const node = defaultTreeAdapter.createElement("span", parent.namespaceURI, [
    { name: "class", value: className },
  ]);
  node.parentNode = parent;
  for (const child of children) defaultTreeAdapter.appendChild(node, child);
  return node;
}
export function location(node: Element) {
  const position = node.sourceCodeLocation;
  if (!position) throw new Error(`QRC отсутствуют позиции HTML-элемента ${node.tagName}`);
  return position;
}
