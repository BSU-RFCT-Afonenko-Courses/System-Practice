import { createMetrics as __createMetrics } from "../observability/bridge.ts";
import { visibleTitle } from "../document/title.ts";
export { decodeNativeOwnerInspection } from "../infrastructure/native-owner-inspection.ts";
export type { NativeOwnerInspection } from "../infrastructure/native-owner-inspection.ts";
import { finishedNativeResource } from "./native-output-resources.ts";
import { NativeProjectFactsCaptureSchema } from "../document/project-facts.ts";
import {
  NativePreparedOperationSchema,
  withPreparedLease,
} from "./prepared-operation.ts";
import type {
  NativeCaptureScope,
  NativePreparedLease,
} from "./prepared-operation.ts";
import { assertAssignmentDeclarations } from "./assignment-declarations.ts";
import {
  runAssignmentCaptureChild,
  withAssignmentBeforeChild,
  withAssignmentExecution,
} from "./assignment-execution.ts";
import { consumeAssignmentAdmission } from "./assignment-admission.ts";
import type { AssignmentAdmission } from "./assignment-admission.ts";
import { excluded, ownedPhysical, regular } from "./source-paths.ts";
import { toolCachePath } from "../infrastructure/tool-cache.ts";
import { nativeMetadata } from "../release/collect.ts";
import { createNativePublication } from "../release/publication.ts";
import type {
  NativePublication,
  NativePublicationSelection,
} from "../release/publication.ts";
import { dirname, join, relative, resolve } from "stdlib/path";
// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
import { fail } from "../contracts/project.ts";
import {
  decode,
  EarlyDocumentSchema,
  LateDocumentSchema,
} from "../document/contracts.ts";
import { finalizeDocument } from "../document/finalize.ts";
import { immutable } from "../document/condition.ts";
import { safeParent } from "../artifacts/files.ts";
import {
  NativeCaptureReservationSchema,
  NativeCaptureScopeOptionsSchema,
  NativeCatalogSchema,
  NativeOperationExpectationSchema,
  NativeOperationIdentitySchema,
  NativePendingOperationExpectationSchema,
  NativePendingOperationSchema,
  NativePublicDocumentSchema,
  NativeWebFormatSchema,
} from "./contracts.ts";
import type {
  NativeCaptureReservation,
  NativeCaptureScopeOptions,
  NativeOperationExpectation,
  NativePendingOperationExpectation,
} from "./contracts.ts";
import {
  activeChild,
  assertPrivate,
  assertReservationCurrent,
  base,
  completeSchema,
  json,
  nativePointer,
  operationMetricKeys,
  pathSchema,
  pointer,
  readOptionalPointer,
  readReservation,
  record,
  reservationPath,
  same,
  stateSchema,
  withWriter,
  writePrivate,
} from "./operation-store.ts";
import type { Reservation, State } from "./operation-store.ts";
import { publicOperation } from "./operation-reader.ts";
import { bindOwner, inspectNativeOwner } from "./operation-owner.ts";
export { bindOwner, inspectNativeOwner } from "./operation-owner.ts";
import { ordinaryResourcePath as ordinary } from "./operation-resources.ts";

