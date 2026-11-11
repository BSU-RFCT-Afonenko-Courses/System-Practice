import { createMetrics as __createMetrics } from "../observability/bridge.ts";
import vocabulary from "../contract-vocabulary.json" with { type: "json" };
import { fail } from "../contracts/project.ts";
import type {
  EarlyDocument,
  FinalizedDocument,
} from "../document/contracts.ts";
import { decode } from "../document/contracts.ts";
import { immutable } from "../document/condition.ts";
import {
  NativeAdapterValidationInputSchema,
  NativeMetadataReadSetSchema,
  NativeReleaseRequestSchema,
} from "./contracts.ts";
import type {
  NativeAdapterValidationInput,
  NativeAdapterValidationResult,
  NativeMetadataSlot,
  NativeReleaseRequest,
} from "./contracts.ts";
import type { NativeOperationIdentity } from "../runtime/contracts.ts";
import type { NativeOperation } from "../runtime/operation.ts";

export type PublicationDocuments = readonly {
  source: string;
  early: Pick<EarlyDocument, "context" | "definitions" | "release">;
  final: Pick<FinalizedDocument, "hasPublicSolution">;
}[];
type NativePublicationDocuments = readonly (PublicationDocuments[number] & {
  early: {
    context: Pick<
      NativeAdapterValidationInput["origin"],
      "captureWitness" | "format"
    >;
  };
})[];
export type PublicationPathCheck = (
  source: string,
  path: string,
  kind?: "file" | "directory",
) => Promise<void>;
type PublicationIdentity = Pick<
  NativeOperationIdentity,
  "operation" | "projection" | "profiles"
>;

/** Только Core-семантика actual capture; full grading остаётся у course exporter. */
export async function validatePublicationFacts(
  { documents, identity, requestValue, checkPath, guard, installed }: {
    documents: PublicationDocuments;
    identity: PublicationIdentity;
    requestValue: NativeReleaseRequest;
    checkPath: PublicationPathCheck;
    guard: () => Promise<void>;
    installed?: readonly string[];
  },
): Promise<
  {
    course: NonNullable<EarlyDocument["release"]>["course"];
    exerciseIds: string[];
    assessmentIds: string[];
  }
