// Bounded projection of already captured facts. No resolver, file read or legacy hash.
// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
import { NativeWebFormatSchema } from "./contracts.ts";
import type { NativeOperationIdentity } from "./contracts.ts";
import type { EarlyDocument } from "../document/contracts.ts";
import { NativeProjectFactSchema } from "../document/project-facts.ts";
import type {
  NativeProjectFact,
  NativeProjectFactsCaptureSchema,
} from "../document/project-facts.ts";
import { bindProjectMaterializations } from "../domain/project-materialization.ts";
import { immutable } from "../document/condition.ts";
import { fail } from "../contracts/project.ts";
const source = z.string().min(1).refine((s) =>
  !s.startsWith("/") && !s.includes("\\") && !s.includes("\0") &&
  s.split("/").every((p) => p && p !== "." && p !== "..")
);
export const NativeAssignmentProvenanceSchema = z.strictObject({
  documents: z.array(z.strictObject({
    source,
    format: NativeWebFormatSchema,
    projects: z.array(NativeProjectFactSchema),
    projectChecks: z.unknown().optional(),
  })),
});
export type NativeAssignmentProvenance = z.output<
  typeof NativeAssignmentProvenanceSchema
>;
/** Уже декодированные completeSchema releaseDocuments; shape boundary — у reader. */
type Captured = {
  source: string;
  early: Pick<EarlyDocument, "definitions" | "release"> & {
    context: EarlyDocument["context"] & {
      captureWitness: string;
      format: z.output<typeof NativeWebFormatSchema>;
    };
  };
  projectFacts?: z.output<typeof NativeProjectFactsCaptureSchema> | undefined;
};
export function validateAssignmentProvenance(
  identity: NativeOperationIdentity,
  ownerInputs: readonly string[],
  capturedInputs: readonly string[],
  documents: readonly Captured[],
): NativeProjectFact[] {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const unique = (items: readonly string[]) =>
    new Set(items).size === items.length;
  if (
    !ownerInputs.length || !unique(ownerInputs) || !unique(capturedInputs) ||
    !unique(documents.map((d) => d.source)) ||
    ownerInputs.length !== capturedInputs.length ||
    ownerInputs.some((s) => !capturedInputs.includes(s)) ||
    documents.length !== capturedInputs.length ||
    capturedInputs.some((s) => !documents.some((d) => d.source === s))
  ) {
    fail(
      "BODY.PROVENANCE_COVERAGE",
      "Captured documents не покрывают полный qualified owner input scope",
    );
  }
  const frames: z.output<typeof NativeProjectFactsCaptureSchema>[] = [];
  for (const doc of documents) {
    const frame = doc.projectFacts;
    if (!frame) {
      fail(
        "BODY.PROVENANCE_UNQUALIFIED",
        "Отсутствует native project facts producer",
      );
    }
    const ctx = doc.early.context,
      declared = (doc.early.release?.declarations ?? []).filter((d) =>
        d.project
      );
    if (
      !same(frame.context, ctx) || frame.source !== doc.source ||
      ctx.operation !== identity.operation ||
      ctx.projection !== identity.projection ||
      !same(ctx.profiles, identity.profiles) ||
      frame.projects.length !== declared.length ||
      !unique(frame.projects.map((p) => p.exerciseId)) || declared.some((d) =>
        !frame.projects.some((p) =>
          p.exerciseId === d.id && p.source === doc.source &&
          "/" + p.projectRoot === d.project && p.projectCheck === d.check
        )
      )
    ) {
      fail(
        "BODY.PROVENANCE_UNQUALIFIED",
        "Project facts не принадлежат тому же полному preprojection capture",
      );
    }
    frames.push(frame);
  }
  return bindProjectMaterializations(frames);
}

/** Публичная проекция проверенных private facts; отдельной authority не создаёт. */
export function buildAssignmentProvenance(
  identity: NativeOperationIdentity,
  ownerInputs: readonly string[],
  capturedInputs: readonly string[],
  documents: readonly Captured[],
): NativeAssignmentProvenance {
  const bound = validateAssignmentProvenance(
    identity,
    ownerInputs,
    capturedInputs,
    documents,
  );
  const value: NativeAssignmentProvenance = {
    documents: documents.map((doc) => ({
      source: doc.source,
      format: doc.early.context.format,
      projects: bound.filter((fact) => fact.source === doc.source),
      ...(doc.early.release?.nativeMetadata.projectChecks !== undefined
        ? { projectChecks: doc.early.release.nativeMetadata.projectChecks }
        : {}),
    })),
  };
  // immutable не клонирует: raw plane и прочие private input references отделяются.
  return immutable(structuredClone(value));
}
