import { assignmentAnswerTransport } from "./assignment-primary.ts";
import type { AssignmentEarly } from "./assignment-contracts.ts";
import type { DocumentContext } from "./contracts.ts";
import { isAlias, parseDocument } from "../body-export/vendor/libraries.js";
import { boundInput, fail } from "../contracts/project.ts";
import { AnswerFactsSchema, AnswerSpecSchema } from "./answer-contracts.ts";
import type { AnswerFacts, AnswerSpec } from "./answer-contracts.ts";
import { decode } from "./contracts.ts";
import { isRecord as object, isContainer, isCode, isBulletList, nodeAttributes as attr } from "./native-ast.ts";
import type { Node } from "./native-ast.ts";
const para = (s: string): Node => ({ t: "Para", c: [{ t: "Str", c: s }] });
export function projectAnswer(a: AnswerSpec): Node[] {
  if (a.type === "numeric") return [para("Ответ: ____________________")];
  if (a.type === "manual") {
    return [para("Ответ: ________________________________________")];
  }
  if (a.type === "multipart") {
    return a.parts.flatMap((p) => [para(p.label), ...projectAnswer(p)]);
  }
  return [
    para("Условия"),
    { t: "BulletList", c: a.prompts.map((p) => [para(p)]) },
    para("Варианты"),
    { t: "BulletList", c: a.options.map((p) => [para(p)]) },
    para("Соответствия: ____________________"),
  ];
}
export function decodeAnswerYaml(source: string, input: string): AnswerSpec {
  if (source.length > 65536) {
    fail("ANSWER_YAML", "Слишком большой YAML ответа", input);
  }
  const raw: unknown = parseDocument(source, { uniqueKeys: true, version: "1.2" });
  if (!object(raw) || !Array.isArray(raw.errors) || !Array.isArray(raw.warnings) || typeof raw.toJS !== "function") fail("ANSWER_YAML", "Повреждённый YAML document", input);
  if (raw.errors.length || raw.warnings.length) {
    fail(
      "ANSWER_YAML",
      "Требуется один YAML-словарь без повторных ключей",
      input,
    );
  }
  function check(v: unknown) {
    if (!object(v)) return;
    if (isAlias(v) || v.anchor || v.tag) {
      fail("ANSWER_YAML", "Aliases/anchors/tags ответа запрещены", input);
    }
    if (Array.isArray(v.items)) for (const x of v.items) check(x);
    check(v.key);
    check(v.value);
  }
  check(raw.contents);
  const value: unknown = raw.toJS({ maxAliasCount: 0 });
  boundInput(value, input);
  return decode(AnswerSpecSchema, value, "ANSWER_INVALID", input);
}
/** Все raw ответы проверяются до visibility/conditional projection; замены не содержат ключей. */
export function collectAnswers(
  blocks: unknown[],
  input: string,
  transport?: { context: DocumentContext; answers: AssignmentEarly["answers"] },
) {
  const answers: Record<string, AnswerFacts> = {},
    replacements = new Map<object, unknown[]>();
  function put(id: string, answer: AnswerFacts, node: object, body: Node[]) {
    if (Object.hasOwn(answers, id)) {
      fail(
        "ANSWER_INVALID",
        "У упражнения может быть только один банк ответов",
        input,
        id,
      );
    }
    answers[id] = answer;
    replacements.set(
      node,
      transport
        ? assignmentAnswerTransport(
          id,
          answer,
          body,
          transport.context,
          transport.answers,
        )
        : body,
    );
  }
  function walk(
    v: unknown,
    owner?: string,
    role?: "solution" | "answer",
    choiceIndex?: number,
    marks?: number[],
  ) {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, owner, role, choiceIndex, marks);
      return;
    }
    if (!object(v)) return;
    const a = attr(v, input), classes = a?.[1] ?? [];
    let next = owner, nextRole = role;
    if (v.t === "Div" && a?.[0].startsWith("exr-")) next = a[0];
    if (
      v.t === "Div" &&
      (classes.includes("solution") || String(a?.[0]).startsWith("sol-"))
    ) nextRole = "solution";
    if (classes.includes("correct")) {
      if (
        !isContainer(v) || v.t !== "Span" || role !== "answer" || choiceIndex === undefined ||
        !marks
      ) {
        fail(
          "ANSWER_INVALID",
          "Маркер correct допустим только внутри ответа single-choice",
          input,
          owner,
        );
      }
      marks.push(choiceIndex);
      replacements.set(v, v.c[1]);
    }
    if (classes.includes("answer") || classes.includes("answer-spec")) {
      if (
        !next || role || classes.includes("correct") ||
        (classes.includes("answer") && classes.includes("answer-spec"))
      ) {
        fail(
          "ANSWER_INVALID",
          "Ответ должен принадлежать упражнению вне закрытых блоков",
          input,
          next,
        );
      }
      if (classes.includes("answer-spec")) {
        if (!isCode(v) || v.t !== "CodeBlock") {
          fail(
            "ANSWER_INVALID",
            "Банк ответов должен быть CodeBlock",
            input,
            next,
          );
        }
        const answer = decodeAnswerYaml(v.c[1], input);
        put(next, answer, v, projectAnswer(answer));
        return;
      }
      if (
        !isContainer(v) || v.t !== "Div" || Object.fromEntries(v.c[0][2]).type !== "single-choice" ||
        v.c[1].length !== 1 || !isBulletList(v.c[1][0])
      ) {
        fail(
          "ANSWER_INVALID",
          "single-choice требует один BulletList",
          input,
          next,
        );
      }
      const list = v.c[1][0];
      if (!isBulletList(list)) fail("ANSWER_INVALID", "Некорректный BulletList", input, next);
      const items = list.c, marked: number[] = [];
      items.forEach((item, index) => walk(item, next, "answer", index, marked));
      if (marked.length !== 1) {
        fail(
          "ANSWER_INVALID",
          "single-choice требует ровно один correct",
          input,
          next,
        );
      }
      const answer = decode(
        AnswerFactsSchema,
        { type: "single-choice", count: items.length, correct: marked[0] },
        "ANSWER_INVALID",
        input,
      );
      put(next, answer, v, v.c[1]);
      return;
    }
    for (const child of Object.values(v)) {
      walk(child, next, nextRole, choiceIndex, marks);
    }
  }
  walk(blocks);
  return { answers, replacements };
}
