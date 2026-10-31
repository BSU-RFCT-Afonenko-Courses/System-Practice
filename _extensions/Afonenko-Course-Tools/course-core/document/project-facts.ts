// Wire validation for EXISTING projects.lua ProjectFact; no second business resolver.
// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
import { DocumentContextSchema } from "./contracts.ts";
const sourceProfile = z.strictObject({
  mode: z.enum(["implementation", "student-tests"]),
  root: z.string().min(1),
  include: z.array(z.string()),
});
const check = z.object({
  profile: z.string().min(1),
  runtime: z.string().min(1),
  sourceProfile,
  "source-profile": z.string().min(1),
  tests: z.array(z.string()),
}).catchall(z.unknown());
export const NativeProjectMaterializationSchema = z.strictObject({
  commonFiles: z.array(
    z.strictObject({
      source: z.string(),
      target: z.string(),
      audience: z.enum(["student", "grading"]),
    }),
  ),
  includeGit: z.boolean().optional(),
});
export const NativeProjectFactSchema = z.strictObject({
  exerciseId: z.string().regex(/^exr-/),
  source: z.string().min(1),
  projectRoot: z.string().min(1),
  bankMember: z.boolean(),
  purpose: z.enum([
    "demonstration",
    "discussion",
    "independent-study",
    "control",
  ]).optional(),
  statementVisibility: z.enum(["open", "restricted"]),
  artifactPolicy: z.strictObject({
    student: z.enum(["starter", "full"]).optional(),
    full: z.literal("full"),
    conditions: z.boolean(),
  }),
  check: check.optional(),
  materialization: NativeProjectMaterializationSchema.optional(),
});
export type NativeProjectFact = z.output<typeof NativeProjectFactSchema>;
export const NativeProjectFactsCaptureSchema = z.strictObject({
  schema: z.literal("course-native-project-facts-v1"),
  context: DocumentContextSchema.extend({ captureWitness: z.uuid() }),
  source: z.string().min(1),
  projects: z.array(NativeProjectFactSchema).max(4096),
  projectMaterializations: z.record(
    z.string(),
    NativeProjectMaterializationSchema,
  ),
  collectCalls: z.literal(1),
});
