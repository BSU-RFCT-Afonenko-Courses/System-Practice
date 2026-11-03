import { SupportedQuartoVersionSchema } from "../infrastructure/quarto-version.ts";
import { basename, dirname, join, relative, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import { assertSources, signature, snapshot } from "./source-snapshot.ts";
import type { SourceSnapshotState } from "./source-snapshot.ts";
import type { NativeCaptureReservation } from "./contracts.ts";
export type AssignmentIntent = { source: string; id: string }[];
export type AssignmentPreparation = {
  assignment: {
    mode: "new";
    profiles?: readonly string[];
    prepare: (owner: Readonly<Record<string, unknown>>) => Promise<{
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
  implementationFiles: { path: string; signature: string }[];
};
export type AssignmentAdmission = {
  source: SourceSnapshotState;
  operation: string;
  owner: Record<string, any>;
  inputs: string[];
  assessments: AssignmentIntent;
  runtime: AssignmentRuntimeWitness;
  invocation: string;
  runtimeHashReads: number;
  runtimeHashBytes: number;
  runtimePathReads: number;
  runtimeDirectoryReads: number;
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
/** Только уже наблюдённые rows: без discovery/IO; несовпадение необратимо проваливает seal. */
export function mergeAssignmentImplementationFiles(
  previous: readonly Readonly<{ path: string; signature: string }>[],
  observed: readonly Readonly<{ path: string; signature: string }>[],
): { path: string; signature: string }[] {
  const rows = new Map<string, { path: string; signature: string }>();
  for (const row of [...previous, ...observed]) {
    const known = rows.get(row.path);
    if (known && known.signature !== row.signature) {
      fail(
        "BODY.PRODUCER_INPUT_CHANGED",
        "Child native implementation dependency изменена " + row.path,
      );
    }
    if (!known) rows.set(row.path, { ...row });
  }
  return [...rows.values()];
}
export async function assertAssignmentRuntime(
  witness: AssignmentRuntimeWitness,
  root: string,
  metrics?: { runtimePathReads: number; runtimeDirectoryReads: number },
  full = false,
) {
  if (
    !witness.outputDirectory.startsWith(root + "/_generated/") ||
    !witness.profiles.includes("full")
  ) {
    invalid("Чужая assignment runtime binding");
  }
  if (!full) return;
  for (const row of witness.implementationFiles) {
    if (metrics) metrics.runtimePathReads++;
    const info = await Deno.lstat(row.path);
    if (
      !info.isFile || info.isSymlink ||
      await Deno.realPath(row.path) !== row.path ||
      signature(info) !== row.signature
    ) {
      fail(
        "BODY.PRODUCER_INPUT_CHANGED",
        "Изменена наблюдённая native implementation dependency " + row.path,
      );
    }
  }
}
export function consumeAssignmentAdmission(value: AssignmentAdmission) {
  if (!admitted.delete(value)) {
    fail("OPERATION_BINDING", "Чужая/повторная assignment preparation");
  }
  return value;
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
    !Array.isArray(requested) || requested.length > 15 ||
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
  const source: SourceSnapshotState = {
    root: reservation.root,
    outputDirectory: reservation.outputDirectory,
    rows: [],
    memberships: {},
    relevantInputs: [],
    metrics: {
      fullWalks: 0,
      sourceDirectoryReads: 0,
      sourceHashReads: 0,
      sourceHashBytes: 0,
      fullSourceFences: 0,
      localSourceFences: 0,
    },
  };
  const { nativeRuntimeIdentity, inspectNativeOwner } = await import(
    "./operation.ts"
  );
  const metrics = { runtimeHashReads: 0, runtimeHashBytes: 0 };
  const invocation = await nativeRuntimeIdentity(source.root, true, metrics);
  const executable = JSON.parse(invocation).physical as string;
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
  await snapshot(source);
  const owner = await inspectNativeOwner(
    source.root,
    profiles,
    executable,
    environment,
  );
  await assertSources(source);
  if (await nativeRuntimeIdentity(source.root, true, metrics) !== invocation) {
    fail("OPERATION_CHANGED", "Runtime изменён во время preparation");
  }
  if (
    owner.dir !== source.root ||
    !SupportedQuartoVersionSchema.safeParse(owner.quarto?.version).success ||
    owner.config?.["course-core-runtime"] !== "native-ts" ||
    owner.config?.["course-core-projection"] !== "author" ||
    !Array.isArray(owner.files?.input)
  ) invalid("Native owner не соответствует author operation");
  const selection = await options.assignment.prepare(
    frozen(structuredClone(owner)),
  );
  if (
    !selection || !Array.isArray(selection.expectedSources) ||
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
    !Array.isArray(selection.assessments) || !selection.assessments.length ||
    selection.assessments.length > 4096 ||
    new Set(selection.assessments.map((p) => p.source + "\0" + p.id)).size !==
      selection.assessments.length ||
    selection.assessments.some((p) =>
      !selection.expectedSources.includes(p.source) ||
      !/^[a-z][a-z0-9-]*$/.test(p.id)
    )
  ) invalid("Неверный assignment intent");
  await assertSources(source);
  const result: AssignmentAdmission = {
    source,
    operation: crypto.randomUUID(),
    owner,
    inputs: [...selection.expectedSources],
    assessments: selection.assessments.map((p) => ({ ...p })),
    invocation,
    ...metrics,
    runtimePathReads: 0,
    runtimeDirectoryReads: 0,
    inspectCalls: 1,
    runtime: {
      executable,
      environment,
      profiles,
      outputDirectory: reservation.outputDirectory,
      inputs: [...selection.expectedSources],
      implementationFiles: [],
    },
  };
  admitted.add(result);
  return result;
}
