import { dirname, relative, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
/** Данные оформления private assignment HTML, не разрешение читать CSS. */
type PresentationContext = {
  root: string;
  outputDirectory: string;
  xdg: string;
  format: string;
  outputs?: ReadonlySet<string>;
  nativeImplementation?: (path: string) => boolean;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function stylesheetAttributes(
  row: { content: Record<string, unknown> },
  sheet: { name: string; attribs: Record<string, unknown> },
  context: PresentationContext,
) {
  const attrs = sheet.attribs;
  const syntax = /^quarto-syntax-highlighting(?:-dark)?-[a-f0-9]{32}\.css$/
    .test(sheet.name);
  const compiled = /^(quarto-html|bootstrap)(?:-dark)?-[a-f0-9]{32}\.min\.css$/
    .exec(sheet.name);
  if (syntax) {
    if (
      row.content.name !== "quarto-html" ||
      attrs.id !== "quarto-text-highlighting-styles" ||
      Object.keys(attrs).some((k) => !["id", "class"].includes(k))
    ) return false;
  } else if (compiled) {
    if (
      context.format !== "html" || row.content.name !== compiled[1] ||
      attrs["append-hash"] !== "true" ||
      (attrs["data-mode"] !== "light" && attrs["data-mode"] !== "dark") ||
      (compiled[1] === "bootstrap"
        ? attrs.id !== "quarto-bootstrap"
        : attrs.id !== undefined) ||
      Object.keys(attrs).some((k) =>
        !["append-hash", "data-mode", "class", "id"].includes(k)
      )
    ) return false;
  } else return false;
  if (
    attrs.class !== undefined &&
    (typeof attrs.class !== "string" || ![
      "quarto-color-scheme",
      "quarto-color-scheme quarto-color-alternate",
      "quarto-color-scheme-extra",
    ].includes(attrs.class))
  ) return false;
  return true;
}
function presentationStylesheet(
  row: { content: Record<string, unknown> },
  sheet: unknown,
  context?: PresentationContext,
) {
  if (
    !context ||
    !["html", "revealjs"].includes(context.format) ||
    ![context.root, context.xdg, context.outputDirectory].every((p) =>
      typeof p === "string" && p.startsWith("/") && !p.includes("\0") &&
      resolve(p) === p
    ) ||
    !context.outputDirectory.startsWith(context.root + "/_generated/") ||
    row.content.external !== undefined || row.content.version !== undefined ||
    !record(sheet) ||
    Object.keys(sheet).sort().join(",") !== "attribs,name,path" ||
    typeof sheet.path !== "string" || typeof sheet.name !== "string" ||
    !record(sheet.attribs)
  ) return false;
  if (
    !stylesheetAttributes(
      row,
      { name: sheet.name, attribs: sheet.attribs },
      context,
    )
  ) return false;
  const path = sheet.path;
  if (!path.startsWith("/") || path.includes("\0") || resolve(path) !== path) {
    return false;
  }
  const cache = context.xdg + "/quarto/sass/";
  if (
    path.startsWith(cache) &&
    /^(?:v8-[0-9]+\.[0-9]+\/)?[a-f0-9]{32}\.css$/.test(path.slice(cache.length))
  ) return true;
  const scratch = context.root + "/.quarto/";
  return path.startsWith(scratch) &&
    /^quarto-session-temp[a-f0-9]+\/(?:sass\/)?[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.css$/
      .test(path.slice(scratch.length));
}
/** Native book navigation references existing output names; не разрешение читать HTML. */
function paginationOutput(
  row: { content: Record<string, unknown> },
  link: unknown,
  context?: PresentationContext,
) {
  if (
    !context || context.format !== "html" ||
    !context.root.startsWith("/") || resolve(context.root) !== context.root ||
    !context.outputDirectory.startsWith(context.root + "/_generated/") ||
    resolve(context.outputDirectory) !== context.outputDirectory ||
    row.content.name !== "website-pagination" ||
    Object.keys(row.content).sort().join(",") !== "links,name" ||
    !record(link) ||
    Object.keys(link).sort().join(",") !== "href,rel" ||
    (link.rel !== "next" && link.rel !== "prev") ||
    typeof link.href !== "string" ||
    !link.href.startsWith("/") || link.href.startsWith("//") ||
    /[\\\0?#%]/.test(link.href)
  ) return false;
  const target = resolve(context.outputDirectory, "." + link.href);
  return target.startsWith(context.outputDirectory + "/") &&
    target.endsWith(".html") &&
    link.href ===
      "/" + relative(context.outputDirectory, target).replaceAll("\\", "/") &&
    context.outputs?.has(target) === true;
}
/** Quarto JSONL contains declared data/resources, not a loaded-module trace. */
export function assertAssignmentDeclarations(
  rows: unknown,
  input: string,
  presentation?: PresentationContext,
) {
  const invalid = (s: string): never =>
    fail("BODY.PRODUCER_DEPENDENCY_UNQUALIFIED", s);
  if (!Array.isArray(rows) || rows.length > 16384) {
    return invalid("Нет bounded native data/resource declarations");
  }
  const path = (v: unknown) => {
    if (typeof v !== "string" || !v || v.includes("\0")) {
      return invalid("Повреждённый declared path");
    }
    const name = v;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(name)) {
      invalid("Внешний declared resource");
    }
    const absolute = resolve(dirname(input), name);
    if (
      (!presentation || !absolute.startsWith(presentation.root + "/")) &&
      !presentation?.nativeImplementation?.(absolute)
    ) {
      invalid("Declared data/resource вне владельца " + name);
    }
  };
  function htmlDeclaration(row: { content: Record<string, unknown> }) {
    const c = row.content;
    for (const field of ["scripts", "stylesheets", "resources"]) {
      if (c[field] !== undefined && !Array.isArray(c[field])) {
        invalid("Повреждённый HTML dependency " + field);
      }
      const files: unknown[] = Array.isArray(c[field]) ? c[field] : [];
      for (const file of files) {
        // Служебный CSS не разрешается как содержимое AST/resource.
        if (
          field === "stylesheets" && record(file) &&
          typeof file.path === "string" &&
          presentationStylesheet(row, file, presentation)
        ) continue;
        path(record(file) ? file.path : undefined);
      }
    }
    if (c.serviceworkers !== undefined && !Array.isArray(c.serviceworkers)) {
      invalid("Повреждённый serviceworkers");
    }
    const workers: unknown[] = Array.isArray(c.serviceworkers)
      ? c.serviceworkers
      : [];
    for (const worker of workers) {
      path(record(worker) ? worker.source : undefined);
    }
    if (c.links !== undefined && !Array.isArray(c.links)) {
      invalid("Повреждённый HTML dependency links");
    }
    const links: unknown[] = Array.isArray(c.links) ? c.links : [];
    for (const link of links) {
      if (paginationOutput(row, link, presentation)) continue;
      path(record(link) ? link.href : undefined);
    }
  }
  const declarations: unknown[] = rows;
  for (const value of declarations) {
    if (
      !record(value) || typeof value.type !== "string" ||
      !record(value.content)
    ) return invalid("Повреждённая native declaration");
    // После проверки границы native JSON поля ещё остаются unknown.
    const row = { type: value.type, content: value.content }, c = row.content;
    if (
      row.type === "resources" || row.type === "supporting" ||
      row.type === "format-resources"
    ) {
      path(c.file);
    } else if (row.type === "file") path(c.path);
    else if (row.type === "html-attachment") {
      path(record(c.file) ? c.file.path : undefined);
    } else if (row.type === "html") {
      htmlDeclaration(row);
    } else if (row.type !== "text" && row.type !== "usepackage") {
      invalid("Неизвестный native declaration type " + row.type);
    }
  }
}
