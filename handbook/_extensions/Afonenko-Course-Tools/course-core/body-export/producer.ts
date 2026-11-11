import { createMetrics as __createMetrics } from "../observability/bridge.ts";
const __metrics = __createMetrics("course-core");
import { diagnostic, type DiagnosticContext } from "../domain/diagnostics.ts";
import { relative, resolve } from "stdlib/path";
import type {
  BodyPackage,
  BodyQuestion,
  Node,
  PublicBodyPackage,
} from "./model.ts";
import { assertReferenceTargets, resolveReferences } from "./references.ts";
import { type BodyReferenceContext, publicLinks } from "./links.ts";
import { BodyPackageSchema } from "./package-contracts.ts";
export type { BodyPackage, PublicBodyPackage } from "./model.ts";
import {
  isContainer,
  isLink,
  isNode,
  isNodes as nodes,
  isRecord,
  nodeAttributes as attr,
  requireNodes,
} from "../document/native-ast.ts";
import type { ContainerNode } from "../document/native-ast.ts";
const classes = (n: unknown) => attr(n)?.[1] || [];
function titleTargets(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(titleTargets);
  if (!isRecord(value)) return [];
  const id = attr(value)?.[0];
  return [
    ...(id ? [{ t: "Span", c: [[id, [], []], []] }] : []),
    ...Object.values(value).flatMap(titleTargets),
  ];
}
const solution = (n: unknown): n is ContainerNode =>
  isContainer(n) && n.t === "Div" &&
  (classes(n).includes("solution") || n.c[0][0].startsWith("sol-"));
/** Quarto 1.11.5 HTML markdown pipelines transport navigation/social metadata
 * through these two hidden envelopes. They are not authored public body blocks.
 * Match the pinned writer's whole holder shape; ordinary hidden content stays. */
