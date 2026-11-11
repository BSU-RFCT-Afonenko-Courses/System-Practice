import { join, relative } from "stdlib/path";
// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
import { fail } from "../contracts/project.ts";
import {
  decode,
  EarlyDocumentSchema,
  FinalizedDocumentSchema,
} from "../document/contracts.ts";
import { NativeProjectFactsCaptureSchema } from "../document/project-facts.ts";
import { SupportedQuartoVersionSchema } from "../infrastructure/quarto-version.ts";
import { regular } from "./source-paths.ts";
import {
  NativeCaptureReservationSchema,
  NativeCatalogSchema,
  NativePublicDocumentSchema,
  NativeWebFormatSchema,
} from "./contracts.ts";

/** Private on-disk representation and guarded storage; lifecycle transitions stay in operation.ts. */
export const base = (root: string) =>
  join(root, "_generated/course-spec/native-ts");
export const pointer = (root: string) => join(base(root), "active.json");
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export const pathSchema = z.string().min(1).refine((s) =>
  !s.startsWith("/") && !s.includes("\\") && !s.includes("\0") &&
  s.split("/").every((p) => p && p !== "." && p !== "..")
);
export const stateSchema = z.strictObject({
  schema: z.literal("course-native-operation-private-v2"),
  operation: z.uuid(),
  root: z.string(),
  directory: z.string(),
  outputDirectory: z.string(),
  profiles: z.array(z.string()),
  projection: z.enum(["student", "author"]),
  captureWitnesses: z.record(pathSchema, z.uuid()),
  assignment: z.strictObject({
    assessments: z.array(
      z.strictObject({ source: pathSchema, id: z.string().min(1) }),
    ).min(1).max(4096),
    runtime: z.strictObject({
      executable: z.string().min(1),
      environment: z.record(z.string(), z.string()),
      profiles: z.array(z.string()),
      outputDirectory: z.string(),
      inputs: z.array(pathSchema),
    }),
  }).optional(),
  inputs: z.array(pathSchema),
  ownerInputs: z.array(pathSchema).default([]),
  ownerWitness: z.strictObject({
    quarto: z.strictObject({ version: SupportedQuartoVersionSchema }),
    dir: z.string(),
    config: z.record(z.string(), z.unknown()),
    files: z.strictObject({
      input: z.array(z.string()),
      config: z.array(z.string()),
    }),
  }).optional(),
  metrics: z.strictObject({
    inspectCalls: z.number(),

    nativeMetadataBytes: z.number(),
    childRenders: z.number(),
  }),
});
export type State = z.output<typeof stateSchema>;
export const operationMetricKeys = stateSchema.shape.metrics.keyof().options;
export const completeSchema = z.strictObject({
  state: stateSchema,
  catalog: NativeCatalogSchema,
  documents: z.array(NativePublicDocumentSchema),
  resources: z.array(
    z.strictObject({
      source: pathSchema,
      path: z.string(),
      identity: z.string(),
      sourceIdentities: z.array(z.string()).min(1),
      media: z.strictObject({
        input: pathSchema,
        ordinal: z.number().int().min(1).max(4096),
      }).optional(),
      documents: z.array(pathSchema),
    }),
  ),
  outputs: z.array(z.strictObject({ path: pathSchema })),
  releaseDocuments: z.array(
    z.strictObject({
      source: pathSchema,
      projectFacts: NativeProjectFactsCaptureSchema.optional(),
      early: EarlyDocumentSchema.omit({ ast: true, occurrences: true }).extend({
        context: EarlyDocumentSchema.shape.context.extend({
          captureWitness: z.uuid(),
          format: NativeWebFormatSchema,
        }),
      }),
      final: FinalizedDocumentSchema.pick({ hasPublicSolution: true }),
    }),
  ),
});
export async function json(path: string): Promise<unknown> {
  const value: unknown = JSON.parse(await Deno.readTextFile(path));
  return value;
}
export function nativePointer(value: unknown, root: string, message: string) {
  if (!record(value)) fail("OPERATION_BINDING", message);
  const operation = z.uuid().safeParse(value.operation);
  if (!operation.success) fail("OPERATION_BINDING", message);
  const directory = join(base(root), operation.data);
  if (value.directory !== directory) fail("OPERATION_BINDING", message);
  return { operation: operation.data, directory };
}
export async function assertPrivate(state: State) {
  if (
    await Deno.realPath(state.root) !== state.root ||
    !same(
      await json(
        await regular(state.root, relative(state.root, pointer(state.root))),
      ),
      {
        operation: state.operation,
        directory: state.directory,
      },
    )
  ) fail("OPERATION_CHANGED", "Активная native операция заменена");
}
const childSchema = z.strictObject({
  token: z.uuid(),
  inputs: z.array(pathSchema).min(1),
  used: z.boolean(),
  posted: z.boolean(),
});
const reservationSchema = NativeCaptureReservationSchema.extend({
  schema: z.literal("course-native-capture-reservation-v1"),
  operation: z.uuid(),
  directory: z.string(),
  expectedSources: z.array(pathSchema).min(1),
  status: z.enum(["reserved", "prepared", "bound", "failed", "sealed"]),
  children: z.array(childSchema),
});
export type Reservation = z.output<typeof reservationSchema>;
export const reservationPath = (r: Pick<Reservation, "directory">) =>
  join(r.directory, "reservation.json");
export async function readOptionalPointer(root: string) {
  try {
    return nativePointer(
      await json(await regular(root, relative(root, pointer(root)))),
      root,
      "Чужой private operation pointer",
    );
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}
export async function readReservation(root: string): Promise<Reservation> {
  const active = nativePointer(
    await json(await regular(root, relative(root, pointer(root)))),
    root,
    "Чужой scope pointer",
  );
  const reservation = decode(
    reservationSchema,
    await json(
      await regular(
        root,
        relative(root, join(active.directory, "reservation.json")),
      ),
    ),
    "OPERATION_BINDING",
  );
  if (
    reservation.root !== root || reservation.operation !== active.operation ||
    reservation.directory !== active.directory
  ) {
    fail("OPERATION_BINDING", "Чужая reservation");
  }
  return reservation;
}
/** Short cross-process writer lock. No lock is held across a native command/inspect. */
export async function withWriter<T>(
  root: string,
  use: () => Promise<T>,
): Promise<T> {
  const path = join(base(root), "writer.lock");
  let lock: Deno.FsFile;
  try {
    lock = await Deno.open(path, { write: true, createNew: true, mode: 0o600 });
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      fail("OPERATION_CHANGED", "Конкурирующий native writer");
    }
    throw e;
  }
  try {
    return await use();
  } finally {
    lock.close();
    await Deno.remove(path);
  }
}
export async function writePrivate(path: string, value: unknown) {
  const temp = path + "." + crypto.randomUUID();
  await Deno.writeTextFile(temp, JSON.stringify(value), {
    createNew: true,
    mode: 0o600,
  });
  try {
    await Deno.rename(temp, path);
  } finally {
    try {
      await Deno.remove(temp);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
}
export async function assertReservationCurrent(r: Reservation) {
  const current = await readReservation(r.root);
  if (current.operation !== r.operation || !same(current, r)) {
    fail("OPERATION_CHANGED", "Reservation заменена/изменена");
  }
}
export function activeChild(r: Reservation, token: string) {
  const child = r.children.at(-1);
  if (
    r.status === "failed" || r.status === "sealed" || !child ||
    child.token !== token || child.posted
  ) {
    fail("OPERATION_BINDING", "Неверный/завершённый native child token");
  }
  return child;
}

export type CompleteOperation = z.output<typeof completeSchema>;
