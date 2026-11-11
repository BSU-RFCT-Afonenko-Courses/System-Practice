/**
 * Читающий срез штатного default tree adapter vendored parse5.
 * Локальные vendor declarations импортируют .js, которые Deno не связывает
 * с соседними .d.ts. Здесь оставлены только используемый вход и поля его дерева;
 * doctype, fragment и nullable позиции/родители соответствуют vendor контракту.
 */
interface Offset {
  startOffset: number;
  endOffset: number;
}
interface Location extends Offset {
  startTag?: Offset;
  endTag?: Offset;
}
interface Document {
  nodeName: "#document";
  childNodes: ChildNode[];
}
interface DocumentFragment {
  nodeName: "#document-fragment";
  childNodes: ChildNode[];
}
interface Text {
  nodeName: "#text";
  value: string;
}
interface Comment {
  nodeName: "#comment";
  data: string;
}
interface DocumentType {
  nodeName: "#documentType";
  name: string;
  publicId: string;
  systemId: string;
}
export interface Element {
  nodeName: string;
  tagName: string;
  attrs: { name: string; value: string }[];
  childNodes: ChildNode[];
  parentNode: Element | Document | DocumentFragment | null;
  sourceCodeLocation?: Location | null;
}
type ChildNode = Element | Text | Comment | DocumentType;
export type Node = Document | DocumentFragment | ChildNode;
export function parse(
  html: string,
  options: { sourceCodeLocationInfo: boolean },
): Document;
