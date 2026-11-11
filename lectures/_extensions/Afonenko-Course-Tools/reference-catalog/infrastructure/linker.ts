import { createMetrics as __createMetrics } from "../observability/bridge.ts";
const __metrics = __createMetrics("reference-catalog");
import { diagnostic } from "../diagnostics.ts";
import { isReferenceStyle, namespacePattern } from "../domain/contract.ts";
import type { Target } from "../domain/model.ts";
import { assemble, resolve } from "../domain/catalog.ts";
import { href } from "../domain/urls.ts";
import type { Page } from "./pages.ts";
import {
  attr,
  type Edit,
  escape,
  hasClass,
  inner,
  location,
  replace,
  span,
  textNode,
} from "./html.ts";
import { readable } from "./search.ts";
export type LinkScope = "local" | "full";
type LinkNode = Page["nodes"][number];
function referenceStyle(node: LinkNode, page: Page, key: string) {
  if (node.tagName !== "a") {
    throw diagnostic(
      "QRC.REFERENCE_INVALID",
      `некорректная разметка ссылки в ${page.path}`,
      { source: `HTML-результат ${page.path}`, id: key, field: "data-qrc-ref" },
    );
  }
  const [namespace, id, extra] = key.split(":");
  if (
    !namespace || !namespacePattern.test(namespace) || !id ||
    /[\s#]/.test(id) || extra !== undefined
  ) {
    throw diagnostic(
      "QRC.REFERENCE_INVALID",
      `некорректная ссылка ${key} в ${page.path}`,
      { source: `HTML-результат ${page.path}`, id: key, field: "data-qrc-ref" },
    );
  }
  const requestedStyle = attr(node, "data-qrc-style");
  if (!isReferenceStyle(requestedStyle)) {
    throw diagnostic(
      "QRC.REFERENCE_INVALID",
      `некорректный стиль ссылки в ${page.path}`,
      {
        source: `HTML-результат ${page.path}`,
        id: key,
        field: "data-qrc-style",
      },
    );
  }
  return requestedStyle;
}
function referenceCaption(
  context: {
    page: Page;
    node: LinkNode;
    target: Target;
    style: ReturnType<typeof referenceStyle>;
    custom: boolean;
    number: string | undefined;
    caption: string | undefined;
  },
) {
  const { page, node, target, style, custom, number, caption } = context;
  // Повторная финализация меняет источник, сохраняя только авторский текст.
  const priorTitle = hasClass(node, "qrc-external")
    ? node.childNodes.find((child) =>
      "tagName" in child && child.tagName === "span" &&
      hasClass(child, "qrc-title")
    )
    : undefined;
  const authored = priorTitle && "tagName" in priorTitle ? priorTitle : node;
  const labelText = custom
    ? readable(authored)
    : style === "number"
    ? target.number
    : style === "title" || style === "external"
    ? target.title ?? target.label
    : target.label;
  const authoredChildren = authored.childNodes;
  const label = custom
    ? inner(
      page.html,
      priorTitle && "tagName" in priorTitle ? priorTitle : node,
    )
    : style === "number"
    ? number
    : style === "title" || style === "external"
    ? escape(target.title ?? target.label)
    : caption;
  return { label, labelText, authoredChildren };
}
// В local импорт временно может обозначать цель будущей полной композиции.
// Учитываем владение добавленным rel отдельно от авторских токенов.
const generatedExternalRel = "data-qrc-generated-external-rel";
function authoredRelations(node: LinkNode): Set<string> {
  const tokens = new Set(
    (attr(node, "rel") ?? "").split(/\s+/).filter(Boolean),
  );
  if (attr(node, generatedExternalRel) === "true") tokens.delete("external");
  return tokens;
}
function deferredAttributes(node: LinkNode) {
  let attributes = node.attrs.filter((a) =>
    !["href", "data-qrc-deferred", generatedExternalRel].includes(a.name)
  );
  if (attr(node, generatedExternalRel) === "true") {
    attributes = attributes.filter((a) => a.name !== "rel");
    const rel = authoredRelations(node);
    if (rel.size) attributes.push({ name: "rel", value: [...rel].join(" ") });
  }
  attributes.push({ name: "data-qrc-deferred", value: "true" });
  return attributes;
}
function linkReference(
  context: {
    page: Page;
    node: LinkNode;
    key: string;
    requestedStyle: ReturnType<typeof referenceStyle>;
    target: Target;
    scope: LinkScope;
  },
) {
  const { page, node, key, requestedStyle, target, scope } = context;
  const style = requestedStyle === "default"
    ? target.defaultStyle ?? "default"
    : requestedStyle;
  if (style === "external" && !target.baseUrl) {
    throw diagnostic(
      "QRC.REFERENCE_INVALID",
      `стиль external требует импортированной цели: ${key}`,
      {
        source: `HTML-результат ${page.path}`,
        id: key,
        field: "data-qrc-style",
      },
    );
  }
  const custom = attr(node, "data-qrc-custom") === "true";
  // Внешний каталог предоставляет данные, а не выполняемую разметку.
  // Локальные подписи Quarto и явно написанный автором текст сохраняют HTML.
  const number = target.baseUrl ? escape(target.number) : target.numberHtml;
  const caption = target.baseUrl ? escape(target.label) : target.labelHtml;
  if (style === "number" && !custom && !number) {
    throw diagnostic(
      "QRC.REFERENCE_INVALID",
      `${key} не имеет номера; используйте название или задайте текст ссылки`,
      {
        source: `HTML-результат ${page.path}`,
        id: key,
        field: "data-qrc-style",
      },
    );
  }
  const captionData = referenceCaption({
    page,
    node,
    target,
    style,
    custom,
    number,
    caption,
  });
  let label = captionData.label;
  const { labelText, authoredChildren } = captionData;
  const classes = new Set(
    (attr(node, "class") ?? "").split(/\s+/).filter(Boolean),
  );
  classes.delete("qrc-external");
  const rel = authoredRelations(node);
  const generated = !!target.baseUrl && !rel.has("external");
  if (target.baseUrl) rel.add("external");
  if (style === "external") {
    classes.add("qrc-external");
    label =
      `<span class="qrc-title">${label}</span><span class="qrc-source"> — ${
        escape(target.sourceTitle || target.namespace)
      }</span><span class="qrc-external-marker" aria-hidden="true"> ↗</span>`;
  }
  const attributes = node.attrs.filter((a) =>
    !["href", "class", "rel", "data-qrc-deferred", generatedExternalRel]
      .includes(a.name)
  );
  if (classes.size) {
    attributes.push({ name: "class", value: [...classes].join(" ") });
  }
  if (rel.size) attributes.push({ name: "rel", value: [...rel].join(" ") });
  if (scope === "local" && generated) {
    attributes.push({ name: generatedExternalRel, value: "true" });
  }
  const attrs = attributes.map((a) => `${a.name}="${escape(a.value)}"`).join(
    " ",
  );
  const loc = location(node);
  const edit = {
    start: loc.startOffset,
    end: loc.endOffset,
    value: `<a ${attrs} href="${escape(href(page.path, target))}">${label}</a>`,
  };
  // Search consumes this same parsed tree. Update the link's semantic
  // children while preserving authored markup in the serialized edit.
  const captionNodes = custom ? authoredChildren : [textNode(labelText)];
  node.attrs = [...attributes, {
    name: "href",
    value: href(page.path, target),
  }];
  if (style === "external") {
    node.childNodes = [
      span(node, "qrc-title", captionNodes),
      span(node, "qrc-source", [
        textNode(` — ${target.sourceTitle || target.namespace}`),
      ]),
      span(node, "qrc-external-marker", [textNode(" ↗")]),
    ];
  } else {
    node.childNodes = captionNodes;
    for (const child of captionNodes) child.parentNode = node;
  }
  return { edit, externalStyle: style === "external" };
}
function removeGeneratedNode(page: Page, node: LinkNode): Edit {
  const loc = location(node);
  // Оба собственных insertion добавляют ровно один завершающий перевод строки.
  const end = loc.endOffset + (page.html[loc.endOffset] === "\n" ? 1 : 0);
  return { start: loc.startOffset, end, value: "" };
}
function finishPage(
  context: {
    page: Page;
    edits: Edit[];
    scope: LinkScope;
    externalStyle: boolean;
    externalCss: string;
    navigationScript: string;
  },
) {
  const { page, edits, scope, externalStyle, externalCss, navigationScript } =
    context;
  if (scope === "full") {
    for (const probe of page.probes) {
      const loc = location(probe);
      edits.push({ start: loc.startOffset, end: loc.endOffset, value: "" });
      if (probe.parentNode) {
        probe.parentNode.childNodes = probe.parentNode.childNodes.filter(
          (child) => child !== probe,
        );
      }
    }
  }
  // Собственный стиль определяется текущими ссылками, а не предыдущим local проходом.
  for (
    const style of page.nodes.filter((node) =>
      node.tagName === "style" &&
      attr(node, "data-qrc-external-style") !== undefined
    )
  ) {
    edits.push(removeGeneratedNode(page, style));
  }
  if (externalStyle && externalCss) {
    const head = page.nodes.find((node) => node.tagName === "head")
      ?.sourceCodeLocation?.endTag;
    if (head) {
      edits.push({
        start: head.startOffset,
        end: head.startOffset,
        value: `<style data-qrc-external-style>${externalCss}</style>\n`,
      });
    }
  }
  // Фрагмент URL может указывать на цель внутри свёрнутого блока.
  // Статические ресурсы без явного закрывающего body сохраняются без изменений.
  const body = page.nodes.find((n) => n.tagName === "body")?.sourceCodeLocation
    ?.endTag;
  if (!body && page.reveal) {
    throw diagnostic(
      "QRC.OUTPUT_INVALID",
      `отсутствует элемент body в ${page.path}`,
      { source: `HTML-результат ${page.path}`, field: "body" },
    );
  }
  if (body) {
    // В результатах портала может остаться ранее добавленный скрипт.
    // Заменяем его, чтобы обработчики событий не дублировались.
    for (
      const script of page.nodes.filter((n) =>
        n.tagName === "script" && attr(n, "data-qrc-navigation") !== undefined
      )
    ) {
      edits.push(removeGeneratedNode(page, script));
    }
    edits.push({
      start: body.startOffset,
      end: body.startOffset,
      value: `<script data-qrc-navigation>${navigationScript}</script>\n`,
    });
  }
}
function linkPagesImpl(
  pages: Page[],
  navigationScript: string,
  imports: Target[] = [],
  externalCss = "",
  scope: LinkScope = "full",
): {
  pages: Map<string, string>;
  parsedPages: Map<string, Page>;
  targets: Map<string, Target>;
  links: number;
  deferred: number;
} {
  const targets = assemble([...pages.flatMap((p) => p.targets), ...imports]);
  const result = new Map<string, string>();
  let links = 0;
  let deferred = 0;
  for (const page of pages) {
    const edits: Edit[] = [];
    let externalStyle = false;
    for (const node of page.nodes) {
      const key = attr(node, "data-qrc-ref");
      if (!key) continue;
      const requestedStyle = referenceStyle(node, page, key);
      if (scope === "local" && !targets.has(key)) {
        const attributes = deferredAttributes(node);
        const attrs = attributes.map((a) => `${a.name}="${escape(a.value)}"`)
          .join(" ");
        const loc = location(node);
        edits.push({
          start: loc.startOffset,
          end: loc.endOffset,
          value: `<a ${attrs}>${inner(page.html, node)}</a>`,
        });
        deferred++;
        continue;
      }
      const linked = linkReference({
        page,
        node,
        key,
        requestedStyle,
        target: resolve(targets, key, page.path),
        scope,
      });
      edits.push(linked.edit);
      externalStyle ||= linked.externalStyle;
      links++;
    }
    finishPage({
      page,
      edits,
      scope,
      externalStyle,
      externalCss,
      navigationScript,
    });
    result.set(page.path, replace(page.html, edits));
  }
  return {
    pages: result,
    parsedPages: new Map(pages.map((page) => [page.path, page])),
    targets,
    links,
    deferred,
  };
}

export const linkPages = __metrics.wrapSync({
  id: "reference-catalog.infrastructure.linker.linkPages",
  kind: "io",
}, linkPagesImpl);
