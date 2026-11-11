import {createMetrics as __createMetrics} from "../observability/bridge.ts";
const __metrics=__createMetrics("reference-catalog");
import { attr, elements, hasClass, type Element, type Node } from "./html.ts";
import type { Page } from "./pages.ts";
import { relative, isAbsolute } from "./files.ts";
import { isRecord } from "./import-config.ts";
export interface SearchIndex { path: string; mount?: string }
export interface SearchRow extends Record<string, unknown> { href: string; text: string }
export interface UpdatedSearchIndex { index: SearchIndex; rows: SearchRow[] }
function isSearchRow(row: unknown): row is SearchRow {
  return isRecord(row) && typeof row.href === "string" && typeof row.text === "string";
}
export function searchIndexBase(root: string, index: SearchIndex): string {
  if (index.mount === undefined) return relative(root, index.path).replaceAll("\\", "/");
  const mount = index.mount.replaceAll("\\", "/");
  if (isAbsolute(mount) || /^[a-z][a-z0-9+.-]*:/i.test(mount) || mount.split("/").includes("..")) throw new Error(`QRC некорректный mount поискового индекса: ${index.mount}`);
  return mount === "" ? "search.json" : `${mount.replace(/\/$/, "")}/search.json`;
}
export function readable(node: Node): string {
  if ("tagName" in node && (["script", "style", "nav", "button"].includes(node.tagName) || hasClass(node, "anchorjs-link") || hasClass(node, "qrc-probes"))) return "";
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(readable).join(" ") : "";
}
/** Готовим индексы из окончательного дерева HTML, не меняя файлы. */
export async function prepareSearch(root: string, indexFiles: (string | SearchIndex)[], pages: Map<string, Page>): Promise<UpdatedSearchIndex[]> {
  const parsed = new Map<string, { main: Element | undefined; ids: Map<string, Element> }>();
  const updated: UpdatedSearchIndex[] = [];
  const rowsByPath = new Map<string, SearchRow[]>();
  for (const value of indexFiles) {
    const index = typeof value === "string" ? { path: value } : value;
    const file = index.path;
    let finalRows = rowsByPath.get(file);
    if (!finalRows) {
      const rows: unknown = JSON.parse(await Deno.readTextFile(file));
      if (!Array.isArray(rows)) throw new Error(`QRC неподдерживаемый поисковый индекс ${file}`);
      const sourceRows: readonly unknown[] = rows;
      finalRows = [];
      for (const row of sourceRows) {
        if (!isSearchRow(row)) throw new Error(`QRC неподдерживаемая запись поискового индекса ${file}`);
        finalRows.push(row);
      }
      rowsByPath.set(file, finalRows);
    }
    // Один physical path разделяет строки между mounts: последний mount
    // обновляет текст для всех его представлений, как при последовательной записи.
    const base = searchIndexBase(root, index);
    for (const row of finalRows) {
      const url = new URL(row.href, "https://qrc.invalid/" + base);
      const path = decodeURIComponent(url.pathname).slice(1);
      const page = pages.get(path);
      if (!page) continue;
      let selection = parsed.get(path);
      if (!selection) {
        const nodes = elements(page.root);
        const ids = new Map<string, Element>();
        for (const node of nodes) {
          const id = attr(node, "id");
          if (id !== undefined && !ids.has(id)) ids.set(id, node);
        }
        selection = { main: nodes.find((node) => node.tagName === "main"), ids };
        parsed.set(path, selection);
      }
      const fragment = decodeURIComponent(url.hash.slice(1));
      const selected = fragment ? selection.ids.get(fragment) : selection.main;
      if (selected) row.text = readable(selected).replace(/\s+/g, " ").trim();
    }
    updated.push({ index, rows: finalRows });
  }
  return updated;
}

/** Штатные индексы созданы до post-render; обновляем их текст из окончательного HTML. */
async function updateSearchImpl(root: string, indexFiles: (string | SearchIndex)[], pages: Map<string, Page>): Promise<UpdatedSearchIndex[]> {
  const updated = await prepareSearch(root, indexFiles, pages);
  const files = new Map(updated.map(({ index, rows }) => [index.path, JSON.stringify(rows, null, 2) + "\n"]));
  for (const [path, text] of files) await Deno.writeTextFile(path, text);
  return updated;
}

export const updateSearch = __metrics.wrapAsync({id:"reference-catalog.infrastructure.search.updateSearch",kind:"io"},updateSearchImpl);
