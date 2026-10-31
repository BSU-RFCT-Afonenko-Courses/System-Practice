import { dirname, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
/** Quarto JSONL contains declared data/resources, not a loaded-module trace. */
export function assertAssignmentDeclarations(
  rows: unknown,
  input: string,
  known: ReadonlySet<string>,
) {
  const invalid = (s: string): never =>
    fail("BODY.PRODUCER_DEPENDENCY_UNQUALIFIED", s);
  if (!Array.isArray(rows) || rows.length > 16384) {
    invalid("Нет bounded native data/resource declarations");
  }
  const path = (v: unknown) => {
    if (typeof v !== "string" || !v || v.includes("\0")) {
      invalid("Повреждённый declared path");
    }
    const name = v as string;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(name)) {
      invalid("Внешний declared resource вне frozen inputs");
    }
    if (!known.has(resolve(dirname(input), name))) {
      invalid("Неизвестный declared data/resource " + name);
    }
  };
  for (const row of rows as any[]) {
    if (
      !row || typeof row !== "object" || typeof row.type !== "string" ||
      !row.content || typeof row.content !== "object"
    ) invalid("Повреждённая native declaration");
    const c = row.content;
    if (["resources", "supporting", "format-resources"].includes(row.type)) {
      path(c.file);
    } else if (row.type === "file") path(c.path);
    else if (row.type === "html-attachment") path(c.file?.path);
    else if (row.type === "html") {
      for (const field of ["scripts", "stylesheets", "resources"]) {
        if (c[field] !== undefined && !Array.isArray(c[field])) {
          invalid("Повреждённый HTML dependency " + field);
        }
        for (const file of c[field] ?? []) path(file?.path);
      }
      if (c.serviceworkers !== undefined && !Array.isArray(c.serviceworkers)) {
        invalid("Повреждённый serviceworkers");
      }
      for (const worker of c.serviceworkers ?? []) path(worker?.source);
      if (c.links !== undefined && !Array.isArray(c.links)) {
        invalid("Повреждённый HTML dependency links");
      }
      for (const link of c.links ?? []) path(link?.href);
    } else if (!["text", "usepackage"].includes(row.type)) {
      invalid("Неизвестный native declaration type " + row.type);
    }
  }
}