> {
  await guard();
  const request = decode(
    NativeReleaseRequestSchema,
    requestValue,
    "RELEASE.EXPECTED_SOURCES_INVALID",
  );
  const expected = new Set(request.expectedSources);
  if (expected.size !== request.expectedSources.length) {
    fail("RELEASE.EXPECTED_SOURCES_INVALID", "Повторные expected sources");
  }
  if (
    documents.length !== expected.size ||
    documents.some((d) => !expected.has(d.source))
  ) fail("RELEASE.COVERAGE", "Missing/unexpected current document");
  const facts = new Map<
      string,
      {
        source: string;
        declaration: EarlyDocument["definitions"][string];
        hasPublicSolution: boolean;
      }
    >(),
    assessments = new Set<string>(),
    bindings = new Set<string>();
  const first = documents[0]?.early.release;
  if (!first) {
    fail("RELEASE.METADATA_MISSING", "Нет current ранних release facts");
  }
  const course = first.course;
  const view = identity.projection === "student" ? "student" : "full";
  if (request.courseId !== undefined && course.id !== request.courseId) {
    fail("RELEASE.MIXED_COURSE", "Неожиданный course.id");
  }
  if (course.id && course.view !== view) {
    fail(
      "RELEASE.EXPECTATION_MISMATCH",
      "course.view отличается от native projection",
    );
  }
  async function validateDocumentDeclarations(
    doc: PublicationDocuments[number],
    release: NonNullable<EarlyDocument["release"]>,
  ) {
    for (const item of release.declarations) {
      if (facts.has(item.id)) fail("CORE.DUPLICATE_EXERCISE", item.id);
      const declaration = doc.early.definitions[item.id];
      if (!declaration) {
        fail("CORE.METADATA_INVALID", "Нет декларации", doc.source, item.id);
      }
      const allowed = new Set([
        ...vocabulary.exerciseAttributes,
        ...vocabulary.pedagogyAttributes.filter((k) =>
          !["for", "requirement", "work-mode"].includes(k)
        ),
        "name",
        "when-profile",
        "unless-profile",
        "when-format",
        "unless-format",
        "when-meta",
        "unless-meta",
      ]);
      for (const key of Object.keys(item.attributes)) {
        if (
          !allowed.has(key) &&
          !course.adapters.some((name) => key.startsWith(name + "-"))
        ) {
          fail(
            "CORE.EXERCISE_INVALID",
            "Неизвестный атрибут упражнения: " + key,
            doc.source,
            item.id,
          );
        }
      }
      if (
        item.target &&
        (!item.head || item.head.level < 1 || item.head.level > 6 ||
          !item.head.title.trim())
      ) {
        fail(
          "CORE.EXERCISE_INVALID",
          "Упражнение с target требует непустой заголовок уровня 1–6",
          doc.source,
          item.id,
        );
      }
      facts.set(item.id, {
        source: doc.source,
        declaration,
        hasPublicSolution: doc.final.hasPublicSolution[item.id] === true,
      });
      if (
        item.target && item.target !== "manual" &&
        (!course.adapters.includes(item.target) ||
          (installed !== undefined && !installed.includes(item.target)))
      ) {
        fail(
          "CORE.UNKNOWN_TARGET",
          "Не установлен объявленный adapter " + item.target,
          doc.source,
          item.id,
        );
      }
      if (item.project) {
        if (bindings.has(item.id)) fail("CORE.PROJECT_CONFLICT", item.id);
        bindings.add(item.id);
        await checkPath(doc.source, item.project);
      }
    }
  }
  for (const doc of documents) {
    const release = doc.early.release;
    if (!release) {
      fail("RELEASE.METADATA_MISSING", "Нет current release facts", doc.source);
    }
    if (JSON.stringify(release.course) !== JSON.stringify(course)) {
      fail("RELEASE.MIXED_COURSE", "Разные course/view/adapters", doc.source);
    }
    await validateDocumentDeclarations(doc, release);
  }

  for (const doc of documents) {
    const release = doc.early.release!;
    const a = release.assessment;
    if (a) {
      if (assessments.has(a.id)) fail("CORE.DUPLICATE_ASSESSMENT", a.id);
      assessments.add(a.id);
      if (a.relatedExercise && !facts.has(a.relatedExercise)) {
        fail("CORE.RELATED_EXERCISE_MISSING", a.relatedExercise);
      }
      for (const slot of a.slots) {
        for (const member of slot.candidates) {
          const fact = facts.get(member);
          if (!fact) fail("CORE.UNKNOWN_MEMBER", member);
          const d = fact.declaration;
          if (
            (a.kind === "test" || a.kind === "practical") &&
            d["statement-visibility"] !== "restricted"
          ) {
            fail(
              "CORE.ASSESSMENT_INVALID",
              "test/practical требуют restricted",
              doc.source,
              member,
            );
          }
          if (
            slot.assignment.stage === "demonstration" &&
            (d["statement-visibility"] !== "open" ||
              d["course-role"] !== "demonstration" || !fact.hasPublicSolution)
          ) {
            fail(
              "CORE.ASSESSMENT_INVALID",
              "demonstration требует open, purpose и actual public solution",
              doc.source,
              member,
            );
          }
        }
      }
    }
  }
  await guard();
  return {
    course,
    exerciseIds: [...facts.keys()],
    assessmentIds: [...assessments],
  };
}

/** Общие прочитанные data planes; common semantics не создаёт Native authority. */
function adapterInputData(
  doc: PublicationDocuments[number],
  name: string,
  readSet: readonly NativeMetadataSlot[],
): Pick<
  NativeAdapterValidationInput,
  "course" | "nativeMetadata" | "declarations" | "assessment"
> {
  const release = doc.early.release!;
  const values: NativeAdapterValidationInput["nativeMetadata"] = {};
  for (const slot of readSet) {
    const source: Partial<Record<NativeMetadataSlot, unknown>> =
      slot === "configuration" || slot === "assessment"
        ? release.nativeMetadata.adapters[name] ?? {}
        : release.nativeMetadata;
    if (Object.hasOwn(source, slot)) values[slot] = source[slot];
  }
  return {
    course: release.course,
    nativeMetadata: values,
    declarations: release.declarations.filter((d) => d.target === name).map((
      d,
    ) => ({
      id: d.id,
      attributes: d.attributes,
      ...(d.answer ? { answer: d.answer } : {}),
    })),
    ...(release.assessment ? { assessment: release.assessment } : {}),
  };
}