function quartoMarkdownEnvelope(node: unknown): boolean {
  const outer = attr(node);
  if (
    !isContainer(node) || node.t !== "Div" || !outer ||
    !["quarto-navigation-envelope", "quarto-meta-markdown"].includes(
      outer[0],
    ) ||
    outer[1]?.length !== 1 || outer[1][0] !== "hidden" ||
    outer[2]?.length !== 0 ||
    !Array.isArray(node.c) || !nodes(node.c[1])
  ) return false;
  const holder = (value: Node) => {
    const a = attr(value);
    return ["Span", "Div"].includes(value?.t) && a?.[0] === "" &&
      a[1]?.length === 2 && a[1].includes("hidden") &&
      a[1].includes("quarto-markdown-envelope-contents") &&
      a[2]?.length === 1 && a[2][0]?.[0] === "render-id" &&
      typeof a[2][0]?.[1] === "string" && a[2][0][1].length > 0 &&
      Array.isArray(value.c) && nodes(value.c[1]);
  };
  return node.c[1].every((block: Node) =>
    block?.t === "Div" ? holder(block) : ["Para", "Plain"].includes(block?.t) &&
      Array.isArray(block.c) && block.c.length === 1 && isNode(block.c[0]) &&
      holder(block.c[0])
  );
}
const omitted = Symbol("omitted");
function partition(value: unknown, banks: Node[], solutions: Node[]): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => partition(v, banks, solutions)).filter((v) =>
      v !== omitted
    );
  }
  if (!isRecord(value)) return value;
  if (quartoMarkdownEnvelope(value)) return omitted;
  // Контекстный Download зависит от страницы/audience. Full ZIP не становится
  // публичным ресурсом вопроса, даже если файл существует на диске.
  if (value.t === "Div" && classes(value).includes("project-download")) {
    return omitted;
  }
  if (
    value.t === "Link" &&
    classes(value).some((role: string) =>
      role === "project-download" || role === "project-download-link"
    )
  ) return omitted;
  if (
    value.t === "CodeBlock" && classes(value).includes("answer-spec") ||
    value.t === "Div" && classes(value).includes("answer")
  ) {
    if (!isNode(value)) {
      throw diagnostic("DOCUMENT_AST", "Повреждённый банк ответа", {});
    }
    banks.push(value);
    return omitted;
  }
  if (solution(value)) {
    solutions.push(...value.c[1]);
    return omitted;
  }
  if (value.t === "Div" && classes(value).includes("grading-notes")) {
    return omitted;
  }
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, partition(v, banks, solutions)]),
  );
}
function introduction(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(introduction).filter((v) => v !== omitted);
  }
  if (!isRecord(value)) return value;
  if (
    value.t === "Div" && (attr(value)?.[0]?.startsWith("exr-") ||
      classes(value).some((c: string) =>
        ["task-items", "assessment-preview"].includes(c)
      ))
  ) return omitted;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, introduction(v)]),
  );
}
const supported = new Set(
  "Str Space SoftBreak LineBreak Emph Strong Underline Strikeout Superscript Subscript SmallCaps Quoted Code Math Link Image Span Para Plain BlockQuote OrderedList BulletList DefinitionList HorizontalRule Table Figure Header Div CodeBlock AlignLeft AlignRight AlignCenter AlignDefault ColWidth ColWidthDefault Decimal DefaultStyle DefaultDelim Period OneParen TwoParens InlineMath DisplayMath SingleQuote DoubleQuote"
    .split(" "),
);
function assertSupported(value: unknown, context: DiagnosticContext) {
  if (Array.isArray(value)) {
    value.forEach((v) => assertSupported(v, context));
    return;
  }
  if (!isRecord(value)) return;
  const reference = attr(value)?.[2]?.find((pair: string[]) =>
    pair[0] === "data-qrc-ref"
  )?.[1];
  if (reference) {
    throw diagnostic(
      "BODY.QRC_REFERENCE_UNRESOLVED",
      reference + "; Ссылка QRC не разрешена",
      context,
    );
  }
  const native = attr(value);
  const emptyNativeContainer = isContainer(value) && value.c[1].length === 0;
  const ojsBlock = value.t === "Div" && native &&
    /^ojs-cell-[0-9]+(?:-[0-9]+)?$/.test(native[0]) &&
    native[2].some(([key, type]) =>
      key === "nodetype" && ["declaration", "expression"].includes(type)
    );
  const ojsInline = value.t === "Span" && native &&
    /^ojs-element-id-[0-9]+$/.test(native[0]);
  if (emptyNativeContainer && (ojsBlock || ojsInline)) {
    throw diagnostic(
      "BODY.CAPABILITY_UNSUPPORTED",
      "OJS требует native HTML runtime и не переносится в Body",
      context,
    );
  }
  if (typeof value.t === "string" && !supported.has(value.t)) {
    throw diagnostic(
      "BODY.CAPABILITY_UNSUPPORTED",
      "Body не поддерживает этот тип узла: " + value.t,
      context,
    );
  }
  if (
    value.t &&
    classes(value).some((c: string) =>
      ["answer-spec", "correct", "grading-notes", "solution"].includes(c)
    )
  ) {
    throw diagnostic(
      "BODY.UNPARTITIONED_PRIVATE_ROLE",
      "Закрытый блок остался в публичном теле",
      context,
    );
  }
  Object.values(value).forEach((v) => assertSupported(v, context));
}
/** Existing one-scope public links/citations assembly reused by native assignment. */
export async function preparePublicQuestion(
  {
    condition,
    publicAnswer,
    document,
    root,
    context,
    references,
    effectiveBase,
  }: {
    condition: Node[];
    publicAnswer: Node[];
    document: unknown;
    root: string;
    context: DiagnosticContext;
    references?: BodyReferenceContext | undefined;
    effectiveBase?: string | undefined;
  },
) {
  const fragments = await resolveReferences(
    await publicLinks(
      [
        { t: "Div", c: [["", [], []], condition] },
        { t: "Div", c: [["", [], []], publicAnswer] },
      ],
      { ...context, field: "condition/publicAnswer" },
      references,
    ),
    document,
    root,
    { ...context, field: "condition/publicAnswer" },
    effectiveBase,
  );
  const conditionFragment = fragments[0], answerFragment = fragments[1];
  if (!isContainer(conditionFragment) || !isContainer(answerFragment)) {
    throw diagnostic(
      "DOCUMENT_AST",
      "Потеряна оболочка публичного фрагмента",
      context,
    );
  }
  const result = {
    condition: [...conditionFragment.c[1], ...fragments.slice(2)],
    publicAnswer: answerFragment.c[1],
  };
  assertReferenceTargets([...result.condition, ...result.publicAnswer], {
    ...context,
    field: "condition/publicAnswer",
  });
  assertSupported(result.condition, { ...context, field: "condition" });
  assertSupported(result.publicAnswer, { ...context, field: "publicAnswer" });
  return result;
}
export async function preparePublicIntroduction(
  { blocks, document, root, context, references, effectiveBase }: {
    blocks: Node[];
    document: unknown;
    root: string;
    context: DiagnosticContext;
    references?: BodyReferenceContext | undefined;
    effectiveBase?: string | undefined;
  },
) {
  const result = await resolveReferences(
    await publicLinks(requireNodes(introduction(partition(blocks, [], []))), {
      ...context,
      field: "introduction",
    }, references),
    document,
    root,
    { ...context, field: "introduction" },
    effectiveBase,
  );
  assertReferenceTargets(result, { ...context, field: "introduction" });
  assertSupported(result, { ...context, field: "introduction" });
  return result;
}
export async function assertBodyPackage(pkg: unknown, root: string) {
  const parsed = BodyPackageSchema.safeParse(pkg);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw diagnostic(
      "BODY.PACKAGE_INVALID",
      issue?.message ?? "Некорректный Body package",
      {
        source: root,
        field: issue?.path.join(".") ?? "",
      },
      parsed.error,
    );
  }
}

