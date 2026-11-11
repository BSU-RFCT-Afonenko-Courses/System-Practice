const nativeArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);
import { citationResourceGuard } from "../body-export/citation-inputs.ts";
import { installedNativeAdapters } from "../infrastructure/installed-adapters.ts";
import { operationProjectContextReuse } from "../infrastructure/project-context.ts";
import type { NativeOperationProjectContextBatch } from "../infrastructure/project-context.ts";
import { ProjectContextRequestSchema } from "../contracts/project.ts";
import type { ProjectContextRequest } from "../contracts/project.ts";
import {
  buildAssignmentProvenance,
  validateAssignmentProvenance,
} from "./assignment-provenance.ts";
import {
  assignmentProjectRoot,
  assignmentRoleIndex,
} from "./assignment-roles.ts";
import { bindAssignmentCondition } from "./assignment-condition.ts";
import { buildAssignmentBody } from "../body-export/assignment.ts";
import type { AssignmentBodyCache } from "../body-export/assignment.ts";
import type {
  NativeAssignmentDelivery,
  NativeAssignmentDeliveryOptions,
  NativeAssignmentRequest,
} from "./assignment-delivery.ts";
import { withAssignmentBeforeChild } from "./assignment-execution.ts";
import { selectNativePandoc } from "./pandoc-binding.ts";
import type {
  NativePandocBinding,
  NativePandocHost,
} from "./pandoc-binding.ts";
import { excluded, ownedPhysical } from "./source-paths.ts";
import { toolCachePath } from "../infrastructure/tool-cache.ts";
import { validateNativeRelease } from "../release/validate.ts";
import type {
  NativeAdapterValidator,
  NativeReleaseRequest,
} from "../release/contracts.ts";
import { bindNativeValue } from "./capabilities.ts";
import { dirname, relative, resolve } from "stdlib/path";
// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
import { boundInput, fail } from "../contracts/project.ts";
import { decode } from "../document/contracts.ts";
import { immutable, selectCondition } from "../document/condition.ts";
import {
  NativeAssignmentRequestSchema,
  NativeConditionRequestSchema,
  NativeDocumentRequestSchema,
  NativeOperationMetricsSchema,
} from "./contracts.ts";
import type {
  NativeConditionRequest,
  NativeDocumentRequest,
  NativeResourceRequest,
} from "./contracts.ts";
import type { CompleteOperation } from "./operation-store.ts";
import { pathSchema, same } from "./operation-store.ts";
import { operationResourceReader } from "./operation-resources.ts";

/** Shared callback authority, owned and invalidated only by operation.ts. */
export interface NativeOperationReaderScope {
  syncGuard(): void;
  guard(): Promise<void>;
  callbackGuard(): void;
  hostGuard(): void;
  readonly metrics: z.output<typeof NativeOperationMetricsSchema>;
  readonly projectBatches: { active: number; failed: boolean };
  readonly host: NativePandocHost;
}

