import { fail } from "../contracts/project.ts";
// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
/** Нативные узлы Pandoc: payload уточняется только в месте чтения. */
export type Node = { t: string; c?: unknown };
export type Attributes = [string, string[], [string, string][]];
export type ContainerNode = Node & { t: "Div" | "Span"; c: [Attributes, Node[]] };
export type CodeNode = Node & { t: "Code" | "CodeBlock"; c: [Attributes, string] };
export type HeaderNode = Node & { t: "Header"; c: [number, Attributes, Node[]] };
export type ListNode = Node & { t: "BulletList"; c: Node[][] };
export type LinkNode = Node & { t: "Link" | "Image"; c: [Attributes, Node[], [string, string]] };
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const isNode = (value: unknown): value is Node =>
  isRecord(value) && typeof value.t === "string";
export const isNodes = (value: unknown): value is Node[] =>
  Array.isArray(value) && value.every(isNode);
/** Только массив узлов с tag; payload известных узлов проверяет читающий guard. */
export const NativeNodesSchema = z.array(z.unknown()).transform((value, context) => {
  if (isNodes(value)) return value;
  context.addIssue({ code: "custom", message: "Ожидается массив native узлов" });
  return z.NEVER;
});
export const isAttributes = (value: unknown): value is Attributes =>
  Array.isArray(value) && value.length === 3 && typeof value[0] === "string" &&
  Array.isArray(value[1]) && value[1].every((v: unknown) => typeof v === "string") &&
  Array.isArray(value[2]) && value[2].every((v: unknown) =>
    Array.isArray(v) && v.length === 2 && v.every((x: unknown) => typeof x === "string")
  );
export const isContainer = (value: unknown): value is ContainerNode =>
  isNode(value) && (value.t === "Div" || value.t === "Span") &&
  Array.isArray(value.c) && value.c.length === 2 && isAttributes(value.c[0]) && isNodes(value.c[1]);
export const isCode = (value: unknown): value is CodeNode =>
  isNode(value) && (value.t === "Code" || value.t === "CodeBlock") &&
  Array.isArray(value.c) && value.c.length === 2 && isAttributes(value.c[0]) && typeof value.c[1] === "string";
export const isHeader = (value: unknown): value is HeaderNode =>
  isNode(value) && value.t === "Header" && Array.isArray(value.c) && value.c.length === 3 &&
  typeof value.c[0] === "number" && Number.isInteger(value.c[0]) && isAttributes(value.c[1]) && isNodes(value.c[2]);
export const isBulletList = (value: unknown): value is ListNode =>
  isNode(value) && value.t === "BulletList" && Array.isArray(value.c) && value.c.every(isNodes);
export const isLink = (value: unknown): value is LinkNode =>
  isNode(value) && (value.t === "Link" || value.t === "Image") && Array.isArray(value.c) && value.c.length === 3 &&
  isAttributes(value.c[0]) && isNodes(value.c[1]) && Array.isArray(value.c[2]) && value.c[2].length === 2 &&
  value.c[2].every((v: unknown) => typeof v === "string");
/** Повреждённый известный tag нельзя трактовать как чужой неприменимый узел. */
export function nodeAttributes(value: unknown, source?: string): Attributes | undefined {
  if (!isNode(value)) return undefined;
  if (value.t === "Div" || value.t === "Span") {
    if (!isContainer(value)) fail("DOCUMENT_AST", "Некорректный " + value.t + "/Attr", source);
    return value.c[0];
  }
  if (value.t === "CodeBlock" || value.t === "Code") {
    if (!isCode(value)) fail("DOCUMENT_AST", "Некорректный " + value.t + "/Attr", source);
    return value.c[0];
  }
  if (value.t === "Header") {
    if (!isHeader(value)) fail("DOCUMENT_AST", "Некорректный Header/Attr", source);
    return value.c[1];
  }
  if (value.t === "Link" || value.t === "Image") {
    if (!isLink(value)) fail("DOCUMENT_AST", "Некорректный " + value.t + "/target", source);
    return value.c[0];
  }
  if ((value.t === "Para" || value.t === "Plain") && !isNodes(value.c)) fail("DOCUMENT_AST", "Некорректный " + value.t, source);
  if (value.t === "BulletList" && !isBulletList(value)) fail("DOCUMENT_AST", "Некорректный BulletList", source);
  return undefined;
}
export function requireNodes(value: unknown, source?: string): Node[] {
  if (!isNodes(value)) fail("DOCUMENT_AST", "Ожидается массив native узлов", source);
  return value;
}

export type Citation = { citationId: string; citationPrefix: Node[]; citationSuffix: Node[]; citationMode: Node };
export type CiteNode = Node & { t: "Cite"; c: [Citation[], Node[]] };
const isCitation = (value: unknown): value is Citation =>
  isRecord(value) && typeof value.citationId === "string" && isNodes(value.citationPrefix) && isNodes(value.citationSuffix) &&
  isNode(value.citationMode) && ["NormalCitation", "AuthorInText", "SuppressAuthor"].includes(value.citationMode.t);
export const isCite = (value: unknown): value is CiteNode =>
  isNode(value) && value.t === "Cite" && Array.isArray(value.c) && value.c.length === 2 &&
  Array.isArray(value.c[0]) && value.c[0].every(isCitation) && isNodes(value.c[1]);