/** Полный release validator сохраняет decoder для generic EarlyDocument input. */
export function publicationAdapterInput(
  doc: PublicationDocuments[number],
  identity: PublicationIdentity,
  name: string,
  readSet: readonly NativeMetadataSlot[],
): NativeAdapterValidationInput {
  return immutable(NativeAdapterValidationInputSchema.parse({
    origin: {
      operation: identity.operation,
      captureWitness: doc.early.context.captureWitness,
      source: doc.source,
      format: doc.early.context.format,
      projection: identity.projection,
      profiles: identity.profiles,
    },
    ...adapterInputData(doc, name, readSet),
  }));
}

/** Native context уже подтверждён capture boundary; внутреннего self-parse нет. */
function nativePublicationAdapterInput(
  doc: NativePublicationDocuments[number],
  identity: PublicationIdentity,
  name: string,
  readSet: readonly NativeMetadataSlot[],
): NativeAdapterValidationInput {
  const input: NativeAdapterValidationInput = {
    origin: {
      operation: identity.operation,
      captureWitness: doc.early.context.captureWitness,
      source: doc.source,
      format: doc.early.context.format,
      projection: identity.projection,
      profiles: identity.profiles,
    },
    ...adapterInputData(doc, name, readSet),
  };
  // Snapshot отделяет данные callback от privately parsed capture; freeze не клонирует.
  return immutable(structuredClone(input));
}

export type NativePublicationSelection = NativeReleaseRequest | undefined;
type PublicationOperations = Pick<
  NativeOperation,
  | "identity"
  | "catalog"
  | "document"
  | "condition"
  | "assertCurrent"
  | "resourceFiles"
  | "withProjectContracts"
>;
export type NativePublication = PublicationOperations & {
  readonly root: string;
  readonly outputDirectory: string;
  readonly course: Awaited<
    ReturnType<typeof validatePublicationFacts>
  >["course"];
  adapterInputs(
    name: string,
    readSet: readonly NativeMetadataSlot[],
  ): readonly NativeAdapterValidationInput[];
  checkSources(
    source: string,
    references: readonly NativeAdapterValidationResult["sources"][number][],
  ): Promise<void>;
};

/** Borrowed methods истекают вместе с настоящим Core callback; data не являются authority. */
export async function createNativePublication(
  { operation, documents, selection, owner, checkPath, guard, checkLive }: {
    operation: NativeOperation;
    documents: NativePublicationDocuments;
    selection: NativePublicationSelection;
    owner: { readonly root: string; readonly outputDirectory: string };
    checkPath: PublicationPathCheck;
    guard: () => Promise<void>;
    checkLive: () => void;
  },
): Promise<NativePublication> {
  const corePhaseAction =
    async function createNativePublicationPhase(): Promise<NativePublication> {
      const facts = await validatePublicationFacts({
        documents: documents,
        identity: operation.identity,
        requestValue: selection ??
          { expectedSources: documents.map((d) => d.source) },
        checkPath: checkPath,
        guard: guard,
      });
      const course = immutable(facts.course);
      const sources = new Set(documents.map((d) => d.source));
      return Object.freeze({
        get root() {
          checkLive();
          return owner.root;
        },
        get outputDirectory() {
          checkLive();
          return owner.outputDirectory;
        },
        get identity() {
          checkLive();
          return operation.identity;
        },
        get catalog() {
          checkLive();
          return operation.catalog;
        },
        course,
        document: operation.document,
        condition: operation.condition,
        assertCurrent: operation.assertCurrent,
        resourceFiles: operation.resourceFiles,
        withProjectContracts: operation.withProjectContracts,
        adapterInputs(name: string, readSet: readonly NativeMetadataSlot[]) {
          checkLive();
          const slots = decode(
            NativeMetadataReadSetSchema,
            readSet,
            "CORE.ADAPTER_INVALID",
          );
          return course.adapters.includes(name)
            ? documents.map((doc) =>
              nativePublicationAdapterInput(
                doc,
                operation.identity,
                name,
                slots,
              )
            )
            : [];
        },
        async checkSources(
          source: string,
          references:
            readonly NativeAdapterValidationResult["sources"][number][],
        ) {
          checkLive();
          if (!sources.has(source)) {
            fail("RELEASE.COVERAGE", "Foreign publication source", source);
          }
          await guard();
          for (const reference of references) {
            await checkPath(source, reference.path, reference.kind);
          }
          await guard();
          checkLive();
        },
      });
    };
  return await __createMetrics("course-core").wrapAsync({
    id: "course-core.release.publication.createNativePublication",
    kind: "phase",
    origin: "manual",
  }, corePhaseAction)();
}
