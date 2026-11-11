import type { AnswerFacts } from "../document/answer-contracts.ts";
import { fail } from "../contracts/project.ts";
import { decode } from "../document/contracts.ts";
import { visibleTitle } from "../document/title.ts";
import type {
  DocumentContext,
  ExerciseDeclaration,
} from "../document/contracts.ts";
import { NativeReleaseFactsSchema } from "./contracts.ts";
import type { NativeReleaseFacts } from "./contracts.ts";
import {
  isBulletList,
  isCite,
  isContainer,
  isHeader,
  isNode,
  isNodes,
  isRecord as obj,
  nodeAttributes,
} from "../document/native-ast.ts";
import type { ContainerNode, Node } from "../document/native-ast.ts";
function body(value: unknown): Node[] {
  if (!isContainer(value)) {
    fail("DOCUMENT_AST", "Повреждённый native container");
  }
  return value.c[1];
}
function citations(value: unknown) {
  if (!isCite(value)) {
    fail("CORE.ASSESSMENT_INVALID", "Повреждённый native Cite");
  }
  return value.c[0];
}
function listItems(value: unknown): Node[][] {
  if (isBulletList(value)) return value.c;
  if (
    isNode(value) && value.t === "OrderedList" && Array.isArray(value.c) &&
    value.c.length === 2 && Array.isArray(value.c[0]) &&
    value.c[0].length === 3 && typeof value.c[0][0] === "number" &&
    isNode(value.c[0][1]) && isNode(value.c[0][2]) &&
    Array.isArray(value.c[1]) && value.c[1].every(isNodes)
  ) return value.c[1];
  fail("CORE.ASSESSMENT_INVALID", "Повреждённый native список");
}
export function nativeMetadata(v: unknown): unknown {
  if (!obj(v)) return v;
  switch (v.t) {
    case "MetaMap":
      if (!obj(v.c)) fail("CORE.METADATA_INVALID", "Повреждённый MetaMap");
      return Object.fromEntries(
        Object.entries(v.c).map((
          [k, x],
        ) => [k, nativeMetadata(x)]),
      );
    case "MetaList":
      if (!Array.isArray(v.c)) {
        fail("CORE.METADATA_INVALID", "Повреждённый MetaList");
      }
      return v.c.map(nativeMetadata);
    case "MetaBool":
      if (typeof v.c !== "boolean") {
        fail("CORE.METADATA_INVALID", "Повреждённый MetaBool");
      }
      return v.c;
    case "MetaString":
      if (typeof v.c !== "string") {
        fail("CORE.METADATA_INVALID", "Повреждённый MetaString");
      }
      return v.c;
    case "MetaInlines":
    case "MetaBlocks":
      return visibleTitle(v.c);
    default:
      return v;
  }
}
/** Только native Meta-формы: неизвестный узел не превращается в произвольный JSON. */
function adapterMetadata(v: unknown): unknown {
  if (!obj(v)) fail("CORE.ADAPTER_METADATA", "Требуется native metadata node");
  if (v.t === "MetaMap" && obj(v.c)) {
    return Object.fromEntries(
      Object.entries(v.c).map(([k, value]) => [k, adapterMetadata(value)]),
    );
  }
  if (v.t === "MetaList" && Array.isArray(v.c)) return v.c.map(adapterMetadata);
  if (
    v.t === "MetaBool" && typeof v.c === "boolean" ||
    v.t === "MetaString" && typeof v.c === "string"
  ) return v.c;
  if ((v.t === "MetaInlines" || v.t === "MetaBlocks") && Array.isArray(v.c)) {
    return visibleTitle(v.c);
  }
  fail("CORE.ADAPTER_METADATA", "Неподдержанная native metadata форма");
}
const attrs = (v: Record<string, unknown>) => {
  const a = nodeAttributes(v);
  if (!a) fail("DOCUMENT_AST", "У native узла нет Attr");
  return { id: a[0], classes: a[1], values: Object.fromEntries(a[2]) };
};
function visit(v: unknown, use: (node: Record<string, unknown>) => void) {
  if (Array.isArray(v)) { for (const x of v) visit(x, use); }
  else if (obj(v)) {
    use(v);
    for (const child of Object.values(v)) visit(child, use);
  }
}
function assertAssessmentParagraph(item: unknown) {
  if (
    !Array.isArray(item) || item.length !== 1 ||
    !obj(item[0]) || !["Plain", "Para"].includes(String(item[0].t))
  ) fail("CORE.ASSESSMENT_INVALID", "Позиция требует один абзац");
}
export function collectReleaseFacts(
  ast: { meta: Record<string, unknown>; blocks: unknown[] },
  context: DocumentContext,
  definitions: Record<string, ExerciseDeclaration>,
  answers: Record<string, AnswerFacts> = {},
) {
  const course = nativeMetadata(ast.meta.course) ?? {};
  if (!obj(course)) fail("CORE.COURSE_INVALID", "course требует карту");
  if (course.schema !== undefined) {
    fail("CORE.SCHEMA_INVALID", "Поле course.schema не поддерживается");
  }
  if (
    course["assessment-time"] !== undefined &&
    typeof course["assessment-time"] !== "boolean"
  ) {
    fail("CORE.COURSE_INVALID", "course.assessment-time требует boolean");
  }
  const config = nativeMetadata(ast.meta.assessment);
  const containers: ContainerNode[] = [];
  const declarations = new Map<
    string,
    NativeReleaseFacts["declarations"][number]
  >();
  visit(ast.blocks, (node) => {
    if (node.t !== "Div") return;
    if (!isContainer(node)) fail("DOCUMENT_AST", "Повреждённый Div");
    const a = attrs(node);
    if (a.classes.includes("task-items")) containers.push(node);
    if (Object.hasOwn(definitions, a.id)) {
      const declaration = definitions[a.id]!;
      const previous = declarations.get(a.id);
      const next = {
        id: a.id,
        hasSolution: false,
        ...(answers[a.id] ? { answer: answers[a.id] } : {}),
        ...(() => {
          const first = body(node)[0];
          return isHeader(first)
            ? {
              head: {
                level: first.c[0],
                title: visibleTitle(first.c[2]).trim(),
              },
            }
            : {};
        })(),
        ...(declaration.target ? { target: declaration.target } : {}),
        ...(declaration.project ? { project: declaration.project } : {}),
        ...(declaration["project-check"]
          ? { check: declaration["project-check"] }
          : {}),
        // Core владеет effective defaults; adapter получает их без второго resolver.
        // Остальные authored/native attrs сохраняются, включая adapter-prefixed поля.
        attributes: {
          ...a.values,
          ...Object.fromEntries(
            Object.entries(declaration).filter(([, value]) =>
              value !== undefined
            ).map(([key, value]) => [key, String(value)]),
          ),
        },
      };
      if (
        previous &&
        JSON.stringify(previous.attributes) !== JSON.stringify(next.attributes)
      ) fail("CORE.DUPLICATE_EXERCISE", "Разные декларации одного упражнения");
      declarations.set(a.id, next);
    }
  });
  function solution(v: unknown, parent?: string) {
    if (Array.isArray(v)) {
      for (const x of v) solution(x, parent);
      return;
    }
    if (!obj(v)) return;
    let next = parent;
    if (v.t === "Div") {
      const a = attrs(v);
      if (declarations.has(a.id)) next = a.id;
      if (a.classes.includes("solution") || a.id.startsWith("sol-")) {
        const id = a.id.startsWith("sol-") ? "exr-" + a.id.slice(4) : parent;
        if (id && declarations.has(id)) {
          declarations.get(id)!.hasSolution = true;
        }
      }
    }
    for (const child of Object.values(v)) solution(child, next);
  }
  solution(ast.blocks);
  function collectAssessment() {
    let assessment: unknown;
    if (config !== undefined || containers.length) {
      if (!obj(config)) {
        fail("CORE.ASSESSMENT_INVALID", "Требуется assessment.kind");
      }
      if (
        config["theory-time"] !== undefined &&
        !["string", "number"].includes(typeof config["theory-time"])
      ) {
        fail(
          "CORE.ASSESSMENT_INVALID",
          "theory-time требует положительное число минут",
        );
      }
      let title = visibleTitle(ast.meta.title).trim();
      let id = typeof config.id === "string" ? config.id : "";
      visit(ast.blocks, (n) => {
        if (n.t === "Header") {
          if (!isHeader(n)) fail("DOCUMENT_AST", "Повреждённый Header");
          const c = n.c;
          if (!title) title = visibleTitle(c[2]).trim();
          if (!id) id = c[1][0];
        }
      });
      const slots: unknown[] = [],
        memberKinds: string[] = [],
        memberSizes: number[] = [];
      for (const container of containers) {
        const a = attrs(container),
          members = body(container);
        if (
          members.length !== 1 ||
          !members[0] || !["BulletList", "OrderedList"].includes(members[0].t)
        ) fail("CORE.ASSESSMENT_INVALID", "task-items требует один список");
        for (const k of Object.keys(a.values)) {
          if (
            ![
              "stage",
              "requirement",
              "work-mode",
              "when-format",
              "unless-format",
              "when-profile",
              "unless-profile",
              "when-meta",
              "unless-meta",
            ].includes(k)
          ) {
            fail(
              "CORE.ASSESSMENT_INVALID",
              "Неизвестный task-items атрибут " + k,
            );
          }
        }
        memberKinds.push(members[0]!.t);
        const items = listItems(members[0]);
        for (const item of items) {
          assertAssessmentParagraph(item);
          let group: ReturnType<typeof attrs> | undefined,
            groupNode: Record<string, unknown> | undefined;
          const candidates: string[] = [];
          let requirement: string | undefined, workMode: string | undefined;
          visit(item, (node) => {
            if (node.t === "Cite") {
              for (const cite of citations(node)) {
                candidates.push(String(cite.citationId));
              }
            }
            if (node.t === "Span") {
              const span = attrs(node);
              if (span.values.stage) {
                fail("CORE.ASSESSMENT_INVALID", "stage принадлежит task-items");
              }
              if (span.classes.includes("task-alternatives")) {
                if (group) {
                  fail(
                    "CORE.ASSESSMENT_INVALID",
                    "Повторная группа alternatives",
                  );
                }
                group = span;
                groupNode = node;
                if (
                  !/^alt-[a-z0-9][a-z0-9-]*$/.test(span.id) ||
                  !["random", "choice"].includes(span.values.selection ?? "")
                ) {
                  fail(
                    "CORE.ASSESSMENT_INVALID",
                    "Группа требует alt-* и selection=random|choice",
                  );
                }
                visit(body(node), (candidate) => {
                  if (candidate.t === "Span") {
                    const values = attrs(candidate).values;
                    if (
                      values.requirement !== undefined ||
                      values["work-mode"] !== undefined
                    ) {
                      fail(
                        "CORE.ASSESSMENT_INVALID",
                        "Назначение принадлежит позиции, не кандидату группы",
                      );
                    }
                  }
                });
              }
              if (
                span.values.requirement !== undefined ||
                span.values["work-mode"] !== undefined
              ) {
                let count = 0;
                visit(body(node), (child) => {
                  if (child.t === "Cite") {
                    count += citations(child).length;
                  }
                });
                if (
                  !span.classes.includes("task-alternatives") && count !== 1
                ) {
                  fail(
                    "CORE.ASSESSMENT_INVALID",
                    "Назначение требует Span позиции",
                  );
                }
                if (span.values.requirement !== undefined) {
                  if (requirement !== undefined) {
                    fail("CORE.ASSESSMENT_INVALID", "Повторный requirement");
                  }
                  requirement = span.values.requirement;
                }
                if (span.values["work-mode"] !== undefined) {
                  if (workMode !== undefined) {
                    fail("CORE.ASSESSMENT_INVALID", "Повторный work-mode");
                  }
                  workMode = span.values["work-mode"];
                }
              }
              for (const key of Object.keys(span.values)) {
                if (
                  ![
                    ...(span.classes.includes("task-alternatives")
                      ? ["selection"]
                      : []),
                    "requirement",
                    "work-mode",
                    "when-format",
                    "unless-format",
                    "when-profile",
                    "unless-profile",
                    "when-meta",
                    "unless-meta",
                  ].includes(key)
                ) {
                  fail(
                    "CORE.ASSESSMENT_INVALID",
                    "Неизвестный Span атрибут " + key,
                  );
                }
              }
            }
          });
          if (group) {
            const inside: string[] = [];
            visit(body(groupNode), (x) => {
              if (x.t === "Cite") {
                for (const cite of citations(x)) {
                  inside.push(String(cite.citationId));
                }
              }
            });
            if (inside.length !== candidates.length) {
              fail(
                "CORE.ASSESSMENT_INVALID",
                "Группа не охватывает всю позицию",
              );
            }
          }
          slots.push({
            id: group?.id ?? candidates[0],
            selection: group?.values.selection ?? "fixed",
            candidates,
            assignment: {
              ...(a.values.stage ? { stage: a.values.stage } : {}),
              requirement: requirement ?? a.values.requirement ?? "required",
              workMode: workMode ?? a.values["work-mode"] ?? "individual",
            },
          });
          memberSizes.push(1);
        }
      }
      assessment = {
        id,
        title,
        kind: config.kind,
        slots,
        ...(config["theory-time"] !== undefined
          ? { theoryTime: Number(config["theory-time"]) }
          : {}),
        ...(config["related-exercise"] !== undefined
          ? { relatedExercise: config["related-exercise"] }
          : {}),
        memberContainers: containers.length,
        memberKinds,
        memberSizes,
      };
    }
    return assessment;
  }
  const assessment = collectAssessment();
  return decode(
    NativeReleaseFactsSchema,
    {
      course: {
        ...(course.id !== undefined ? { id: course.id } : {}),
        view: course.view ??
          (context.projection === "author" ? "full" : "student"),
        adapters: course.adapters ?? [],
      },
      nativeMetadata: {
        adapters: Object.fromEntries(
          (Array.isArray(course.adapters) ? course.adapters : []).filter((
            name,
          ): name is string => typeof name === "string")
            .map((name) => [name, {
              ...(Object.hasOwn(ast.meta, name)
                ? { configuration: adapterMetadata(ast.meta[name]) }
                : {}),
              ...(obj(ast.meta.assessment) && obj(ast.meta.assessment.c) &&
                  Object.hasOwn(ast.meta.assessment.c, name)
                ? { assessment: adapterMetadata(ast.meta.assessment.c[name]) }
                : {}),
            }]),
        ),
        ...(Object.hasOwn(ast.meta, "project-checks")
          ? { projectChecks: adapterMetadata(ast.meta["project-checks"]) }
          : {}),
        ...(Object.hasOwn(ast.meta, "project-materialization")
          ? {
            projectMaterialization: adapterMetadata(
              ast.meta["project-materialization"],
            ),
          }
          : {}),
      },
      ...(assessment ? { assessment } : {}),
      declarations: [...declarations.values()],
    },
    "CORE.RELEASE_METADATA",
    context.input,
  );
}
