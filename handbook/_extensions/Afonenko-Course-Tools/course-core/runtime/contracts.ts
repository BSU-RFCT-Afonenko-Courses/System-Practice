// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
import {
  DocumentContextSchema,
  FinalizedDocumentSchema,
} from "../document/contracts.ts";
const path = z.string().min(1).max(4096).refine((s) =>
  !s.startsWith("/") && !s.includes("\\") && !s.includes("\0") &&
  s.split("/").every((p) => p && p !== "." && p !== "..")
);
import { NativeWebFormatSchema } from "../document/native-format.ts";
export { NativeWebFormatSchema } from "../document/native-format.ts";
export const NativeExpectedDocumentSchema = z.strictObject({
  source: path,
  format: NativeWebFormatSchema,
});
export const NativePendingOperationExpectationSchema = z.strictObject({
  root: z.string().startsWith("/"),
  profiles: z.array(z.string().regex(/^[-a-z0-9]+$/)).max(16),
  projection: z.enum(["student", "author"]),
  outputDirectory: z.string().startsWith("/"),
});
export const NativeOperationExpectationSchema =
  NativePendingOperationExpectationSchema.extend({
    expectedDocuments: z.array(NativeExpectedDocumentSchema).min(1).max(4096)
      .optional(),
  });
export type NativePendingOperationExpectation = z.input<
  typeof NativePendingOperationExpectationSchema
>;
export const NativeOperationIdentitySchema = z.strictObject({
  operation: z.uuid(),
  profiles: z.array(z.string()),
  projection: z.enum(["student", "author"]),
  // Технический ABI native transport; actual программа хранится в owner witness.
  runtime: z.literal("quarto-1.11.5"),
});
export const NativeDocumentRequestSchema = z.strictObject({ source: path });
export const NativeAssignmentRequestSchema = NativeDocumentRequestSchema.extend(
  { assessmentId: z.string().regex(/^[a-z][a-z0-9-]*$/) },
);
export const NativeConditionRequestSchema = NativeDocumentRequestSchema.extend({
  exerciseId: z.string().regex(/^exr-[a-z0-9][a-z0-9-]*$/),
  view: z.union([
    z.enum(["student", "author"]),
    z.strictObject({
      view: z.enum(["student", "author"]),
      occurrence: z.string().min(1).optional(),
    }),
  ]),
});
export const NativeCatalogSchema = z.strictObject({
  identity: NativeOperationIdentitySchema,
  documents: z.array(z.strictObject({
    source: path,
    output: path,
    format: NativeWebFormatSchema,
    role: z.enum(["exercise-bank", "page"]),
    exercises: z.array(z.strictObject({
      id: z.string(),
      occurrence: z.string(),
      anchor: z.string(),
      hasPublicSolution: z.boolean(),
      project: path.optional(),
    })),
  })),
});
export const NativePublicDocumentSchema = FinalizedDocumentSchema.extend({
  status: z.literal("complete"),
  context: DocumentContextSchema.extend({
    input: path,
    format: NativeWebFormatSchema,
    projection: z.enum(["student", "author"]),
  }),
});
export type NativePublicDocument = z.output<typeof NativePublicDocumentSchema>;
export const NativeResourceRequestSchema = z.strictObject({
  files: z.array(z.strictObject({ source: path, target: path })).min(1).max(
    4096,
  ),
});
export const NativeResourceFilesSchema = z.strictObject({
  audience: z.enum(["student", "full"]),
  files: z.array(z.strictObject({
    source: path,
    target: path,
    bytes: z.instanceof(Uint8Array),
  })).min(1).max(4096),
});
export type NativeOperationExpectation = z.input<
  typeof NativeOperationExpectationSchema
>;
export type NativeOperationIdentity = z.output<
  typeof NativeOperationIdentitySchema
>;
export type NativeCatalog = z.output<typeof NativeCatalogSchema>;
export type NativeDocumentRequest = z.input<typeof NativeDocumentRequestSchema>;
export type NativeConditionRequest = z.input<
  typeof NativeConditionRequestSchema
>;
export type NativeResourceRequest = z.input<typeof NativeResourceRequestSchema>;
export type NativeResourceFiles = z.output<
  typeof NativeResourceFilesSchema
>;

export const NativeOperationMetricsSchema = z.strictObject({
  inspectCalls: z.number().int().nonnegative(),
  nativeMetadataBytes: z.number().int().nonnegative(),
  childRenders: z.number().int().nonnegative(),

  resourceByteReads: z.number().int().nonnegative(),
  resourceCacheHits: z.number().int().nonnegative(),
});
export type NativeOperationMetrics = z.output<
  typeof NativeOperationMetricsSchema
>;

export const NativePendingOperationSchema = z.strictObject({
  identity: NativeOperationIdentitySchema,
  inputs: z.array(z.strictObject({ source: path, captureWitness: z.uuid() }))
    .min(1).max(4096),
});
export type NativePendingOperation = z.output<
  typeof NativePendingOperationSchema
>;

/** Pending transport omits document facts observed only by native pre-ast. */
export const NativePendingDocumentContextSchema = DocumentContextSchema.omit({
  format: true,
  defaults: true,
  exerciseBank: true,
}).extend({
  captureWitness: z.uuid(),
  profiles: NativeOperationExpectationSchema.shape.profiles,
});

export const NativeCaptureReservationSchema = z.strictObject({
  root: z.string().startsWith("/"),
  projection: z.enum(["student", "author"]),
  outputDirectory: z.string().startsWith("/"),
});
export const NativeCaptureScopeOptionsSchema = z.strictObject({
  expectedSources: z.array(path).min(1).max(4096).refine(
    (s) => new Set(s).size === s.length,
    "Повторный expected source",
  ),
});
export type NativeCaptureReservation = z.input<
  typeof NativeCaptureReservationSchema
>;
export type NativeCaptureScopeOptions = z.input<
  typeof NativeCaptureScopeOptionsSchema
>;