function observedDelta(value: number | undefined, before: number | undefined) {
  if (typeof value !== "number" || typeof before !== "number") {
    fail("METRICS_UNAVAILABLE", "Fresh capture required for metric delta");
  }
  return value - before;
}
const nativeCaptureSchema = z.strictObject({
  assignmentDeclarations: z.array(z.unknown()).max(16384).optional(),
  output: z.string(),
  body: z.array(z.unknown()),
  role: z.enum(["exercise-bank", "page"]),
  resources: z.array(
    z.strictObject({
      source: z.string(),
      output: z.string(),
      media: z.number().int().min(1).max(4096).optional(),
    }),
  ),
});
async function nativeFileSelection(root: string, key: string) {
  const file = Deno.env.get(
    key.replace("QUARTO_PROJECT_", "QUARTO_USE_FILE_FOR_PROJECT_"),
  );
  const content = file ? await Deno.readTextFile(file) : Deno.env.get(key);
  return {
    explicitlyEmpty: content === "",
    files: (content ?? "").split(/\r?\n/).filter(Boolean).map((p) =>
      resolve(root, p)
    ),
  };
}
async function envFiles(root: string, key: string) {
  return (await nativeFileSelection(root, key)).files;
}
/** No-work — только native hook lifecycle, не пустая capture/assignment операция. */
async function invalidateNoWorkHook(root: string) {
  const nativeRoot = Deno.env.get("QUARTO_PROJECT_DIR"),
    output = Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR");
  decode(
    NativeOperationExpectationSchema.shape.profiles,
    (Deno.env.get("QUARTO_PROFILE") || "").split(",").filter(Boolean),
    "OPERATION_BINDING",
  );
  if (
    nativeRoot !== root || await Deno.realPath(Deno.cwd()) !== root ||
    !output || output !== resolve(output) ||
    !output.startsWith(root + "/") || toolCachePath(root, output) ||
    Deno.env.get("COURSE_CORE_CAPTURE_TOKEN") !== undefined
  ) {
    fail(
      "OPERATION_BINDING",
      "Zero-work требует обычного native hook owner/output без capture token",
    );
  }
  await safeParent(output);
  const current = await readOptionalPointer(root);
  if (!current) return;
  await ownedPhysical(root, relative(root, current.directory));
  try {
    await Deno.lstat(join(current.directory, "reservation.json"));
    fail(
      "OPERATION_BINDING",
      "Zero-work не может инвалидировать capture reservation",
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const state = decode(
    stateSchema,
    await json(
      await regular(
        root,
        relative(root, join(current.directory, "state.json")),
      ),
    ),
    "OPERATION_BINDING",
  );
  if (
    state.root !== root || state.operation !== current.operation ||
    state.directory !== current.directory || state.assignment
  ) fail("OPERATION_BINDING", "Zero-work не принадлежит ordinary operation");
  await withWriter(root, async () => {
    if (!same(await readOptionalPointer(root), current)) {
      fail(
        "OPERATION_CHANGED",
        "Operation pointer заменён во время zero-work hook",
      );
    }
    await Deno.remove(await regular(root, relative(root, pointer(root))));
  });
}
async function failReservation(r: Reservation) {
  try {
    await withWriter(r.root, async () => {
      const current = await readReservation(r.root);
      if (current.operation === r.operation && current.status !== "sealed") {
        current.status = "failed";
        await writePrivate(reservationPath(current), current);
      }
    });
  } catch { /* A replaced pointer is never restored or removed. */ }
}
/** One bounded owner series; the first actual native pre supplies ordered profiles. */
export async function withNativeCaptureScope<T>(
  reservationValue: NativeCaptureReservation,
  optionsValue: NativeCaptureScopeOptions,
  use: (scope: NativeCaptureScope) => Promise<T>,
  prepared?: AssignmentAdmission,
): Promise<T> {
  if (prepared) consumeAssignmentAdmission(prepared);
  const expected = decode(
    NativeCaptureReservationSchema,
    reservationValue,
    "OPERATION_BINDING",
  );
  const options = decode(
    NativeCaptureScopeOptionsSchema,
    optionsValue,
    "OPERATION_BINDING",
  );
  const root = expected.root;
  if (
    await Deno.realPath(root) !== root ||
    resolve(expected.outputDirectory) !== expected.outputDirectory ||
    !expected.outputDirectory.startsWith(root + "/") ||
    toolCachePath(root, expected.outputDirectory)
  ) {
    fail(
      "OPERATION_BINDING",
      "Нужны canonical owner и отдельный native output",
    );
  }
  await safeParent(expected.outputDirectory);
  for (const source of options.expectedSources) await regular(root, source);
  const operation = prepared?.operation ?? crypto.randomUUID(),
    directory = join(base(root), operation);
  await safeParent(base(root));
  await Deno.mkdir(base(root), { recursive: true });
  await Deno.mkdir(directory, { mode: 0o700 });
  let reservation: Reservation = {
    ...expected,
    schema: "course-native-capture-reservation-v1",
    operation,
    directory,
    expectedSources: options.expectedSources,
    status: "reserved",
    children: [],
  };
  await withWriter(root, async () => {
    // Existing private data must remain a recognized Core pointer.
    try {
      nativePointer(
        await json(await regular(root, relative(root, pointer(root)))),
        root,
        "Чужой private pointer",
      );
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    await writePrivate(reservationPath(reservation), reservation);
    await writePrivate(pointer(root), { operation, directory });
  });
  let preparedState: State | undefined;
  if (prepared) {
    const state: State = {
      schema: "course-native-operation-private-v2",
      operation,
      root,
      directory,
      outputDirectory: expected.outputDirectory,
      profiles: [...prepared.runtime.profiles],
      projection: "author",
      captureWitnesses: Object.fromEntries(
        prepared.inputs.map((source) => [source, crypto.randomUUID()]),
      ),
      inputs: prepared.inputs,
      ownerInputs: [],
      assignment: {
        assessments: prepared.assessments,
        runtime: prepared.runtime,
      },
      metrics: {
        inspectCalls: prepared.inspectCalls,

        nativeMetadataBytes: 0,
        childRenders: 0,
      },
    };
    preparedState = state;
    bindOwner(state, prepared.owner, true, expected.outputDirectory);
    await withWriter(root, async () => {
      await assertReservationCurrent(reservation);
      await writePendingState(state);
      reservation.status = "prepared";
      await writePrivate(reservationPath(reservation), reservation);
    });
  }
  let live = true, running = false, failed = false;
  async function captureInputs<R>(
    sources: readonly string[],
    runNative: (token: string) => Promise<R>,
  ): Promise<R> {
    if (!live) fail("OPERATION_EXPIRED", "Scope callback завершён");
    if (failed || running) {
      failed = true;
      await failReservation(reservation);
      fail("OPERATION_BINDING", "Failed/active scope child");
    }
    running = true;
    try {
      const inputs = decode(
        NativeCaptureScopeOptionsSchema,
        { expectedSources: sources },
        "OPERATION_BINDING",
      ).expectedSources;
      if (
        typeof runNative !== "function" ||
        inputs.some((source) =>
          !reservation.expectedSources.includes(source) ||
          reservation.children.some((c) => c.inputs.includes(source))
        )
      ) {
        fail("OPERATION_BINDING", "Повторный/чужой scope input");
      }
      const token = crypto.randomUUID();
      await withWriter(root, async () => {
        await assertReservationCurrent(reservation);
        reservation = {
          ...reservation,
          children: [...reservation.children, {
            token,
            inputs,
            used: false,
            posted: false,
          }],
        };
        await writePrivate(reservationPath(reservation), reservation);
      });
      if (!live || failed) {
        fail("OPERATION_EXPIRED", "Scope child истёк до native command");
      }
      // Prepared path supplies only the private guarded command closure below.
      const result = await runNative(token);
      if (!live || failed) {
        fail(
          "OPERATION_EXPIRED",
          "Scope child истёк во время native command",
        );
      }
      const current = await readReservation(root),
        child = current.children.at(-1);
      if (
        current.operation !== operation || current.status !== "bound" ||
        !child || child.token !== token || !same(child.inputs, inputs) ||
        !child.used || !child.posted ||
        !same(current.expectedSources, reservation.expectedSources) ||
        current.children.length !== reservation.children.length
      ) {
        fail("OPERATION_INCOMPLETE", "Нет actual native child post");
      }
      await regular(
        root,
        relative(root, join(directory, "child-" + token + ".json")),
      );
      reservation = current;
      return result;
    } catch (e) {
      failed = true;
      await failReservation(reservation);
      throw e;
    } finally {
      running = false;
    }
  }

  let leasing = false;
  const scope: NativeCaptureScope = Object.freeze({
    async captureInputs<R>(
      sources: readonly string[],
      run: (token: string) => Promise<R>,
    ) {
      if (prepared) {
        failed = true;
        await failReservation(reservation);
        fail(
          "OPERATION_BINDING",
          "Assignment capture требует live prepared lease/correlation",
        );
      }
      return captureInputs(sources, run);
    },
    async withPreparedOperation<R>(
      use: (lease: NativePreparedLease) => Promise<R>,
    ): Promise<R> {
      if (!prepared || !preparedState) {
        fail(
          "OPERATION_BINDING",
          "Prepared lease требует explicit new assignment",
        );
      }
      if (!live) fail("OPERATION_EXPIRED", "Scope callback завершён");
      if (leasing || running || failed) {
        fail("OPERATION_BINDING", "Active/failed prepared lease");
      }
      leasing = true;
      const descriptor = NativePreparedOperationSchema.parse({
        schema: "course-native-prepared-operation-v1",
        root,
        outputDirectory: expected.outputDirectory,
        identity: {
          operation,
          profiles: preparedState.profiles,
          projection: preparedState.projection,
          runtime: "quarto-1.11.5",
        },
        inputs: prepared.inputs.map((source) => ({
          source,
          captureWitness: preparedState!.captureWitnesses[source],
        })),
        assessments: prepared.assessments,
      });
      const guard = async () => {
        if (!live) fail("OPERATION_EXPIRED", "Scope callback завершён");
        if (failed) fail("OPERATION_BINDING", "Scope failed");
        await assertReservationCurrent(reservation);
        const current = await readReservation(root);
        if (
          !["prepared", "bound"].includes(current.status) ||
          current.operation !== operation ||
          !same(current.expectedSources, prepared.inputs)
        ) fail("OPERATION_CHANGED", "Prepared generation replaced/completed");
      };
      try {
        return await withPreparedLease(
          descriptor,
          guard,
          (sources, command) =>
            captureInputs(
              sources,
              (token) =>
                withAssignmentExecution(prepared.runtime, root, () =>
                  runAssignmentCaptureChild(token, command), guard),
            ),
          async () => {
            failed = true;
            await failReservation(reservation);
          },
          use,
        );
      } finally {
        leasing = false;
      }
    },
  });
  try {
    const result = await use(scope);
    if (
      failed || running || leasing || reservation.status !== "bound" ||
      !reservation.children.length || reservation.children.some((c) =>
        !c.used || !c.posted
      ) || !same(
        [...new Set(reservation.children.flatMap((c) => c.inputs))].sort(),
        [...reservation.expectedSources].sort(),
      )
    ) {
      fail(
        "OPERATION_INCOMPLETE",
        "Scope не охватывает все actual inputs/posts",
      );
    }
    await sealCaptureScope(reservation);
    return result;
  } catch (e) {
    failed = true;
    await failReservation(reservation);
    throw e;
  } finally {
    live = false;
  }
}
async function writePendingState(state: State) {
  const { inputs, root, directory, operation } = state;
  for (let index = 0; index < inputs.length; index++) {
    await regular(root, inputs[index]!);
    await Deno.writeTextFile(
      join(directory, `${index}.request.json`),
      JSON.stringify({
        context: {
          operation,
          captureWitness: state.captureWitnesses[inputs[index]!],
          profiles: state.profiles,
          input: resolve(root, inputs[index]!),
          projection: state.projection,
        },
        capture: join(directory, String(index)),
        ...(state.assignment
          ? {
            assignment: {
              source: inputs[index]!,
              assessments: state.assignment.assessments,
            },
          }
          : {}),
      }),
      { createNew: true, mode: 0o600 },
    );
  }
  await Deno.writeTextFile(
    join(directory, "state.json"),
    JSON.stringify(state),
    { createNew: true, mode: 0o600 },
  );
}

/** Internal early TS filter: private current generation and actual active child. */
export async function assertNativeAssignmentCapture(
  context: {
    operation: string;
    captureWitness?: string | undefined;
    input: string;
    profiles: string[];
    projection: string;
  },
  intent: { source: string; assessments: unknown },
  capture: string,
) {
  const source = intent.source;
  if (Deno.env.get("COURSE_CORE_TS_RUN")) {
    fail(
      "BODY.PRODUCER_INPUT_UNQUALIFIED",
      "Manual transport не создаёт assignment producer",
    );
  }
  const { nativeAssignmentOwner } = await import("./assignment-admission.ts");
  const root = nativeAssignmentOwner(
    context.input,
    source,
    capture,
    context.operation,
  );
  const reservation = await readReservation(root),
    token = Deno.env.get("COURSE_CORE_CAPTURE_TOKEN");
  if (!token) fail("OPERATION_BINDING", "Нет live assignment child token");
  const child = activeChild(reservation, token);
  const state = decode(
    stateSchema,
    await json(join(reservation.directory, "state.json")),
    "OPERATION_BINDING",
  );
  const index = state.inputs.indexOf(source);
  if (
    !state.assignment || reservation.status !== "bound" || !child.used ||
    child.posted || !child.inputs.includes(source) ||
    state.operation !== context.operation || state.root !== root ||
    state.directory !== reservation.directory ||
    state.outputDirectory !== reservation.outputDirectory ||
    state.projection !== context.projection ||
    !same(state.profiles, context.profiles) || index < 0 ||
    capture !== join(state.directory, String(index)) ||
    state.captureWitnesses[source] !== context.captureWitness ||
    !same(intent.assessments, state.assignment.assessments) ||
    !same(state.inputs, reservation.expectedSources) ||
    !same(state.assignment.runtime.inputs, state.inputs) ||
    !same(state.assignment.runtime.profiles, state.profiles)
  ) fail("OPERATION_BINDING", "Чужой/закрытый native assignment producer");
  await assertReservationCurrent(reservation);
  return root;
}

/** Production pre-render: native inspect и новые capture capabilities. */
export async function beginNativeOperation(root: string) {
  return await beginNativeOperationInternal(root, false);
}
function nativeProgressEnabled(): boolean {
  try {
    return Deno.env.get("QUARTO_PROJECT_SCRIPT_QUIET") !== "1";
  } catch {
    return false;
  }
}
async function nativeHookProgress(
  stage: string,
  root: string,
  action: () => Promise<void>,
) {
  if (!nativeProgressEnabled()) return await action();
  const started = performance.now();
  console.error(`Core: ${stage}: ${root} — начало`);
  try {
    await action();
    console.error(
      `Core: ${stage}: ${root} — готово (${
        ((performance.now() - started) / 1000).toFixed(1)
      } с)`,
    );
  } catch (error) {
    console.error(
      `Core: ${stage}: ${root} — ошибка (${
        ((performance.now() - started) / 1000).toFixed(1)
      } с)`,
    );
    throw error;
  }
}
/** Internal pre-render entrypoint; не экспортируется через public.ts. */
export async function beginNativePreHook(root: string) {
  return await nativeHookProgress(
    "Подготовка модели",
    root,
    () => beginNativeOperationInternal(root, true),
  );
}
async function admitNativeChild(
  root: string,
  token: string | undefined,
  actualInputs: string[],
  profiles: string[],
) {
  let reservation: Reservation | undefined;
  if (token !== undefined) {
    reservation = await readReservation(root);
    const child = activeChild(reservation, token);
    if (
      child.used ||
      !same([...child.inputs].sort(), [...actualInputs].sort()) ||
      resolve(Deno.cwd()) !== root ||
      resolve(Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR") || "") !==
        reservation.outputDirectory
    ) {
      fail(
        "OPERATION_BINDING",
        "Native child inputs/owner/output/token отличаются",
      );
    }
    if (reservation.status === "bound" || reservation.status === "prepared") {
      const state = decode(
        stateSchema,
        await json(join(reservation.directory, "state.json")),
        "OPERATION_BINDING",
      );
      if (
        state.root !== root || state.directory !== reservation.directory ||
        state.operation !== reservation.operation ||
        state.outputDirectory !== reservation.outputDirectory ||
        state.projection !== reservation.projection ||
        !same(state.inputs, reservation.expectedSources)
      ) {
        fail("OPERATION_BINDING", "Bound state не принадлежит reservation");
      }
      if (!same(profiles, state.profiles)) {
        fail("OPERATION_BINDING", "Native child ordered profiles изменились");
      }
      const baselineMetrics = { ...state.metrics };
      await assertPrivate(state);

      await withWriter(root, async () => {
        await assertReservationCurrent(reservation!);
        child.used = true;
        reservation!.status = "bound";
        await Deno.writeTextFile(
          join(state.directory, "pre-" + token + ".metrics.json"),
          JSON.stringify(
            Object.fromEntries(
              operationMetricKeys.map((key) => [
                key,
                observedDelta(state.metrics[key], baselineMetrics[key]),
              ]),
            ),
          ),
          { createNew: true, mode: 0o600 },
        );
        await writePrivate(reservationPath(reservation!), reservation);
      });
      return { reservation, reused: true };
    }
  }
  return { reservation, reused: false };
}
async function beginNativeOperationInternal(root: string, nativeHook: boolean) {
  const corePhaseAction = async function beginNativeOperationInternalPhase() {
    root = await Deno.realPath(root);
    const profiles = decode(
      NativeOperationExpectationSchema.shape.profiles,
      (Deno.env.get("QUARTO_PROFILE") || "").split(",").filter(Boolean),
      "OPERATION_BINDING",
    );
    const selection = await nativeFileSelection(
      root,
      "QUARTO_PROJECT_INPUT_FILES",
    );
    if (nativeHook && nativeProgressEnabled()) {
      console.error(
        `Core: Подготовка модели — inputs=${selection.files.length}`,
      );
    }
    if (nativeHook && selection.explicitlyEmpty) {
      await invalidateNoWorkHook(root);
      return;
    }
    const actualInputs = selection.files.map((p) => relative(root, p));
    if (
      !actualInputs.length ||
      new Set(actualInputs).size !== actualInputs.length ||
      actualInputs.some((p) => !pathSchema.safeParse(p).success)
    ) {
      fail("OPERATION_BINDING", "Нет уникальных текущих native inputs");
    }
    const token = Deno.env.get("COURSE_CORE_CAPTURE_TOKEN");
    const previousPointer = token === undefined
      ? await readOptionalPointer(root)
      : undefined;
    const { reservation, reused } = await admitNativeChild(
      root,
      token,
      actualInputs,
      profiles,
    );
    if (reused) return;
    const operation = reservation?.operation ?? crypto.randomUUID(),
      directory = reservation?.directory ?? join(base(root), operation);
    const inputs = reservation?.expectedSources ?? actualInputs;
    let outputDirectory = reservation?.outputDirectory ??
      resolve(root, Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR") || "_site");
    if (!outputDirectory.startsWith(root + "/")) {
      fail("OPERATION_BINDING", "Output вне owner");
    }
    await safeParent(base(root));
    await Deno.mkdir(base(root), { recursive: true });
    if (!reservation) await Deno.mkdir(directory, { mode: 0o700 });
    const state: State = {
      schema: "course-native-operation-private-v2",
      operation,
      root,
      directory,
      outputDirectory,
      profiles,
      projection: reservation?.projection ?? "student",
      captureWitnesses: {},
      inputs,
      ownerInputs: [],
      metrics: {
        nativeMetadataBytes: 0,
        childRenders: 0,
        inspectCalls: 0,
      },
    };
    const owner = await inspectNativeOwner(root, profiles);
    state.metrics.inspectCalls++;
    bindOwner(
      state,
      owner,
      !!reservation,
      Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR"),
    );

    if (reservation) await assertReservationCurrent(reservation);
    state.captureWitnesses = Object.fromEntries(
      inputs.map((source) => [source, crypto.randomUUID()]),
    );
    const publish = async () => {
      if (reservation) await assertReservationCurrent(reservation);
      else if (!same(await readOptionalPointer(root), previousPointer)) {
        fail("OPERATION_CHANGED", "Operation pointer изменён во время pre");
      }
      await writePendingState(state);
      if (reservation) {
        activeChild(reservation, token!).used = true;
        reservation.status = "bound";
        await writePrivate(reservationPath(reservation), reservation);
      } else {
        if (!same(await readOptionalPointer(root), previousPointer)) {
          fail(
            "OPERATION_CHANGED",
            "Operation pointer заменён перед publication",
          );
        }
        await writePrivate(pointer(root), { operation, directory });
      }
    };
    await withWriter(root, publish);
  };
  return await __createMetrics("course-core").wrapAsync({
    id: "course-core.runtime.operation.beginNativeOperationInternal",
    kind: "phase",
    origin: "manual",
  }, corePhaseAction)();
}

function capturedMediaSource(
  state: State,
  resource: z.output<typeof completeSchema>["resources"][number],
) {
  if (!resource.media) return undefined;
  const index = state.inputs.indexOf(resource.media.input);
  if (index < 0 || !resource.documents.includes(resource.media.input)) {
    fail("OPERATION_BINDING", "Чужой native mediabag capture");
  }
  return join(state.directory, index + ".media-" + resource.media.ordinal);
}

function decodeIndexRequest(value: unknown): unknown {
  return typeof value === "string" && value ? JSON.parse(value) : {};
}

function localUses(value: unknown): string[] {
  const result = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!record(value)) return;
    const node = value, content = node.c;
    if ((node.t === "Link" || node.t === "Image") && Array.isArray(content)) {
      const contents: unknown[] = content;
      const target: unknown = contents[2];
      const targets: unknown[] = Array.isArray(target) ? target : [];
      const url: unknown = targets[0];
      if (
        typeof url === "string" && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)
      ) result.add(url.split(/[?#]/)[0] ?? "");
    }
    Object.values(node).forEach(visit);
  }
  visit(value);
  return [...result];
}
/** Production post-render: поздняя фактическая проекция и только текущие native outputs. */
export async function finishNativeOperation(root: string) {
  return await finishNativeOperationInternal(root, false);
}
/** Internal post-render entrypoint; no-work не создаёт complete.json. */
export async function finishNativePostHook(root: string) {
  return await nativeHookProgress(
    "Финализация модели",
    root,
    () => finishNativeOperationInternal(root, true),
  );
}
async function finishNativeOperationInternal(
  root: string,
  nativeHook: boolean,
) {
  const corePhaseAction = async function finishNativeOperationInternalPhase() {
    root = await Deno.realPath(root);
    const selection = nativeHook
      ? await nativeFileSelection(root, "QUARTO_PROJECT_OUTPUT_FILES")
      : undefined;
    if (selection && nativeProgressEnabled()) {
      console.error(
        `Core: Финализация модели — outputs=${selection.files.length}`,
      );
    }
    if (selection?.explicitlyEmpty) {
      await invalidateNoWorkHook(root);
      return;
    }
    const active = nativePointer(
      await json(pointer(root)),
      root,
      "Чужой private operation pointer",
    );
    const state = decode(
      stateSchema,
      await json(join(active.directory, "state.json")),
      "OPERATION_BINDING",
    );
    if (
      state.root !== root || state.directory !== active.directory ||
      state.operation !== active.operation
    ) fail("OPERATION_BINDING", "Чужой native post state");
    const token = Deno.env.get("COURSE_CORE_CAPTURE_TOKEN");
    const reservation = token !== undefined
      ? await readReservation(root)
      : undefined;
    const child = reservation ? activeChild(reservation, token!) : undefined;
    if (child && (!child.used || reservation!.operation !== state.operation)) {
      fail("OPERATION_BINDING", "Незарегистрированный native post");
    }
    if (!reservation) {
      try {
        await Deno.lstat(join(state.directory, "reservation.json"));
        fail("OPERATION_BINDING", "Scope post требует registered token");
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
    }
    const inputs = child?.inputs ?? state.inputs;
    async function collectChildMetrics() {
      if (child) {
        state.metrics.childRenders++;
        try {
          const delta = await json(
            join(state.directory, "pre-" + token + ".metrics.json"),
          );
          if (!record(delta)) {
            fail("OPERATION_BINDING", "Некорректные child metrics");
          }
          for (const key of operationMetricKeys) {
            if (
              typeof delta[key] !== "number" || !Number.isInteger(delta[key]) ||
              delta[key] < 0
            ) fail("OPERATION_BINDING", "Некорректные child metrics");
            if (typeof state.metrics[key] !== "number") {
              fail("METRICS_UNAVAILABLE", "Incomplete pending counters");
            }
            state.metrics[key]! += delta[key];
          }
        } catch (e) {
          if (!(e instanceof Deno.errors.NotFound)) throw e;
        }
      }
    }
    await collectChildMetrics();
    await assertPrivate(state);
    if (
      !same(
        state.profiles,
        (Deno.env.get("QUARTO_PROFILE") || "").split(",").filter(Boolean),
      )
    ) fail("OPERATION_BINDING", "Native profiles изменились между hooks");
    const outputs = selection?.files ??
      await envFiles(root, "QUARTO_PROJECT_OUTPUT_FILES");
    if (!outputs.length) {
      fail("OPERATION_INCOMPLETE", "Нет текущих native outputs");
    }
    const documents: z.output<typeof NativePublicDocumentSchema>[] = [],
      catalogDocuments: z.output<typeof NativeCatalogSchema>["documents"] = [],
      resources: z.output<typeof completeSchema>["resources"] = [],
      outputRows: z.output<typeof completeSchema>["outputs"] = [];
    const declaredOutputs = new Set(outputs);
    const indexTopicMetadata = new Map<string, Record<string, unknown>>();
    const indexPages = new Map<string, string>();
    const releaseDocuments: z.output<
      typeof completeSchema
    >["releaseDocuments"] = [];
    async function collectObservedResources(
      native: z.output<typeof nativeCaptureSchema>,
      source: string,
      capture: string,
    ) {
      for (const use of localUses(native.body)) {
        let decoded: string;
        try {
          decoded = decodeURIComponent(use);
        } catch {
          fail("RESOURCE_PATH", "Некорректный URL ресурса");
        }
        const canonical = relative(
          root,
          resolve(
            use.startsWith("/") ? root : dirname(resolve(root, source)),
            decoded.replace(/^\//, ""),
          ),
        );
        if (!pathSchema.safeParse(canonical).success) {
          fail("RESOURCE_PATH", "Ресурс выходит из owner");
        }
        if (!ordinary(canonical) || toolCachePath(root, canonical)) continue;
        // Только фактическое native наблюдение разрешает relocated fallback.
        const observed = native.resources.find((r) =>
          resolve(r.source) === resolve(root, canonical)
        );
        if (!observed) {
          try {
            await regular(root, canonical);
          } catch (e) {
            if (e instanceof Deno.errors.NotFound) continue;
            throw e;
          }
          fail(
            "RESOURCE_UNQUALIFIED",
            "Ресурс отсутствует в native path observation",
          );
        }
        const expectedOutput = resolve(state.outputDirectory, canonical);
        if (resolve(observed.output) !== expectedOutput) {
          fail("OPERATION_BINDING", "Native resource output отличается");
        }
        const existing = resources.find((r) => r.source === canonical);
        if (existing) {
          if (
            (existing.media?.input !== undefined ||
              observed.media !== undefined) && existing.media?.input !== source
          ) {
            fail(
              "RESOURCE_COLLISION",
              "Один resource key имеет разные native mediabag origins",
            );
          }
          if (!existing.documents.includes(source)) {
            existing.documents.push(source);
          }
          continue;
        }
        const capturedSource = observed.media === undefined
          ? undefined
          : capture + ".media-" + observed.media;
        const finished = await finishedNativeResource(
          state,
          canonical,
          [],
          capturedSource,
        );
        resources.push({
          source: canonical,
          documents: [source],
          ...(observed.media === undefined
            ? {}
            : { media: { input: source, ordinal: observed.media } }),
          ...finished,
        });
      }
    }
    async function collectCapturedProjectFacts(
      capture: string,
      early: z.output<typeof EarlyDocumentSchema>,
      sourceInput: string,
    ) {
      let projectFacts:
        | z.output<typeof NativeProjectFactsCaptureSchema>
        | undefined;
      if (state.assignment) {
        const projectFactsBytes = await Deno.readFile(
          capture + ".project-facts.json",
        );
        if (projectFactsBytes.length > 16 * 1024 * 1024) {
          fail("DOCUMENT_LIMIT", "Project facts больше16MiB");
        }
        state.metrics.nativeMetadataBytes += projectFactsBytes.length;
        projectFacts = decode(
          NativeProjectFactsCaptureSchema,
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(projectFactsBytes),
          ),
          "BODY.PROJECT_FACTS_UNQUALIFIED",
        );
        const declared = early.release?.declarations.filter((row) =>
          row.project
        ) ?? [];
        if (
          !same(projectFacts.context, early.context) ||
          projectFacts.source !== sourceInput ||
          projectFacts.projects.length !== declared.length ||
          projectFacts.projects.some((fact) =>
            fact.source !== sourceInput || !declared.some((row) =>
              row.id === fact.exerciseId &&
              row.project === "/" + fact.projectRoot &&
              row.check === fact.projectCheck
            )
          )
        ) {
          fail(
            "BODY.PROJECT_FACTS_UNQUALIFIED",
            "Foreign/incomplete preprojection Core project facts",
          );
        }
      }
      return projectFacts;
    }
    function admitCapturedDependencies(
      native: z.output<typeof nativeCaptureSchema>,
      sourceInput: string,
      format: string,
    ) {
      if (state.assignment) {
        const nativeShare = resolve(
          dirname(state.assignment.runtime.executable),
          "../share",
        );
        assertAssignmentDeclarations(
          native.assignmentDeclarations,
          resolve(root, sourceInput),
          {
            root,
            outputDirectory: state.outputDirectory,
            xdg: state.assignment.runtime.environment.XDG_CACHE_HOME ??
              join(state.assignment.runtime.environment.HOME ?? root, ".cache"),
            nativeImplementation: (path: string) => {
              if (
                !path.startsWith(nativeShare + "/") || resolve(path) !== path
              ) {
                return false;
              }
              return true;
            },
            format: format,
            outputs: declaredOutputs,
          },
        );
        state.metrics.nativeMetadataBytes += new TextEncoder().encode(
          JSON.stringify(native.assignmentDeclarations),
        )
          .length;
      } else if (native.assignmentDeclarations) {
        fail(
          "BODY.PRODUCER_DEPENDENCY_UNQUALIFIED",
          "Unexpected assignment declarations",
        );
      }
    }
    async function collectCapturedDocument(sourceInput: string) {
      const index = state.inputs.indexOf(sourceInput);
      if (index < 0) fail("OPERATION_BINDING", "Чужой child source");
      const capture = join(state.directory, String(index));
      const early = decode(
        EarlyDocumentSchema,
        await json(capture + ".early.json"),
        "OPERATION_INCOMPLETE",
      );
      const late = decode(
        LateDocumentSchema,
        await json(capture + ".late.json"),
        "OPERATION_INCOMPLETE",
      );
      const native = decode(
        nativeCaptureSchema,
        await json(capture + ".native.json"),
        "OPERATION_INCOMPLETE",
      );
      state.metrics.nativeMetadataBytes += new TextEncoder().encode(
        JSON.stringify(early.release?.nativeMetadata ?? {}),
      ).length;
      const captureWitness = state.captureWitnesses[state.inputs[index]!];
      if (!captureWitness) {
        fail("OPERATION_BINDING", "Нет native capture witness");
      }
      const nativeFormat = NativeWebFormatSchema.safeParse(
        early.context.format,
      );
      if (
        early.context.captureWitness !== captureWitness ||
        !same(early.context.profiles, state.profiles) ||
        early.context.operation !== state.operation ||
        early.context.input !== resolve(root, state.inputs[index]!) ||
        !nativeFormat.success ||
        early.context.projection !== state.projection
      ) fail("OPERATION_BINDING", "Чужой native capture");
      const nativeContext = {
        ...early.context,
        captureWitness,
        format: nativeFormat.data,
      };
      if (early.context.exerciseBank !== (native.role === "exercise-bank")) {
        fail("OPERATION_BINDING", "Native role/capture отличаются");
      }
      const document = finalizeDocument(early, late);
      if (document.status !== "complete") {
        fail("OPERATION_INCOMPLETE", "Неполный late native capture");
      }
      // Lua наблюдает writer path до перемещения Quarto в output-dir.
      // Явный output-file остаётся относительно owner; обычный путь уже конечный.
      const observedOutput = resolve(root, native.output);
      const output = observedOutput.startsWith(state.outputDirectory + "/")
        ? observedOutput
        : observedOutput.startsWith(root + "/")
        ? resolve(state.outputDirectory, relative(root, observedOutput))
        : observedOutput;
      if (
        !outputs.includes(output) ||
        !output.startsWith(state.outputDirectory + "/") ||
        !output.endsWith(".html")
      ) {
        fail(
          "OPERATION_BINDING",
          "Документ не принадлежит текущему HTML output",
        );
      }
      const outputPath = relative(root, output);
      await regular(root, outputPath);
      if (outputRows.some((r) => r.path === outputPath)) {
        fail("OPERATION_BINDING", "Output collision");
      }
      admitCapturedDependencies(native, sourceInput, early.context.format);
      if (!reservation) {
        const outputText = await Deno.readTextFile(output);
        if (outputText.includes("<!--course-exercise-index")) {
          indexPages.set(outputPath, outputText);
        }
      }
      indexTopicMetadata.set(state.inputs[index]!, early.ast.meta);
      outputRows.push({ path: outputPath });
      const projectFacts = await collectCapturedProjectFacts(
        capture,
        early,
        sourceInput,
      );
      releaseDocuments.push({
        ...(projectFacts ? { projectFacts } : {}),
        source: state.inputs[index]!,
        early: {
          context: nativeContext,
          definitions: early.definitions,
          release: early.release,
        },
        final: {
          hasPublicSolution: structuredClone(document.hasPublicSolution),
        },
      });
      const source = state.inputs[index]!,
        visibleIds = new Set(
          document.occurrences.filter((r) => r.kind === "exercise").map((r) =>
            r.exerciseId
          ),
        );
      document.definitions = Object.fromEntries(
        Object.entries(document.definitions).filter(([id]) =>
          visibleIds.has(id)
        ),
      );
      document.context = { ...document.context, input: source, defaults: {} };
      documents.push(
        decode(NativePublicDocumentSchema, document, "OPERATION_DOCUMENT"),
      );
      const role = native.role;
      if (role !== "exercise-bank" && role !== "page") {
        fail(
          "OPERATION_UNQUALIFIED",
          "Не квалифицирована native document role",
        );
      }
      catalogDocuments.push({
        source,
        output: relative(state.outputDirectory, output),
        format: nativeFormat.data,
        role,
        exercises: document.occurrences.filter((r) => r.kind === "exercise")
          .map(
            (r) => ({
              id: r.exerciseId,
              occurrence: r.key,
              anchor: r.anchor,
              hasPublicSolution:
                document.hasPublicSolution[r.exerciseId] === true,
              ...(document.definitions[r.exerciseId]?.project
                ? {
                  project: relative(
                    root,
                    resolve(
                      document.definitions[r.exerciseId]!.project!.startsWith(
                          "/",
                        )
                        ? root
                        : dirname(resolve(root, source)),
                      document.definitions[r.exerciseId]!.project!.replace(
                        /^\//,
                        "",
                      ),
                    ),
                  ),
                }
                : {}),
            }),
          ),
      });
      await collectObservedResources(native, source, capture);
    }
    for (const sourceInput of inputs) {
      await collectCapturedDocument(sourceInput);
    }
    async function publishExerciseIndexes() {
      if (indexPages.size && !reservation) {
        if (!same([...inputs].sort(), [...state.ownerInputs].sort())) {
          fail(
            "RELEASE.FULL_NATIVE_RUN_REQUIRED",
            "Указатель требует полной текущей native области",
          );
        }
        const { renderExerciseIndex } = await import(
          "../../course-navigation/public.ts"
        );
        const catalog = NativeCatalogSchema.parse({
          identity: {
            operation: state.operation,
            profiles: state.profiles,
            projection: state.projection,
            runtime: "quarto-1.11.5",
          },
          documents: catalogDocuments,
        });
        const topicFor = (source: string) => {
          const metadata = indexTopicMetadata.get(source);
          if (!metadata) return undefined;
          const semester = nativeMetadata(metadata.semester);
          const categories = nativeMetadata(metadata.categories);
          if (
            semester !== undefined && typeof semester !== "string" ||
            categories !== undefined && (!Array.isArray(categories) ||
                !categories.every((category): category is string =>
                  typeof category === "string"
                ))
          ) throw Error("Invalid native index topic metadata: " + source);
          return { semester: semester ?? "", categories: categories ?? [] };
        };
        const indexDocuments = documents.map((doc) => ({
          source: doc.context.input,
          exercises: doc.occurrences.flatMap((occ) => {
            if (occ.kind !== "exercise") return [];
            const definition = doc.definitions[occ.exerciseId];
            if (
              !definition || doc.context.projection === "student" &&
                definition["statement-visibility"] !== "open"
            ) return [];
            const captured = catalog.documents.find((row) =>
              row.source === doc.context.input &&
              row.format === doc.context.format
            )?.exercises.find((row) => row.occurrence === occ.key);
            if (!captured) {
              fail("OPERATION_BINDING", "Нет current index occurrence");
            }
            return [{
              id: occ.exerciseId,
              title: visibleTitle(occ.title).trim() || occ.exerciseId,
              anchor: captured.anchor,
              ...(definition["course-role"]
                ? { role: definition["course-role"] }
                : {}),
              difficulty: definition.difficulty,
              ...(definition.time !== undefined
                ? { time: definition.time }
                : {}),
            }];
          }),
        }));
        for (const [path, html] of indexPages) {
          const rendered = html.replace(
            /<!--course-exercise-index(?::(.*?))?-->/g,
            (_marker, request) =>
              renderExerciseIndex(
                indexDocuments,
                topicFor,
                (source, anchor) => {
                  const target = catalog.documents.find((doc) =>
                    doc.source === source
                  );
                  if (!target) {
                    fail("OPERATION_BINDING", "Нет current index target");
                  }
                  return relative(
                    dirname(resolve(root, path)),
                    resolve(state.outputDirectory, target.output),
                  ).replaceAll("\\", "/") + "#" + anchor;
                },
                decodeIndexRequest(request),
              ),
          );
          await Deno.writeTextFile(resolve(root, path), rendered);
        }
      }
    }
    await publishExerciseIndexes();
    if (
      outputs.filter((p) => p.endsWith(".html")).some((p) =>
        !outputRows.some((r) => resolve(root, r.path) === p)
      )
    ) fail("OPERATION_INCOMPLETE", "HTML output без Core capture");

    const identity = NativeOperationIdentitySchema.parse({
      operation: state.operation,
      profiles: state.profiles,
      projection: state.projection,
      runtime: "quarto-1.11.5",
    });
    const complete = completeSchema.parse({
      state,
      catalog: { identity, documents: catalogDocuments },
      documents,
      resources,
      outputs: outputRows,
      releaseDocuments,
    });
    await withWriter(root, async () => {
      await assertPrivate(state);
      if (reservation) await assertReservationCurrent(reservation);
      await Deno.writeTextFile(
        join(
          state.directory,
          reservation ? "child-" + token + ".json" : "complete.json",
        ),
        JSON.stringify(complete),
        { createNew: true, mode: 0o600 },
      );
      if (reservation) {
        child!.posted = true;
        await writePrivate(reservationPath(reservation), reservation);
      }
    });
    console.log(
      `Core: ${documents.length} текущих native-ts ${state.projection} документов`,
    );
  };
  return await __createMetrics("course-core").wrapAsync({
    id: "course-core.runtime.operation.finishNativeOperationInternal",
    kind: "phase",
    origin: "manual",
  }, corePhaseAction)();
}
async function sealCaptureScope(reservation: Reservation) {
  const root = reservation.root;
  const state = decode(
    stateSchema,
    await json(join(reservation.directory, "state.json")),
    "OPERATION_BINDING",
  );
  if (
    state.root !== root || state.directory !== reservation.directory ||
    state.operation !== reservation.operation ||
    state.outputDirectory !== reservation.outputDirectory ||
    state.projection !== reservation.projection ||
    !same(state.inputs, reservation.expectedSources)
  ) fail("OPERATION_BINDING", "Чужой seal state");
  const baselineMetrics = { ...state.metrics };
  await assertPrivate(state);
  const children = [];
  for (const child of reservation.children) {
    children.push(
      decode(
        completeSchema,
        await json(
          await regular(
            root,
            relative(
              root,
              join(reservation.directory, "child-" + child.token + ".json"),
            ),
          ),
        ),
        "OPERATION_INCOMPLETE",
      ),
    );
  }
  const documents = children.flatMap((c) => c.documents),
    catalogDocuments = children.flatMap((c) => c.catalog.documents),
    outputs = children.flatMap((c) => c.outputs),
    releaseDocuments = children.flatMap((c) => c.releaseDocuments);
  if (
    new Set(documents.map((d) => d.context.input)).size !==
      state.inputs.length ||
    documents.length !== state.inputs.length ||
    new Set(outputs.map((r) => r.path)).size !== outputs.length
  ) {
    fail("OPERATION_BINDING", "Missing/duplicate source или output collision");
  }
  const resources: z.output<typeof completeSchema>["resources"] = [];
  for (const child of children) {
    if (
      !same(child.catalog.identity, {
        operation: state.operation,
        profiles: state.profiles,
        projection: state.projection,
        runtime: "quarto-1.11.5",
      })
    ) fail("OPERATION_BINDING", "Чужой child capture");
    if (
      !same(child.state.ownerWitness, state.ownerWitness)
    ) fail("OPERATION_BINDING", "Child owner/S witness отличается");
    if (state.assignment) {
      if (
        !child.state.assignment ||
        !same(state.assignment.assessments, child.state.assignment.assessments)
      ) {
        fail("OPERATION_BINDING", "Child assignment intent отличается");
      }
      if (!same(state.assignment.runtime, child.state.assignment.runtime)) {
        fail("OPERATION_BINDING", "Child native runtime binding отличается");
      }
    } else if (child.state.assignment) {
      fail("OPERATION_BINDING", "Unexpected child assignment");
    }
    for (const resource of child.resources) {
      const known = resources.find((r) => r.source === resource.source);
      if (known) {
        if (
          (known.media || resource.media) && !same(known.media, resource.media)
        ) {
          fail(
            "RESOURCE_COLLISION",
            "Один resource key имеет разные native mediabag origins",
          );
        }
        known.documents = [
          ...new Set([...known.documents, ...resource.documents]),
        ];
        known.sourceIdentities = [
          ...new Set([...known.sourceIdentities, ...resource.sourceIdentities]),
        ];
      } else resources.push(resource);
    }
    for (const key of operationMetricKeys) {
      const previous = state.metrics[key],
        childValue = child.state.metrics[key],
        baseline = baselineMetrics[key];
      if (
        typeof previous !== "number" || typeof childValue !== "number" ||
        typeof baseline !== "number"
      ) fail("METRICS_UNAVAILABLE", "Incomplete child counters");
      state.metrics[key] = previous + childValue - baseline;
    }
  }
  // Дочерний Quarto уже завершил все post hooks. Здесь остаются выбранные
  // пути и physical ownership ресурсов, без доказательства прежних bytes.
  for (const output of outputs) await regular(root, output.path);
  for (const resource of resources) {
    Object.assign(
      resource,
      await finishedNativeResource(
        state,
        resource.source,
        resource.sourceIdentities,
        capturedMediaSource(state, resource),
      ),
    );
  }
  const complete = completeSchema.parse({
    state,
    catalog: {
      identity: children[0]!.catalog.identity,
      documents: catalogDocuments,
    },
    documents,
    outputs,
    resources,
    releaseDocuments,
  });
  await withWriter(root, async () => {
    await assertReservationCurrent(reservation);
    await assertPrivate(state);

    reservation.status = "sealed";
    await writePrivate(reservationPath(reservation), reservation);
    complete.state.metrics = { ...state.metrics };
    await Deno.writeTextFile(
      join(state.directory, "complete.json"),
      JSON.stringify(complete),
      { createNew: true, mode: 0o600 },
    );
  });
}
async function assertReservationPhase(state: State, phase: "bound" | "sealed") {
  try {
    await Deno.lstat(join(state.directory, "reservation.json"));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return;
    throw e;
  }
  const reservation = await readReservation(state.root);
  if (
    reservation.operation !== state.operation || reservation.status !== phase
  ) {
    fail("OPERATION_INCOMPLETE", "Capture scope не находится в требуемой фазе");
  }
  return reservation;
}
/** Только correlation текущей pre-фазы; DTO не даёт complete IO authority. */
export async function withPendingNativeOperation<T>(
  expectationValue: NativePendingOperationExpectation,
  use: (operation: z.output<typeof NativePendingOperationSchema>) => Promise<T>,
): Promise<T> {
  const expectation = decode(
    NativePendingOperationExpectationSchema,
    expectationValue,
    "OPERATION_BINDING",
  );
  if (await Deno.realPath(expectation.root) !== expectation.root) {
    fail("OPERATION_BINDING", "Не canonical owner");
  }
  let active: { operation: string; directory: string }, state: State;
  try {
    active = nativePointer(
      await json(
        await regular(
          expectation.root,
          relative(expectation.root, pointer(expectation.root)),
        ),
      ),
      expectation.root,
      "Чужой pending pointer",
    );
    state = decode(
      stateSchema,
      await json(
        await regular(
          expectation.root,
          relative(expectation.root, join(active.directory, "state.json")),
        ),
      ),
      "OPERATION_INCOMPLETE",
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      fail("OPERATION_INCOMPLETE", "Pending generation отсутствует");
    }
    throw error;
  }
  if (
    state.root !== expectation.root || state.operation !== active.operation ||
    state.directory !== active.directory ||
    !same(state.profiles, expectation.profiles) ||
    state.projection !== expectation.projection ||
    state.outputDirectory !== expectation.outputDirectory
  ) {
    fail(
      "OPERATION_BINDING",
      "Pending owner/profile/projection/output отличаются",
    );
  }
  await assertReservationPhase(state, "bound");
  const descriptor = immutable(NativePendingOperationSchema.parse({
    identity: {
      operation: state.operation,
      profiles: state.profiles,
      projection: state.projection,
      runtime: "quarto-1.11.5",
    },
    inputs: state.inputs.map((source) => ({
      source,
      captureWitness: state.captureWitnesses[source],
    })),
  }));
  let live = true;
  const syncGuard = () => {
    if (!live) fail("OPERATION_EXPIRED", "Pending callback завершён");
  };
  const guard = async () => {
    syncGuard();
    await assertPrivate(state);
    await assertReservationPhase(state, "bound");
    try {
      await Deno.lstat(join(state.directory, "complete.json"));
      fail("OPERATION_COMPLETED", "Pending generation уже завершена");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  };
  const view = Object.freeze({
    get identity() {
      syncGuard();
      return descriptor.identity;
    },
    get inputs() {
      syncGuard();
      return descriptor.inputs;
    },
  });
  try {
    await guard();
    const result = await use(view);
    await guard();
    return result;
  } finally {
    live = false;
  }
}
export async function withCurrentNativeOperation<T>(
  expectationValue: NativeOperationExpectation,
  use: (operation: ReturnType<typeof publicOperation>) => Promise<T>,
): Promise<T> {
  return await withCapturedOperation(
    expectationValue,
    (operation) => use(operation),
  );
}

/** Обычная публикация; full course grading/seed admission сюда не входит. */
export async function withNativePublication<T>(
  expectationValue: NativeOperationExpectation,
  selection: NativePublicationSelection,
  use: (publication: NativePublication) => Promise<T>,
): Promise<T> {
  return await withCapturedOperation(
    expectationValue,
    async (_operation, publication) => await use(await publication(selection)),
  );
}

async function withCapturedOperation<T>(
  expectationValue: NativeOperationExpectation,
  use: (
    operation: ReturnType<typeof publicOperation>,
    publication: (
      selection: NativePublicationSelection,
    ) => Promise<NativePublication>,
  ) => Promise<T>,
): Promise<T> {
  const expectation = decode(
    NativeOperationExpectationSchema,
    expectationValue,
    "OPERATION_BINDING",
  );
  if (await Deno.realPath(expectation.root) !== expectation.root) {
    fail("OPERATION_BINDING", "Не canonical owner");
  }
  let active: { operation: string; directory: string };
  try {
    await regular(
      expectation.root,
      relative(expectation.root, pointer(expectation.root)),
    );
    active = nativePointer(
      await json(pointer(expectation.root)),
      expectation.root,
      "Неверный operation pointer",
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      fail("OPERATION_BINDING", "В owner нет текущей native операции");
    }
    throw error;
  }
  const path = join(active.directory, "complete.json");
  let complete: z.output<typeof completeSchema>;
  try {
    complete = decode(
      completeSchema,
      await json(
        await regular(expectation.root, relative(expectation.root, path)),
      ),
      "OPERATION_INCOMPLETE",
    );
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      fail("OPERATION_INCOMPLETE", "Операция ещё не завершена");
    }
    throw e;
  }
  await assertReservationPhase(complete.state, "sealed");
  if (
    complete.state.root !== expectation.root ||
    complete.state.directory !== active.directory ||
    complete.state.operation !== active.operation ||
    !same(complete.state.profiles, expectation.profiles) ||
    complete.state.projection !== expectation.projection ||
    complete.state.outputDirectory !== expectation.outputDirectory
  ) fail("OPERATION_BINDING", "Ожидания root/profiles/output отличаются");
  if (expectation.expectedDocuments) {
    const expected = expectation.expectedDocuments;
    if (
      new Set(expected.map((d) => d.source)).size !== expected.length ||
      expected.length !== complete.catalog.documents.length ||
      expected.some((d) =>
        !complete.catalog.documents.some((actual) =>
          actual.source === d.source && actual.format === d.format
        )
      )
    ) {
      fail("OPERATION_BINDING", "Exact document coverage/format отличаются");
    }
  }
  // Внешний вход после hooks проверяет конечные outputs один раз.
  for (const output of complete.outputs) {
    await regular(complete.state.root, output.path);
  }
  // Каталог хранит выбор ресурса; фактический путь определяется после hooks.
  for (const resource of complete.resources) {
    Object.assign(
      resource,
      await finishedNativeResource(
        complete.state,
        resource.source,
        resource.sourceIdentities,
        capturedMediaSource(complete.state, resource),
      ),
    );
  }
  let live = true;
  const callbackLife = { active: true };
  const callbackGuard = () => {
    if (!callbackLife.active) {
      projectBatches.failed = true;
      fail("OPERATION_EXPIRED", "User callback native операции завершён");
    }
  };
  const nativeEnvironment = Object.freeze({
    ...Deno.env.toObject(),
  });
  const hostGuard = () => {
    if (!live) fail("OPERATION_EXPIRED", "Callback native операции завершён");
    if (projectBatches.failed) fail("OPERATION_INCOMPLETE", "A1 batch failed");
  };
  const guard = async () => {
    if (!live) fail("OPERATION_EXPIRED", "Callback native операции завершён");
    if (projectBatches.failed) fail("OPERATION_INCOMPLETE", "A1 batch failed");
    hostGuard();
    await assertPrivate(complete.state);
    await assertReservationPhase(complete.state, "sealed");
  };
  const metrics = {
    ...complete.state.metrics,
    resourceByteReads: 0,
    resourceCacheHits: 0,
  };
  const projectBatches = { active: 0, failed: false };
  const operation = publicOperation(complete, {
    syncGuard: () => {
      if (!live) fail("OPERATION_EXPIRED", "Callback native операции завершён");
    },
    guard,
    metrics,
    projectBatches,
    hostGuard,
    callbackGuard,
    host: { environment: nativeEnvironment, cwd: complete.state.root },
  });
  const beforeOperationChild = async () => {
    callbackGuard();
    await guard();
    callbackGuard();
  };
  const run = async () => {
    const result = await withAssignmentBeforeChild(
      beforeOperationChild,
      async () => {
        try {
          return await use(operation, async (selection) => {
            callbackGuard();
            if (complete.state.assignment) {
              fail(
                "BODY.PUBLICATION_REQUIRED",
                "Assignment capture требует отдельный course-export маршрут",
              );
            }
            return await createNativePublication({
              operation: operation,
              documents: complete.releaseDocuments,
              selection: selection,
              owner: {
                root: complete.state.root,
                outputDirectory: complete.state.outputDirectory,
              },
              checkPath: async (source, path, kind) => {
                const absolute = resolve(
                  kind || path.startsWith("/")
                    ? complete.state.root
                    : dirname(resolve(complete.state.root, source)),
                  path.replace(/^\//, ""),
                );
                if (
                  toolCachePath(complete.state.root, absolute) ||
                  excluded(complete.state, absolute)
                ) {
                  fail(
                    "RELEASE.SOURCE_POLICY",
                    "Исключённый источник публикации",
                    source,
                  );
                }
                let info: Deno.FileInfo;
                try {
                  const actual = await ownedPhysical(
                    complete.state.root,
                    relative(complete.state.root, absolute),
                  );
                  info = await Deno.stat(actual);
                } catch (cause) {
                  if (cause instanceof Deno.errors.NotFound) {
                    fail(
                      "RELEASE.SOURCE_POLICY",
                      "Источник публикации отсутствует",
                      source,
                    );
                  }
                  throw cause;
                }
                if (
                  (kind === "file" && !info.isFile) ||
                  (kind === "directory" && !info.isDirectory) ||
                  (!info.isFile && !info.isDirectory)
                ) {
                  fail(
                    "RESOURCE.PROJECT_MISSING",
                    "Нет publication input",
                    source,
                  );
                }
              },
              guard: () => guard(),
              checkLive: () => {
                callbackGuard();
                hostGuard();
              },
            });
          });
        } finally {
          callbackLife.active = false;
        }
      },
      callbackLife,
      () => operation.pandocBinding(),
    );
    if (projectBatches.active || projectBatches.failed) {
      fail("OPERATION_INCOMPLETE", "A1 batch failed/not awaited");
    }
    await guard();
    hostGuard();
    if (projectBatches.active || projectBatches.failed) {
      fail(
        "OPERATION_INCOMPLETE",
        "A1 batch failed/not awaited after operation callback",
      );
    }
    return result;
  };
  try {
    await guard();
    return complete.state.assignment
      ? await withAssignmentExecution(
        complete.state.assignment.runtime,
        complete.state.root,
        run,
        beforeOperationChild,
      )
      : await run();
  } finally {
    callbackLife.active = false;
    live = false;
  }
}

export type NativeOperation = ReturnType<typeof publicOperation>;

export async function withPreparedNativeCaptureScope<T>(
  prepared: AssignmentAdmission,
  reservation: NativeCaptureReservation,
  use: Parameters<typeof withNativeCaptureScope<T>>[2],
): Promise<T> {
  return await withNativeCaptureScope(
    reservation,
    { expectedSources: prepared.inputs },
    use,
    prepared,
  );
}
