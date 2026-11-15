import { resolve } from "stdlib/path";
import { diagnostic } from "../diagnostics.ts";
import { finish, prepareNativeDownloads } from "../infrastructure/runtime.ts";
import type { PreparedDownloads } from "../infrastructure/runtime.ts";
import { sibling } from "../infrastructure/siblings.ts";
try {
  if (Deno.env.get("COURSE_SITE_DEFER_DOWNLOADS") === "1") Deno.exit(0);
  const root = await Deno.realPath(Deno.cwd());
  let count: number;
  if (Deno.args.includes("--native")) {
    const output = Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR");
    if (!output) {
      throw diagnostic(
        "DOWNLOAD.REQUEST_INVALID",
        "Native hook не передал текущий output",
        {
          source: root,
          field: "outputDirectory",
        },
      );
    }
    const Core = await sibling("course-core");
    const pending: { draft?: PreparedDownloads } = {};
    try {
      const prepared = await Core.withNativePublication(
        {
          root,
          profiles: (Deno.env.get("QUARTO_PROFILE") || "")
            .split(",")
            .filter(Boolean),
          projection: Deno.args.includes("--author") ? "author" : "student",
          outputDirectory: resolve(root, output),
        },
        undefined,
        async (publication) => {
          if (publication.course.adapters.includes("prairielearn")) {
            await (
              await sibling("course-prairielearn")
            ).inspectPublication(publication);
          }
          pending.draft = await prepareNativeDownloads(publication, {});
          return pending.draft;
        },
      );
      count = await prepared.publish();
    } catch (cause) {
      try {
        await pending.draft?.discard();
      } catch {
        /* Сохраняем primary cause. */
      }
      throw cause;
    }
  } else {
    count = await finish(root);
  }
  console.log(`Подготовлено архивов материалов: ${count}`);
} catch (error) {
  if (
    error instanceof Error &&
    ["ExtensionDiagnostic", "ExternalToolFailure"].includes(error.name)
  ) {
    console.error(error.message);
    Deno.exit(1);
  }
  throw error;
}
