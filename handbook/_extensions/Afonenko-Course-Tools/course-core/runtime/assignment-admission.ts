const nativeArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);
import { basename, dirname, join, relative, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import type { NativeCaptureReservation } from "./contracts.ts";
import type { NativeOwnerInspection } from "../infrastructure/native-owner-inspection.ts";
export type AssignmentIntent = { source: string; id: string }[];
export type AssignmentPreparation = {
  assignment: {
    mode: "new";
    profiles?: readonly string[];
    prepare: (owner: Readonly<NativeOwnerInspection>) => Promise<{
      expectedSources: readonly string[];
      assessments: readonly { source: string; id: string }[];
    }>;
  };
};
/** Наблюдённый native запуск владельца; не external producer qualification. */
export type AssignmentRuntimeWitness = {
  executable: string;
  environment: Record<string, string>;
  profiles: string[];
  outputDirectory: string;
  inputs: string[];
};
export type AssignmentAdmission = {
  source: {
    root: string;
    outputDirectory: string;
    ownerInputs?: readonly string[];
  };
  operation: string;
  owner: NativeOwnerInspection;
  inputs: string[];
  assessments: AssignmentIntent;
  runtime: AssignmentRuntimeWitness;
  inspectCalls: number;
};
const admitted = new WeakSet<object>();
const frozen = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};
function invalid(s: string): never {
  return fail("BODY.PRODUCER_INPUT_UNQUALIFIED", s);
}
/** Bound input/source identifies owner; cwd не является source authority. */
export function nativeAssignmentOwner(
  input: string,
  source: unknown,
  capture: unknown,
  operation: string,
) {
  if (
    typeof input !== "string" || !input.startsWith("/") ||
    input.includes("\0") || resolve(input) !== input ||
    typeof source !== "string" || !source || source.startsWith("/") ||
    /[\\\0]/.test(source) ||
    source.split("/").some((p) => !p || p === "." || p === "..") ||
    !input.endsWith("/" + source)
  ) {
    invalid("Native input/source owner binding отличается");
  }
  const root = input.slice(0, -source.length - 1) || "/";
  if (
    typeof capture !== "string" || resolve(capture) !== capture ||
    dirname(capture) !==
      join(root, "_generated/course-spec/native-ts", operation) ||
    !/^(0|[1-9][0-9]*)$/.test(basename(capture))
  ) invalid("Native capture/owner/operation binding отличается");
  return root;
}
export function consumeAssignmentAdmission(value: AssignmentAdmission) {
  if (!admitted.delete(value)) {
    fail("OPERATION_BINDING", "Чужая/повторная assignment preparation");
  }
  return value;
}
async function assignmentExecutable(root: string) {
  const { quartoExecutable } = await import("../infrastructure/process.ts");
  const requestedExecutable = quartoExecutable();
  const candidates = /[\\/]/.test(requestedExecutable)
    ? [resolve(root, requestedExecutable)]
    : (Deno.env.get("PATH") ?? "").split(
      Deno.build.os === "windows" ? ";" : ":",
    )
      .map((directory) => resolve(root, directory || ".", requestedExecutable));
  let executable: string | undefined;
  for (const candidate of candidates) {
    try {
      if ((await Deno.stat(candidate)).isFile) {
        executable = await Deno.realPath(candidate);
        break;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  if (!executable) invalid("Quarto executable не найден");
  return executable;
}
async function prepareAssignmentSelection(
  options: AssignmentPreparation,
  owner: NativeOwnerInspection,
  source: AssignmentAdmission["source"],
) {
  const selection = await options.assignment.prepare(
    frozen(structuredClone(owner)),
  );
  if (
    !selection || !nativeArray(selection.expectedSources) ||
    !selection.expectedSources.length ||
    selection.expectedSources.length > 4096 ||
    new Set(selection.expectedSources).size !==
      selection.expectedSources.length ||
    selection.expectedSources.some((p) =>
      typeof p !== "string" ||
      !owner.files.input.includes(join(source.root, p)) ||
      p !== relative(source.root, join(source.root, p)) ||
      p.split("/").some((s) => !s || s === "." || s === "..")
    )
  ) invalid("Неверный prepared source scope");
  if (
    !nativeArray(selection.assessments) || !selection.assessments.length ||
    selection.assessments.length > 4096 ||
    new Set(selection.assessments.map((p) => p.source + "\0" + p.id)).size !==
      selection.assessments.length ||
    selection.assessments.some((p) =>
      !selection.expectedSources.includes(p.source) ||
      !/^[a-z][a-z0-9-]*$/.test(p.id)
    )
  ) invalid("Неверный assignment intent");
  return selection;
}
export async function prepareAssignment(
  reservation: NativeCaptureReservation,
  options: AssignmentPreparation,
): Promise<AssignmentAdmission> {
  if (
    options?.assignment?.mode !== "new" ||
    Object.keys(options).some((k) => k !== "assignment") ||
    Object.keys(options.assignment).some((k) =>
      !["mode", "prepare", "profiles"].includes(k)
    ) ||
    typeof options.assignment.prepare !== "function"
  ) invalid("Требуется явное новое assignment intent");
  const requested = options.assignment.profiles ?? [];
  if (
    !nativeArray(requested) || requested.length > 15 ||
    new Set(requested).size !== requested.length ||
    requested.some((p) =>
      typeof p !== "string" || !/^[-a-z0-9]+$/.test(p) ||
      ["student", "full"].includes(p)
    )
  ) {
    invalid("Требуются уникальные functional profiles без student/full");
  }
  if (
    reservation.projection !== "author" ||
    await Deno.realPath(reservation.root) !== reservation.root ||
    resolve(reservation.outputDirectory) !== reservation.outputDirectory ||
    !reservation.outputDirectory.startsWith(reservation.root + "/_generated/")
  ) invalid("Assignment требует canonical owner, author и служебный output");
  const profiles = [...requested, "full"];
  const source = {
    root: reservation.root,
    outputDirectory: reservation.outputDirectory,
    ownerInputs: [] as string[],
  };
  const { inspectNativeOwner } = await import("./operation-owner.ts");
  const executable = await assignmentExecutable(source.root);
  const environment = { ...Deno.env.toObject() };
  // Quarto child создаёт собственный project/script transport; host CLI не переносит его.
  for (const key of Object.keys(environment)) {
    if (
      /^QUARTO_(?:PROJECT_|USE_FILE_FOR_PROJECT_|FILTER_|SCRIPT_|DOCUMENT_)/
        .test(key) || /^COURSE_CORE_(?:CAPTURE|TS)_/.test(key)
    ) delete environment[key];
  }
  Object.assign(environment, {
    QUARTO: executable,
    QUARTO_PROFILE: profiles.join(","),
    QUARTO_RUN_NO_NETWORK: "true",
    DENO_NO_PACKAGE_JSON: "1",
  });
  delete environment.COURSE_CORE_CAPTURE_TOKEN;
  const owner = await inspectNativeOwner(
    source.root,
    profiles,
    executable,
    environment,
  );
  source.ownerInputs = owner.files.input.map((path) =>
    relative(source.root, resolve(source.root, path))
  );
  if (
    !source.ownerInputs.length ||
    new Set(source.ownerInputs).size !== source.ownerInputs.length ||
    source.ownerInputs.some((path) =>
      !path || path.startsWith("/") || /[\\\0]/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
  ) {
    invalid("Некорректный native owner input scope");
  }
  if (
    owner.config?.["course-core-runtime"] !== "native-ts" ||
    owner.config?.["course-core-projection"] !== "author"
  ) invalid("Native owner не соответствует author operation");
  const selection = await prepareAssignmentSelection(options, owner, source);
  const result: AssignmentAdmission = {
    source,
    operation: crypto.randomUUID(),
    owner,
    inputs: [...selection.expectedSources],
    assessments: selection.assessments.map((p) => ({ ...p })),
    inspectCalls: 1,
    runtime: {
      executable,
      environment,
      profiles,
      outputDirectory: reservation.outputDirectory,
      inputs: [...selection.expectedSources],
    },
  };
  admitted.add(result);
  return result;
}
