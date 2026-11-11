import { isRecord } from "./record.ts";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]!),
  );
export interface ExerciseIndexRequest {
  role?: "demonstration" | "discussion" | "independent-study" | "control";
  groupBy?: ("semester" | "difficulty")[];
}
export interface ExerciseIndexTopic {
  semester: string;
  categories: readonly string[];
}

/** Core передаёт уже проверенную видимость и готовую текстовую подпись. */
export interface ExerciseIndexDocument {
  source: string;
  exercises: readonly {
    id: string;
    title: string;
    anchor: string;
    role?: string;
    difficulty: string;
    time?: number;
  }[];
}
/** Указатель — представление фактически выживших native occurrences, не второй Course. */
export function renderExerciseIndex(
  documents: readonly ExerciseIndexDocument[],
  topicFor: (source: string) => ExerciseIndexTopic | undefined,
  link: (source: string, anchor: string) => string,
  request: unknown = {},
): string {
  if (!isRecord(request)) throw Error("Invalid course-exercise-index request");
  if (
    Object.keys(request).some((k) => !["role", "groupBy"].includes(k)) ||
    request.role !== undefined &&
      (typeof request.role !== "string" ||
        !["demonstration", "discussion", "independent-study", "control"]
          .includes(request.role))
  ) throw Error("Unknown course-exercise-index parameter/role");
  const groupBy = request.groupBy ?? ["semester", "difficulty"];
  if (
    !Array.isArray(groupBy) || !groupBy.length ||
    new Set(groupBy).size !== groupBy.length ||
    groupBy.some((g) => g !== "semester" && g !== "difficulty")
  ) throw Error("Invalid course-exercise-index group-by");
  const rows = documents.flatMap((doc) => {
    const source = doc.source;
    const topic = topicFor(source);
    if (!topic) {
      throw Error("Index topic absent for current document: " + source);
    }
    const seen = new Set<string>();
    return doc.exercises.flatMap((exercise) => {
      if (seen.has(exercise.id)) return [];
      seen.add(exercise.id);
      if (request.role && exercise.role !== request.role) return [];
      return [{
        ...exercise,
        source,
        semester: topic.semester,
        categories: topic.categories,
      }];
    });
  });
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = groupBy.map((field) =>
      field === "semester" ? row.semester : row.difficulty
    ).join(" / ");
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  return '<nav class="course-exercise-index" aria-label="Указатель упражнений">' +
    [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map((
      [group, items],
    ) =>
      "<section><h2>" + esc(group) + "</h2><ul>" + items.sort((a, b) =>
        a.id.localeCompare(b.id)
      ).map((row) =>
        "<li><code>" + esc(row.id) + '</code> — <a href="' +
        esc(link(row.source, row.anchor)) + '">' + esc(row.title) + "</a> — " +
        esc(row.categories.join(", ")) + " — " + esc(String(row.time ?? "?")) +
        " мин</li>"
      ).join("") + "</ul></section>"
    ).join("") + "</nav>";
}