export function publicOperation(
  complete: CompleteOperation,
  scope: NativeOperationReaderScope,
) {
  const {
    syncGuard,
    guard,
    metrics,
    projectBatches,
    hostGuard,
    callbackGuard,
    host,
  } = scope;
  let pandocSelection: Promise<NativePandocBinding | undefined> | undefined;
  const documents = new Map(
    complete.documents.map((d) => [d.context.input, immutable(d)]),
  );
  const generation = Object.freeze({});
  let reuse: ReturnType<typeof operationProjectContextReuse> | undefined;
  const declaredProjects = () =>
    complete.releaseDocuments.flatMap((row) =>
      Object.entries(row.early.definitions).flatMap(([id, value]) =>
        value.project
          ? [{ source: row.source, id, project: value.project }]
          : []
      )
    );
  let releaseValidated = false,
    releaseValidationFailed = false,
    validating = false;
  const roleCache = new Map<
    string,
    {
      pairs: NativeAssignmentDeliveryOptions["projectPlans"];
      index: Awaited<ReturnType<typeof assignmentRoleIndex>>;
    }
  >();
  const noReferences = {};
  const bodyCaches = new WeakMap<
    object,
    {
      namespace?: string | undefined;
      resolve?: unknown;
      sourceUrl?: unknown;
      cache: AssignmentBodyCache;
    }
  >();
  const deliveryCache = new Map<
    string,
    { roles: object; references: object; delivery: NativeAssignmentDelivery }
  >();

  const resourceFiles = operationResourceReader(complete, scope);
  for (const doc of documents.values()) {
    bindNativeValue(
      doc,
      complete.state.root,
      () => guard(),
      async (source, target, assertIdentity) => {
        const observed = complete.resources.find((r) =>
          r.source === source && r.documents.includes(doc.context.input)
        );
        if (!observed) return undefined;
        return (await resourceFiles(
          { files: [{ source, target }] },
          assertIdentity,
        ))
          .files[0]!.bytes;
      },
    );
  }
  const catalog = immutable(complete.catalog);
  const document = (value: NativeDocumentRequest) => {
    syncGuard();
    if (complete.state.assignment) {
      fail(
        "BODY.DELIVERY_ACCESS_REQUIRED",
        "Assignment bodies доступны только через selected delivery",
      );
    }
    const request = decode(
      NativeDocumentRequestSchema,
      value,
      "OPERATION_DOCUMENT",
    );
    const doc = documents.get(request.source);
    if (!doc) {
      fail("OPERATION_DOCUMENT", "Документ отсутствует в текущей операции");
    }
    return doc;
  };
  async function withProjectBatch<T>(
    requestsValue: readonly ProjectContextRequest[],
    use: (batch: NativeOperationProjectContextBatch) => Promise<T>,
  ): Promise<T> {
    callbackGuard();
    syncGuard();
    if (projectBatches.active || projectBatches.failed) {
      projectBatches.failed = true;
      fail("CONTEXT_REQUEST", "Active/failed operation A1 batch");
    }
    projectBatches.active++;
    const childLife = { active: true };
    let callbackLive = false;
    const checkpoint = async (insideCallback = true) => {
      try {
        callbackGuard();
        syncGuard();
        if (!childLife.active || (insideCallback && !callbackLive)) {
          fail(
            "OPERATION_EXPIRED",
            "Checkpoint принадлежит завершённой A1 batch",
          );
        }
        hostGuard();
        {
          await guard();
          callbackGuard();
          syncGuard();
          if (!childLife.active || (insideCallback && !callbackLive)) {
            fail(
              "OPERATION_EXPIRED",
              "Checkpoint завершился после callback A1 batch",
            );
          }
          hostGuard();
        }
      } catch (error) {
        projectBatches.failed = true;
        throw error;
      }
    };
    try {
      if (typeof use !== "function") {
        fail("CONTEXT_REQUEST", "A1 callback required");
      }
      const witness = complete.state.ownerWitness;
      if (
        !witness
      ) {
        fail(
          "CONTEXT_OWNER_WITNESS",
          "Отсутствует native owner metadata",
        );
      }
      if (complete.state.assignment) {
        if (!releaseValidated || releaseValidationFailed || validating) {
          fail(
            "BODY.ASSIGNMENT_VALIDATION_REQUIRED",
            "Требуется current validation",
          );
        }
      }
      boundInput(requestsValue);
      const requests = decode(
        z.array(ProjectContextRequestSchema),
        requestsValue,
        "CONTEXT_REQUEST",
      );
      const allowed = new Set(
        declaredProjects().map((row) => {
          const format = complete.releaseDocuments.find((doc) =>
            doc.source === row.source
          )!.early.context.format;
          return relative(
            complete.state.root,
            assignmentProjectRoot(complete.state.root, row),
          ) + "\0" + format;
        }),
      );
      const selected = new Set<string>();
      for (const request of requests) {
        if (
          request.owner !== complete.state.root ||
          !same(request.profiles, catalog.identity.profiles) ||
          new Set(request.directories).size !== request.directories.length
        ) fail("CONTEXT_REQUEST", "Foreign owner/profiles/duplicate input");
        for (const input of request.directories) {
          const key = input + "\0" + request.format;
          if (!allowed.has(key) || selected.has(key)) {
            fail(
              "CONTEXT_REQUEST",
              "Foreign/duplicate private project input/format",
            );
          }
          selected.add(key);
        }
      }
      if (
        complete.state.assignment &&
        (selected.size !== allowed.size ||
          [...allowed].some((key) => !selected.has(key)))
      ) {
        fail(
          "BODY.ASSIGNMENT_PROJECT_PLANS",
          "Неполное private project/format coverage",
        );
      }
      await guard();
      reuse ??= operationProjectContextReuse({
        owner: complete.state.root,
        profiles: catalog.identity.profiles,
        generation,
        outputDirectory: complete.state.outputDirectory,
        sync: () => {
          syncGuard();
          if (projectBatches.failed) {
            fail("OPERATION_INCOMPLETE", "A1 batch failed");
          }
        },
      });
      const acquire = () =>
        reuse!<T>(requests, async (batch) => {
          callbackLive = true;
          try {
            return await use(Object.freeze({
              groups: batch.groups,
              get metrics() {
                return batch.metrics;
              },
              checkpoint: () => checkpoint(),
            }));
          } finally {
            callbackLive = false;
          }
        });
      const result = await withAssignmentBeforeChild(
        () => checkpoint(false),
        acquire,
        childLife,
      );
      syncGuard();
      hostGuard();
      if (projectBatches.active !== 1 || projectBatches.failed) {
        fail(
          "OPERATION_INCOMPLETE",
          "A1 batch failed/not active after batch callback",
        );
      }
      return result;
    } catch (e) {
      projectBatches.failed = true;
      throw e;
    } finally {
      callbackLive = false;
      childLife.active = false;
      projectBatches.active--;
    }
  }

  return Object.freeze({
    identity: catalog.identity,
    catalog,
    pandocBinding(): Promise<NativePandocBinding | undefined> {
      callbackGuard();
      syncGuard();
      hostGuard();
      pandocSelection ??= selectNativePandoc(
        complete.state.assignment?.runtime.executable ??
          host?.environment.QUARTO,
        complete.state.ownerWitness?.quarto.version,
        host,
      );
      return pandocSelection.then((binding) => {
        callbackGuard();
        syncGuard();
        hostGuard();
        return binding;
      });
    },
    get metrics() {
      syncGuard();
      return immutable(NativeOperationMetricsSchema.parse({
        ...metrics,
        nativeMetadataBytes: complete.state.metrics.nativeMetadataBytes,
        childRenders: complete.state.metrics.childRenders,
      }));
    },
    document,
    condition(value: NativeConditionRequest) {
      const request = decode(
        NativeConditionRequestSchema,
        value,
        "OPERATION_DOCUMENT",
      );
      return selectCondition(
        document({ source: request.source }),
        request.exerciseId,
        request.view,
      );
    },
    assertCurrent: () => guard(),
    async validateRelease(
      request: NativeReleaseRequest,
      validators: readonly NativeAdapterValidator[] = [],
    ) {
      syncGuard();
      await guard();
      const installed = await installedNativeAdapters(complete.state.root);
      if (
        complete.state.assignment && (validating || releaseValidationFailed)
      ) {
        fail(
          "BODY.ASSIGNMENT_VALIDATION_REQUIRED",
          "Failed/reentrant assignment validation",
        );
      }
      validating = true;
      try {
        const proof = await validateNativeRelease({
          documents: complete.releaseDocuments,
          identity: catalog.identity,
          requestValue: request,
          validators: validators,
          installed: installed,
          checkPath: async (source, path, kind) => {
            const absolute = resolve(
              kind || path.startsWith("/")
                ? complete.state.root
                : dirname(resolve(complete.state.root, source)),
              path.replace(/^\//, ""),
            );
            const local = relative(complete.state.root, absolute);
            if (toolCachePath(complete.state.root, absolute)) {
              fail(
                "RESOURCE.PROJECT_PATH_INVALID",
                "Tool cache не является проектом",
              );
            }
            if (
              excluded(complete.state, absolute)
            ) {
              fail(
                "RELEASE.SOURCE_POLICY",
                "Источник проекта/адаптера исключён",
              );
            }
            const actual = await ownedPhysical(complete.state.root, local),
              info = await Deno.stat(actual);
            // Actual project bytes/roles принадлежат post-child A1 acquisition.
            if (
              (kind === "file" && !info.isFile) ||
              (kind === "directory" && !info.isDirectory) ||
              (!info.isDirectory && !info.isFile)
            ) {
              fail("RESOURCE.PROJECT_MISSING", "Нет project input");
            }
          },
          guard: () => guard(),
        });
        await guard();
        if (complete.state.assignment) {
          validateAssignmentProvenance(
            catalog.identity,
            complete.state.ownerInputs,
            complete.state.inputs,
            complete.releaseDocuments,
          );
        }
        releaseValidated = true;
        return proof;
      } catch (error) {
        if (complete.state.assignment) releaseValidationFailed = true;
        throw error;
      } finally {
        validating = false;
      }
    },
    async withProjectContexts<T>(
      requests: readonly ProjectContextRequest[],
      use: (batch: NativeOperationProjectContextBatch) => Promise<T>,
    ): Promise<T> {
      return await withProjectBatch<T>(requests, use);
    },
    async withProjectContracts<T>(
      requests: readonly ProjectContextRequest[],
      use: (
        batch: NativeOperationProjectContextBatch,
      ) => Promise<T>,
    ): Promise<T> {
      return await withProjectBatch<T>(requests, use);
    },
    async assignmentProvenance() {
      syncGuard();
      if (!complete.state.assignment) {
        fail("BODY.ASSIGNMENT_REQUIRED", "Нет explicit assignment intent");
      }
      if (!releaseValidated || releaseValidationFailed || validating) {
        fail(
          "BODY.ASSIGNMENT_VALIDATION_REQUIRED",
          "Требуется успешная текущая owner validation",
        );
      }
      await guard();
      const value = buildAssignmentProvenance(
        catalog.identity,
        complete.state.ownerInputs,
        complete.state.inputs,
        complete.releaseDocuments,
      );
      await guard();
      return value;
    },
    async assignmentDelivery(
      requestValue: NativeAssignmentRequest,
      options: NativeAssignmentDeliveryOptions,
    ): Promise<NativeAssignmentDelivery> {
      syncGuard();
      await guard();
      const assignment = complete.state.assignment;
      if (!assignment) {
        fail("BODY.ASSIGNMENT_REQUIRED", "Нет explicit assignment intent");
      }
      if (!releaseValidated || releaseValidationFailed || validating) {
        fail(
          "BODY.ASSIGNMENT_VALIDATION_REQUIRED",
          "Требуется успешная текущая owner validation",
        );
      }
      const request = decode(
        NativeAssignmentRequestSchema,
        requestValue,
        "BODY.ASSIGNMENT_MEMBERSHIP",
      );
      if (
        !assignment.assessments.some((p) =>
          p.source === request.source && p.id === request.assessmentId
        )
      ) fail("BODY.ASSIGNMENT_MEMBERSHIP", "Composition вне выбранного intent");
      if (
        !options || Object.keys(options).some((k) =>
          !["projectPlans", "references"].includes(k)
        ) || !nativeArray(options.projectPlans) ||
        options.projectPlans.length > 4096
      ) {
        fail(
          "BODY.ASSIGNMENT_PROJECT_PLANS",
          "Нужны exact all-declaration student/full plans",
        );
      }
      const work = complete.releaseDocuments.find((row) =>
        row.source === request.source
      )?.early.release?.assessment;
      if (!work || work.id !== request.assessmentId) {
        fail(
          "BODY.ASSIGNMENT_MEMBERSHIP",
          "Нет actual selected canonical composition",
        );
      }
      const declared = declaredProjects();
      const key = options.projectPlans.map((p) =>
        [p.source, p.exerciseId, p.student?.id, p.full?.id].join(":")
      ).sort().join("\n");
      let saved = roleCache.get(key);
      const samePairs = saved &&
        saved.pairs.length === options.projectPlans.length &&
        saved.pairs.every((a) =>
          options.projectPlans.some((b) =>
            a.source === b.source && a.exerciseId === b.exerciseId &&
            a.student === b.student && a.full === b.full
          )
        );
      if (!samePairs) {
        const index = await assignmentRoleIndex({
          root: complete.state.root,
          profiles: catalog.identity.profiles,
          documents: complete.catalog.documents,
          declared: declared,
          pairs: options.projectPlans,
          resources: complete.resources.flatMap((row) => [
            ...row.sourceIdentities.map((identity) => ({
              path: row.source,
              identity,
            })),
            { path: row.source, identity: row.identity },
          ]),
          generation: generation,
        });
        saved = {
          pairs: options.projectPlans.map((pair) => ({ ...pair })),
          index,
        };
        roleCache.set(key, saved);
      }
      const roles = saved!.index;
      await roles.guard();
      const publicResource = (absolute: string) => {
        roles.assertPath(absolute);
        const local = relative(complete.state.root, absolute);
        if (
          !pathSchema.safeParse(local).success ||
          excluded(complete.state, absolute)
        ) {
          fail(
            "BODY.PRODUCER_DEPENDENCY_UNQUALIFIED",
            "Ресурс вне разрешённой области владельца " + absolute,
          );
        }
      };
      const referenceKey = options.references ?? noReferences;
      let refs = bodyCaches.get(referenceKey);
      if (!refs) {
        refs = {
          namespace: options.references?.namespace,
          resolve: options.references?.resolve,
          sourceUrl: options.references?.sourceUrl,
          cache: { questions: new Map(), introductions: new Map() },
        };
        bodyCaches.set(referenceKey, refs);
      }
      const referenceGuard = () => {
        if (
          options.references &&
          (refs!.namespace !== options.references.namespace ||
            refs!.resolve !== options.references.resolve ||
            refs!.sourceUrl !== options.references.sourceUrl)
        ) {
          fail(
            "BODY.REFERENCE_CONTEXT_CHANGED",
            "Body reference context изменён",
          );
        }
      };
      referenceGuard();
      const deliveryKey = request.source + "\0" + request.assessmentId + "\0" +
          key,
        cached = deliveryCache.get(deliveryKey);
      if (
        cached && cached.roles === roles && cached.references === referenceKey
      ) {
        await guard();
        return cached.delivery;
      }
      const built = await buildAssignmentBody({
        root: complete.state.root,
        owner: complete.releaseDocuments[0]!.early.release?.course.id ?? "",
        work: { source: request.source, composition: work },
        documents: complete.documents,
        references: options.references,
        cache: refs.cache,
        assertPublicResource: publicResource,
        assertCitationResource: citationResourceGuard(
          {
            root: complete.state.root,
            outputDirectory: complete.state.outputDirectory,
            cacheDirectory: assignment.runtime.environment.XDG_CACHE_HOME,
          },
          complete.documents,
          roles,
        ),
        readResource: async (source, target, documentSource) => {
          roles.assertPath(resolve(complete.state.root, source));
          const observed = complete.resources.find((row) =>
            row.source === source && row.documents.includes(documentSource)
          );
          if (!observed) {
            fail(
              "RESOURCE_UNQUALIFIED",
              "Нет resource witness owning native document",
            );
          }
          const file = (await resourceFiles(
            { files: [{ source, target }] },
            roles.assertIdentity,
          )).files[0]!;
          return {
            bytes: file.bytes,
            identity: observed.identity,
          };
        },
      });
      const conditionGuard = async () => {
        referenceGuard();
        if (!releaseValidated || releaseValidationFailed) {
          fail(
            "BODY.ASSIGNMENT_VALIDATION_REQUIRED",
            "Assignment validation утрачена",
          );
        }
        await guard();
        await roles.guard();
      };
      for (const condition of Object.values(built.conditions)) {
        immutable(condition);
        const pair = roles.plans.get(
          condition.context.input + "\0" + condition.exerciseId,
        );
        bindAssignmentCondition(
          condition,
          pair ? [pair.student, pair.full] : [],
          roles.assertPath,
        );
        bindNativeValue(
          condition,
          complete.state.root,
          conditionGuard,
          async (source, target, assertIdentity) => {
            roles.assertPath(resolve(complete.state.root, source));
            if (
              !complete.resources.some((row) =>
                row.source === source &&
                row.documents.includes(condition.context.input)
              )
            ) {
              return undefined;
            }
            return (await resourceFiles(
              { files: [{ source, target }] },
              (identity) => {
                roles.assertIdentity(identity);
                assertIdentity?.(identity);
              },
            )).files[0]!.bytes;
          },
        );
      }
      const delivery = immutable({
        schema: "course-native-assignment-delivery-v1" as const,
        origin: { ...catalog.identity, assessments: assignment.assessments },
        assessment: { source: request.source, id: request.assessmentId },
        publicPackage: built.publicPackage,
        conditions: built.conditions,
      });
      await conditionGuard();
      deliveryCache.set(deliveryKey, {
        roles,
        references: referenceKey,
        delivery,
      });
      return delivery;
    },
    resourceFiles(value: NativeResourceRequest) {
      syncGuard();
      if (complete.state.assignment) {
        fail(
          "BODY.DELIVERY_ACCESS_REQUIRED",
          "Assignment resources требуют role-bound delivery",
        );
      }
      return resourceFiles(value);
    },
  });
}
