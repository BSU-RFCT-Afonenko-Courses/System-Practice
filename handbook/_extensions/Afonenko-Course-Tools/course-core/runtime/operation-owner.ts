import { relative, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import { decodeNativeOwnerInspection } from "../infrastructure/native-owner-inspection.ts";
import type { NativeOwnerInspection } from "../infrastructure/native-owner-inspection.ts";
import { command, quartoExecutable } from "../infrastructure/process.ts";
import { pathSchema, record } from "./operation-store.ts";
import type { State } from "./operation-store.ts";

/** Observed native owner binding shared by ordinary and prepared capture. */
export async function inspectNativeOwner(
  root: string,
  profiles: string[],
  executable = quartoExecutable(),
  environment?: Record<string, string>,
): Promise<NativeOwnerInspection> {
  const args = [
    "inspect",
    root,
    ...(profiles.length ? ["--profile", profiles.join(",")] : []),
  ];
  if (!environment) {
    const value: unknown = JSON.parse(await command(executable, args, root));
    return decodeNativeOwnerInspection(value, root);
  }
  const result = await new Deno.Command(executable, {
    args,
    cwd: root,
    env: environment,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    fail(
      "BODY.PRODUCER_INSPECTION_FAILED",
      new TextDecoder().decode(result.stderr),
    );
  }
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
  );
  return decodeNativeOwnerInspection(value, root);
}
export function bindOwner(
  state: State,
  owner: NativeOwnerInspection,
  expectedProjection: boolean,
  nativeOutput?: string,
) {
  const root = state.root;
  state.ownerInputs = owner.files.input.map((path) =>
    relative(root, resolve(root, path))
  );
  if (
    !state.ownerInputs.length ||
    new Set(state.ownerInputs).size !== state.ownerInputs.length ||
    state.ownerInputs.some((path) => !pathSchema.safeParse(path).success)
  ) fail("OPERATION_BINDING", "Некорректный native owner input scope");
  let outputDirectory = state.outputDirectory;
  const view = record(owner.config.course)
    ? owner.config.course.view
    : undefined;
  const projection = owner.config?.["course-core-projection"] ??
    (view === "full" ? "author" : "student");
  if (
    (owner.config?.["course-core-runtime"] ?? "native-ts") !== "native-ts" ||
    (projection !== "student" && projection !== "author") ||
    (view !== undefined &&
      view !== (projection === "author" ? "full" : "student"))
  ) {
    fail(
      "OPERATION_UNQUALIFIED",
      "Требуется согласованный native-ts Quarto>=1.11.5 owner/projection",
    );
  }
  if (expectedProjection && projection !== state.projection) {
    fail("OPERATION_BINDING", "Reservation projection отличается");
  }
  state.projection = projection;
  const output = nativeOutput ??
    (record(owner.config.project)
      ? owner.config.project["output-dir"]
      : undefined) ??
    "_site";
  if (typeof output !== "string") {
    fail("OPERATION_BINDING", "Native output не является путём");
  }
  outputDirectory = resolve(
    root,
    output,
  );
  if (outputDirectory !== state.outputDirectory) {
    fail("OPERATION_BINDING", "Native output отличается");
  }
  state.ownerWitness = {
    quarto: { version: owner.quarto.version },
    dir: owner.dir,
    config: structuredClone(owner.config),
    files: {
      input: [...owner.files.input],
      config: [...(owner.files.config ?? [])],
    },
  };
}
