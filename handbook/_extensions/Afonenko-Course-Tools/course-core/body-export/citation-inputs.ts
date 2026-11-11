import { dirname, isAbsolute, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import { visibleTitle } from "../document/title.ts";
import type { NativePublicDocument } from "../runtime/contracts.ts";
import { stableToolCachePath } from "../infrastructure/tool-cache.ts";
import { excluded, regular } from "../runtime/source-paths.ts";
export type CitationFileKey = "bibliography" | "csl" | "citation-abbreviations";
function paths(value: unknown): string[] {
  if (
    !value || typeof value !== "object" || !("t" in value) || !("c" in value)
  ) {
    return fail(
      "BODY.CITATION_METADATA_UNQUALIFIED",
      "Неизвестная native file metadata",
    );
  }
  const meta = value;
  if (meta?.t === "MetaList" && Array.isArray(meta.c)) {
    return meta.c.flatMap(paths);
  }
  if (meta?.t === "MetaString" && typeof meta.c === "string") return [meta.c];
  if (
    meta?.t === "MetaInlines" && Array.isArray(meta.c) &&
    meta.c.every((n: unknown) =>
      n && typeof n === "object" && "t" in n &&
      ["Str", "Space", "SoftBreak"].includes(String(n.t))
    )
  ) return [visibleTitle(meta.c)];
  return fail(
    "BODY.CITATION_METADATA_UNQUALIFIED",
    "Неизвестная native file metadata",
  );
}
/** Только файловые значения из настоящих citation metadata выбранного документа. */
export function citationFileInputs(
  meta: Record<string, unknown>,
): { key: CitationFileKey; path: string }[] {
  return (["bibliography", "csl", "citation-abbreviations"] as const).flatMap(
    (key) => {
      if (meta[key] === undefined) return [];
      return paths(meta[key]).map((path) => {
        if (
          !path || /[\\\0]/.test(path) ||
          /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)
        ) {
          fail(
            "BODY.CITATION_METADATA_UNQUALIFIED",
            "Нужен локальный citation file",
          );
        }
        return { key, path };
      });
    },
  );
}
const privateParts =
  /(^|\/)(?:private|reference|solution|solutions|grading-notes|rubric\.md|contract\.md|closed-tests|tests)(\/|$)/i;
/** Разрешение внешнего файла не распространяется на другие ресурсы или targets. */
export function citationResourceGuard(
  owner: {
    root: string;
    outputDirectory: string;
    cacheDirectory?: string | undefined;
  },
  documents: readonly Pick<NativePublicDocument, "context" | "assignment">[],
  roles: {
    assertPath: (path: string) => void;
    assertIdentity: (identity: string) => void;
  },
) {
  return async (
    source: string,
    key: CitationFileKey,
    path: string,
  ): Promise<void> => {
    const doc = documents.find((doc) => doc.context.input === source);
    if (
      !doc?.assignment ||
      !citationFileInputs(doc.assignment.citationMetadata).some((input) =>
        input.key === key && input.path === path
      )
    ) {
      fail(
        "BODY.CITATION_METADATA_UNQUALIFIED",
        "Citation file не объявлен в выбранном native документе",
      );
    }
    const absolute = resolve(dirname(resolve(owner.root, source)), path);
    roles.assertPath(absolute);
    const configured = owner.cacheDirectory ?? Deno.env.get("XDG_CACHE_HOME");
    const cache = configured && isAbsolute(configured)
      ? resolve(configured)
      : undefined;
    if (
      privateParts.test(absolute) || excluded(owner, absolute) ||
      stableToolCachePath(absolute) ||
      cache && (absolute === cache || absolute.startsWith(cache + "/"))
    ) {
      fail(
        "BODY.RESOURCE_PRIVATE_ROLE",
        "Закрытый или служебный citation input",
      );
    }
    const physical = await regular("/", absolute.slice(1));
    const file = await Deno.open(physical, { read: true });
    try {
      const info = await file.stat();
      if (!info.isFile || info.dev === null || info.ino === null) {
        fail("RESOURCE_PATH", "Недоступна physical identity citation input");
      }
      roles.assertIdentity(JSON.stringify([info.dev, info.ino]));
    } finally {
      file.close();
    }
  };
}
