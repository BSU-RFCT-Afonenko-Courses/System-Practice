import { isNode, isCite } from "./native-ast.ts";
import type { Node } from "./native-ast.ts";
import { fail } from "../contracts/project.ts";
export type CatalogueReference = { token: string; key: string; style: string };
export const catalogueReference = (
  key: string,
  style: string,
): CatalogueReference => ({
  key,
  style,
  token: "course-reference:" + encodeURIComponent(key) + ":" +
    encodeURIComponent(style),
});
/** Existing QRC requests.lua Cite grammar and ordering, without catalogue lookup. */
export function catalogueCitations(
  node: unknown,
):
  | { reference: CatalogueReference; prefix: Node[]; suffix: Node[] }[]
  | undefined {
  if (!isNode(node) || node.t !== "Cite") return undefined;
  if (!isCite(node)) fail("QRC.REFERENCE_INVALID", "Повреждённый Cite/prefix/suffix/mode");
  const rows = node.c[0];
  const selected = rows.map((row) =>
    typeof row.citationId === "string" &&
    /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z][^:]*-[^:]+$/.test(row.citationId)
  );
  if (!selected.some(Boolean)) return undefined;
  if (!selected.every(Boolean)) {
    fail(
      "QRC.REFERENCE_INVALID",
      "Библиографические ссылки и ссылки каталога следует записывать отдельно",
    );
  }
  return rows.map((row) => {
    return {
      reference: catalogueReference(
        row.citationId,
        row.citationMode?.t === "SuppressAuthor" ? "number" : "default",
      ),
      prefix: structuredClone(row.citationPrefix),
      suffix: structuredClone(row.citationSuffix),
    };
  });
}
export function catalogueCiteInlines(
  rows: NonNullable<ReturnType<typeof catalogueCitations>>,
  link: (ref: CatalogueReference) => Node,
) {
  const out: Node[] = [];
  rows.forEach((row, i) => {
    if (i) out.push({ t: "Str", c: ";" }, { t: "Space" });
    out.push(...row.prefix);
    if (row.prefix.length) out.push({ t: "Space" });
    out.push(link(row.reference));
    if (row.suffix.length) out.push({ t: "Space" }, ...row.suffix);
  });
  return out;
}
