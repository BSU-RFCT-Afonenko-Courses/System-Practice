import { createMetrics as __createMetrics } from "../observability/bridge.ts";
const __metrics = __createMetrics("reference-catalog");
import { diagnostic } from "../diagnostics.ts";
import { isRecord } from "./import-config.ts";

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function target(value: unknown, key: string, source: string) {
  function invalid(field: string): never {
    throw diagnostic(
      "QRC.IMPORT_INVALID",
      `некорректная импортированная цель ${key}: ${field}`,
      { source, id: key, field },
    );
  }
  if (!isRecord(value)) invalid("ожидается объект");
  const item = value;
  for (const field of ["baseUrl", "sourceTitle", "defaultStyle"]) {
    if (Object.hasOwn(item, field)) {
      invalid(`${field} недопустимо в каталоге публикации`);
    }
  }
  const required = (field: string) => {
    const value = item[field];
    if (!nonempty(value)) invalid(field);
    return value;
  };
  const namespace = required("namespace"),
    id = required("id"),
    page = required("page"),
    fragment = required("fragment"),
    labelHtml = required("labelHtml"),
    label = required("label");
  const numberHtml = item.numberHtml, number = item.number;
  if (typeof numberHtml !== "string") invalid("numberHtml");
  if (typeof number !== "string") invalid("number");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace)) invalid("namespace");
  if (key !== `${namespace}:${id}`) {
    invalid("ключ каталога должен совпадать с namespace:id");
  }
  if (
    /[\\?#:\u0000-\u001f]/.test(page) ||
    page.split("/").some((part) => !part || part === "." || part === "..")
  ) invalid("page должен быть относительным путём публикации");
  const slide = item.slide, title = item.title;
  if (slide !== undefined && !nonempty(slide)) invalid("slide");
  if (title !== undefined && !nonempty(title)) invalid("title");
  return {
    namespace,
    id,
    page,
    fragment,
    labelHtml,
    numberHtml,
    label,
    number,
    ...(slide === undefined ? {} : { slide }),
    ...(title === undefined ? {} : { title }),
  };
}

/** Проверяем внешний JSON до передачи его механизму разрешения ссылок. */
export function validateImportedCatalog(value: unknown, source: string) {
  if (!isRecord(value) || value.schema !== "quarto-reference-catalog") {
    throw diagnostic(
      "QRC.IMPORT_INVALID",
      "неподдерживаемая схема импортированного каталога; ожидается quarto-reference-catalog",
      { source, field: "schema" },
    );
  }
  if (
    !isRecord(value.generator) || typeof value.generator.quarto !== "string"
  ) {
    throw diagnostic(
      "QRC.IMPORT_INVALID",
      "некорректное поле generator каталога",
      { source, field: "generator.quarto" },
    );
  }
  if (!isRecord(value.targets)) {
    throw diagnostic(
      "QRC.IMPORT_INVALID",
      "некорректное поле targets каталога: ожидается объект",
      { source, field: "targets" },
    );
  }
  let publication;
  const rawPublication = value.publication;
  if (rawPublication !== undefined) {
    const title = isRecord(rawPublication) ? rawPublication.title : undefined;
    if (!isRecord(rawPublication) || !nonempty(title)) {
      throw diagnostic(
        "QRC.IMPORT_INVALID",
        "некорректное поле publication.title каталога",
        { source, field: "publication.title" },
      );
    }
    publication = { title };
  }
  return {
    schema: "quarto-reference-catalog" as const,
    generator: { quarto: value.generator.quarto },
    ...(publication === undefined ? {} : { publication }),
    targets: Object.fromEntries(
      Object.entries(value.targets).map(([key, value]) =>
        [key, target(value, key, source)] as const
      ),
    ),
  };
}

// @ts-expect-error JS допускает замену function binding; сигнатура публичного API сохраняется.
validateImportedCatalog = __metrics.wrapSync({
  id:
    "reference-catalog.infrastructure.catalog-validation.validateImportedCatalog",
  kind: "io",
}, validateImportedCatalog);
