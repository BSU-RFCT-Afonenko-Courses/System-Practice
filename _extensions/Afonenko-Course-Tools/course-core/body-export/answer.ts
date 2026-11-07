import {createMetrics as __createMetrics} from "../observability/bridge.ts";
const __metrics=__createMetrics("course-core");
import { diagnostic } from "../domain/diagnostics.ts";
import { decodeAnswerYaml, projectAnswer } from "../document/answers.ts";
import { AnswerFactsSchema } from "../document/answer-contracts.ts";
import { isBulletList, isContainer, isRecord, requireNodes } from "../document/native-ast.ts";
import type { Node } from "./model.ts";
async function validateAnswerWork(source: string, context: {source?: string; id?: string} = {}) {
  try {
    const data = decodeAnswerYaml(source, context.source ?? "answer");
    return {publicAnswer: projectAnswer(data), closedKey: data, answerType: data.type};
  } catch (cause) {
    if (!cause || typeof cause !== "object" || !("code" in cause) || !String(cause.code).startsWith("ANSWER_")) throw cause;
    throw diagnostic(String(cause.code), cause instanceof Error ? cause.message : String(cause), {...context, field: "answer"}, cause);
  }
}

async function projectChoiceWork(
  b: Node,
  context: { source?: string; id?: string } = {},
) {
  const list = isContainer(b) && b.c[1].length === 1 ? b.c[1][0] : undefined;
  if (!isContainer(b) || !b.c[0][2].some(([key, value]) => key === "type" && value === "single-choice") || !isBulletList(list)) {
    throw diagnostic(
      "ADAPTER",
      "Компонент Core/projectChoice: неподдерживаемая структура ответа single-choice",
      { ...context, field: "answer" },
    );
  }
  let correct = -1, count = 0;
  const strip = (v: unknown, index: number): unknown => {
    if (Array.isArray(v)) {
      return v.flatMap((x) => {
        if (isRecord(x) && x.t === "Span") {
          if (!isContainer(x)) {
            throw diagnostic("ANSWER_INVALID", "Повреждённый native Span в single-choice", {
              ...context, field: "answer",
            });
          }
          if (x.c[0][1].includes("correct")) {
            correct = index;
            count++;
            return strip(x.c[1], index);
          }
        }
        return [strip(x, index)];
      });
    }
    if (isRecord(v)) {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, strip(x, index)]),
      );
    }
    return v;
  };
  const clean = list.c.map((c, i) => requireNodes(strip(c, i)));
  const parsed = AnswerFactsSchema.safeParse({
    type: "single-choice",
    count: clean.length,
    correct,
  });
  if (count !== 1 || !parsed.success) {
    throw diagnostic(
      "ANSWER_INVALID",
      "single-choice требует ровно один correct и не менее двух вариантов",
      { ...context, field: "answer" },
      parsed.success ? undefined : parsed.error,
    );
  }
  return {
    answerType: "single-choice",
    closedKey: { correct },
    publicAnswer: [{ t: "BulletList", c: clean }],
  };
}

export const validateAnswer = __metrics.wrapAsync({id:"course-core.body-export.answer.validateAnswer",kind:"phase"}, validateAnswerWork);
export const projectChoice = __metrics.wrapAsync({id:"course-core.body-export.answer.projectChoice",kind:"phase"}, projectChoiceWork);
