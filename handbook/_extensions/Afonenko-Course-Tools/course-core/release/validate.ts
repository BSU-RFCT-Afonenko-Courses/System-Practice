import { fail } from "../contracts/project.ts";
import { decode } from "../document/contracts.ts";
import { immutable } from "../document/condition.ts";
import {
  NativeAdapterValidationResultSchema,
  NativeMetadataReadSetSchema,
  NativeReleaseValidationSchema,
} from "./contracts.ts";
import type {
  NativeAdapterValidator,
  NativeReleaseRequest,
} from "./contracts.ts";
import {
  publicationAdapterInput,
  validatePublicationFacts,
} from "./publication.ts";
import type {
  PublicationDocuments,
  PublicationPathCheck,
} from "./publication.ts";
export async function validateNativeRelease(
  {
    documents,
    identity,
    requestValue,
    validators,
    installed,
    checkPath,
    guard,
  }: {
    documents: PublicationDocuments;
    identity: {
      operation: string;
      projection: "student" | "author";
      profiles: string[];
    };
    requestValue: NativeReleaseRequest;
    validators: readonly NativeAdapterValidator[];
    installed: readonly string[];
    checkPath: PublicationPathCheck;
    guard: () => Promise<void>;
  },
) {
  // Snapshot executable descriptors before the first await; later mutation cannot change authority.
  validators = validators.map((v) => ({
    name: v.name,
    validate: v.validate,
    nativeMetadataReadSet: immutable(
      decode(
        NativeMetadataReadSetSchema,
        v.nativeMetadataReadSet,
        "CORE.ADAPTER_INVALID",
      ),
    ),
  }));
  identity = {
    operation: identity.operation,
    projection: identity.projection,
    profiles: identity.profiles,
  };
  const facts = await validatePublicationFacts({
    documents: documents,
    identity: identity,
    requestValue: requestValue,
    checkPath: checkPath,
    guard: guard,
    installed: installed,
  });
  const course = facts.course;
  const byName = new Map(validators.map((v) => [v.name, v]));
  if (
    byName.size !== validators.length ||
    validators.some((v) => typeof v.validate !== "function")
  ) fail("CORE.ADAPTER_INVALID", "Повторный/неисполнимый adapter validator");
  for (const doc of documents) {
    for (const name of course.adapters) {
      if (!installed.includes(name)) {
        fail("CORE.ADAPTER_INVALID", "Нет установленного adapter " + name);
      }
      const validator = byName.get(name);
      if (!validator) {
        fail(
          "RELEASE.ADAPTER_UNQUALIFIED",
          "Нет исполняемого owner validator " + name,
        );
      }
      await guard();
      const result = decode(
        NativeAdapterValidationResultSchema,
        await validator.validate(
          publicationAdapterInput(
            doc,
            identity,
            name,
            validator.nativeMetadataReadSet,
          ),
        ),
        "RELEASE.ADAPTER_UNQUALIFIED",
      );
      for (const input of result.sources) {
        await checkPath("", input.path, input.kind);
      }
      await guard();
    }
  }
  await guard();
  return immutable(NativeReleaseValidationSchema.parse({
    projection: identity.projection,
    profiles: identity.profiles,
    course,
    documents: documents.map((d) => ({
      source: d.source,
      format: d.early.context.format,
    })),
    exerciseIds: facts.exerciseIds,
    assessmentIds: facts.assessmentIds,
    validatedAdapters: course.adapters,
  }));
}
