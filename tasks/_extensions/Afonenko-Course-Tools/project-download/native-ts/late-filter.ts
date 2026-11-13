import { resolveDownloadRequests } from "../domain/request.ts";
import { diagnostic } from "../diagnostics.ts";
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const inspection: unknown = JSON.parse(
  await new Response(Deno.stdin.readable).text(),
);
const ast = record(inspection) ? inspection : undefined;
const meta = ast && record(ast.meta) ? ast.meta : undefined;
const field = meta?.["project-download-native-batch"];
if (
  !ast ||
  !record(field) ||
  field.t !== "MetaString" ||
  typeof field.c !== "string"
) {
  throw diagnostic(
    "DOWNLOAD.REQUEST_INVALID",
    "Отсутствует native Download batch",
  );
}
const batch: unknown = JSON.parse(field.c);
const result = resolveDownloadRequests(batch);
await Deno.stdout.write(
  new TextEncoder().encode(
    JSON.stringify({
      "pandoc-api-version": ast["pandoc-api-version"],
      meta: {
        "project-download-native-result": {
          t: "MetaString",
          c: JSON.stringify(result),
        },
      },
      blocks: [],
    }),
  ),
);
