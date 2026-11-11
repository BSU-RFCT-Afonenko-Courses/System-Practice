import { diagnostic } from "../diagnostics.ts";
import { quarto } from "../infrastructure/process.ts";
import { resolve } from "../infrastructure/files.ts";
import { publish } from "../infrastructure/publish.ts";
import {
  parsePostInspection,
  postConfiguration,
  postOutputDirectory,
  postQuartoVersion,
} from "../infrastructure/post-input.ts";
async function main(): Promise<void> {
  const root = Deno.cwd();
  const profiles = Deno.env.get("QUARTO_PROFILE");
  const inspection: unknown = parsePostInspection(
    await quarto([
      "inspect",
      root,
      ...(profiles ? ["--profile", profiles] : []),
    ], root),
    root,
  );
  const { config, namespace } = postConfiguration(inspection, root);
  const version = postQuartoVersion(inspection, root);
  const outputListFile = Deno.env.get(
    "QUARTO_USE_FILE_FOR_PROJECT_OUTPUT_FILES",
  );
  const outputList = outputListFile
    ? await Deno.readTextFile(resolve(root, outputListFile))
    : Deno.env.get("QUARTO_PROJECT_OUTPUT_FILES");
  if (outputList === undefined) {
    throw diagnostic(
      "QRC.OUTPUT_INVALID",
      "post-render требует текущий QUARTO_PROJECT_OUTPUT_FILES",
      { source: root, field: "QUARTO_PROJECT_OUTPUT_FILES" },
    );
  }
  const outputs = outputList.split(/\r?\n/).filter((path) => path.length > 0);
  await publish({
    root,
    stage: resolve(
      root,
      postOutputDirectory(
        config,
        Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR"),
        root,
      ),
    ),
    quarto: version,
    config,
    members: [{ namespace, format: "html" }],
    scope: "local",
    outputs,
  });
}
try {
  await main();
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
