const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function chapterSpan(value: unknown, name: string): unknown[] | undefined {
  if (!object(value) || value.t !== "Span" || !Array.isArray(value.c)) return;
  const [attr, body] = value.c;
  if (
    Array.isArray(attr) && attr[0] === "" &&
    Array.isArray(attr[1]) && attr[1].length === 1 && attr[1][0] === name &&
    Array.isArray(attr[2]) && attr[2].length === 0 && Array.isArray(body)
  ) return body;
  return undefined;
}

const whitespace = (value: unknown): boolean =>
  object(value) &&
  (["Space", "SoftBreak", "LineBreak"].includes(String(value.t)) ||
    value.t === "Str" && typeof value.c === "string" && /^\s*$/u.test(value.c));

/** Видимый текст native заголовка; Attr, targets и citation metadata не текст.
 * Quarto formatChapterTitle() добавляет пару chapter-number / chapter-title
 * с пробелами, иногда внутри quarto-section-identifier. Снимаем только эту
 * форму оформления, сохраняя авторские числа внутри самого chapter-title. */
export function visibleTitle(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (chapterSpan(value[0], "chapter-number")) {
      let index = 1;
      while (index < value.length && whitespace(value[index])) index++;
      const title = chapterSpan(value[index], "chapter-title");
      if (index > 1 && title) {
        return visibleTitle(title) + visibleTitle(value.slice(index + 1));
      }
    }
    return value.map(visibleTitle).join("");
  }
  if (!object(value)) return "";
  switch (value.t) {
    case "Str":
    case "MetaString":
      return typeof value.c === "string" ? value.c : "";
    case "Space":
    case "SoftBreak":
    case "LineBreak":
      return " ";
    case "Code":
    case "CodeBlock":
    case "Math":
      return Array.isArray(value.c) && typeof value.c[1] === "string"
        ? value.c[1]
        : "";
    case "Span":
    case "Link":
    case "Image":
    case "Cite":
    case "Quoted":
    case "Div":
      return Array.isArray(value.c) ? visibleTitle(value.c[1]) : "";
    case "Header":
      return Array.isArray(value.c) ? visibleTitle(value.c[2]) : "";
    case "MetaInlines":
    case "MetaBlocks":
    case "Plain":
    case "Para":
    case "Emph":
    case "Underline":
    case "Strong":
    case "Strikeout":
    case "Superscript":
    case "Subscript":
    case "SmallCaps":
      return visibleTitle(value.c);
    default:
      return "";
  }
}