export function publicResourceUses(
  value: unknown,
  root: string,
  source: string,
  effectiveBase?: string,
  targets?: Map<string, string>,
): string[] {
  const selected: string[] = [];
  function scan(v: unknown) {
    if (Array.isArray(v)) {
      v.forEach(scan);
      return;
    }
    if (!isRecord(v)) return;
    attr(v);
    if (isLink(v)) {
      const url = v.c[2][0];
      if (
        !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url) &&
        !/\.(?:qmd|html)(?:[#?]|$)/i.test(url)
      ) {
        if (!effectiveBase) {
          throw diagnostic(
            "BODY.RESOURCE_CONTEXT_REQUIRED",
            "Не найден native контекст ресурса",
            { source, field: "resource" },
          );
        }
        const path = decodeURIComponent(url.split(/[?#]/)[0] ?? "");
        const absolute = path.startsWith("/")
          ? resolve(root, path.slice(1))
          : resolve(effectiveBase, path);
        if (targets) {
          const target = targets.get(absolute);
          if (target) {
            v.c[2][0] = target + url.slice((url.split(/[?#]/)[0] ?? "").length);
          }
        } else selected.push(relative(root, absolute));
      }
    }
    Object.values(v).forEach(scan);
  }
  scan(value);
  return selected;
}

export function publicCondition(blocks: Node[], hasCanonicalTitle: boolean) {
  const authoredCondition = blocks.filter((n: Node) =>
    !(n.t === "Div" && classes(n).includes("course-metadata"))
  );
  const opening = authoredCondition[0];
  const inlines = nodes(opening?.c) ? opening.c : undefined;
  const prefix = inlines?.[0];
  const prefixAttr = prefix && attr(prefix);
  let prefixTargets: Node[] = [];
  let nativeTitleConsumed = false;
  function titleTail() {
    const tail = inlines!.slice(1);
    while (
      tail[0] && (["Space", "SoftBreak", "LineBreak"].includes(tail[0].t) ||
        tail[0].t === "Str" && typeof tail[0].c === "string" &&
          !tail[0].c.trim())
    ) tail.shift();
    return tail;
  }
  // Quarto's crossref writer prepends this anonymous caption to the first
  // paragraph. Strip only that native prefix, keeping any authored tail.
  if (
    opening && ["Para", "Plain"].includes(opening.t) && prefix?.t === "Span" &&
    prefixAttr?.[0] === "" && prefixAttr[1].length === 1 &&
    prefixAttr[1][0] === "theorem-title" && prefixAttr[2].length === 0 &&
    Array.isArray(prefix.c) && nodes(prefix.c[1]) &&
    prefix.c[1].length === 1 && prefix.c[1][0]?.t === "Strong"
  ) {
    nativeTitleConsumed = true;
    prefixTargets = titleTargets(prefix);
    const tail = titleTail();
    if (tail.length) authoredCondition[0] = { ...opening, c: tail };
    else authoredCondition.shift();
  }
  // The native caption was handled above; remaining Headers are authored.
  // Strip the original canonical Header only when no native prefix occurred.
  if (
    !nativeTitleConsumed && hasCanonicalTitle &&
    authoredCondition[0]?.t === "Header"
  ) {
    const heading = authoredCondition.shift()!;
    // Preserve genuine fragment targets without repeating the book title.
    const headingAttr = attr(heading);
    if (headingAttr?.[0]) {
      authoredCondition.unshift({ t: "Div", c: [headingAttr, []] });
    }
  }
  if (prefixTargets.length) {
    authoredCondition.unshift({ t: "Plain", c: prefixTargets });
  }
  return requireNodes(partition(authoredCondition, [], []));
}
