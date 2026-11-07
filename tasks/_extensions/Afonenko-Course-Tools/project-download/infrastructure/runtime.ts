import { createMetrics as __createMetrics } from "../observability/bridge.ts";
const __metrics = __createMetrics("project-download");
import { inspectOwnedRequests } from "../ownership.ts";
import {
  diagnostic,
  externalFailure,
  progress,
  reportProgress,
} from "../diagnostics.ts";
import { dirname, join, relative, resolve } from "stdlib/path";
import { configuration, RESOURCE_ID } from "../domain/config.ts";
import { publish } from "../application/publish.ts";
import {
  child,
  exists,
  noSymlinks,
  resourceFiles,
  resourcePaths,
} from "./files.ts";
import { sibling } from "./siblings.ts";
import type {
  NativePublication,
  ProjectContractContext,
  ProjectPlan,
  SiblingModules,
} from "./siblings.ts";
const manifestName = ".project-download-manifest.json";
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function outputDirectory(config: Record<string, unknown>): string {
  const output = record(config.project) ? config.project["output-dir"] : undefined;
  return typeof output === "string" ? output : ".";
}
async function inspect(root: string) {
  const executable = Deno.env.get("QUARTO") ||
    Deno.env.get("QUARTO_BIN_PATH") &&
      join(Deno.env.get("QUARTO_BIN_PATH")!, "quarto") ||
    "quarto";
  let result: Deno.CommandOutput;
  try {
    result = await new Deno.Command(executable, {
      args: ["inspect", root],
      cwd: root,
      env: __metrics.childEnv({}),
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (cause) {
    if (!Object.values(Deno.errors).some((kind) => cause instanceof kind)) {
      throw cause;
    }
    throw externalFailure(executable, undefined, cause);
  }
  if (!result.success) throw externalFailure(executable, result);
  if (result.stderr.length) await Deno.stderr.write(result.stderr);
  const value: unknown = JSON.parse(new TextDecoder().decode(result.stdout));
  if (
    !record(value) || !record(value.config) || !record(value.files) ||
    !Array.isArray(value.files.input) ||
    !value.files.input.every((path): path is string =>
      typeof path === "string"
    ) ||
    !Array.isArray(value.files.config) ||
    !value.files.config.every((path): path is string =>
      typeof path === "string"
    ) ||
    !Array.isArray(value.files.configResources) ||
    !value.files.configResources.every((path): path is string =>
      typeof path === "string"
    )
  ) {
    throw diagnostic(
      "DOWNLOAD.CONFIG_INVALID",
      "Неполный результат Quarto inspect",
      {
        source: root,
        field: "config/files.input/config/configResources",
      },
    );
  }
  return {
    config: value.config,
    files: {
      input: value.files.input,
      config: value.files.config,
      configResources: value.files.configResources,
    },
  };
}
function archiveName(name: string): boolean {
  return name.endsWith(".zip") && RESOURCE_ID.test(name.slice(0, -4));
}
export const clearOwned = __metrics.wrapAsync({
  id: "project-download.infrastructure.runtime.clearOwned",
  kind: "io",
}, async function clearOwned(root: string, output: string): Promise<void> {
  const outputRoot = resolve(root, output);
  const directory = child(outputRoot, "_downloads");
  if (!await exists(directory)) return;
  if ((await Deno.lstat(outputRoot)).isSymlink) {
    throw diagnostic(
      "DOWNLOAD.PATH_INVALID",
      "Каталог вывода не должен быть символической ссылкой",
      { source: outputRoot, field: "output-dir" },
    );
  }
  await noSymlinks(outputRoot, directory);
  const manifest = join(directory, manifestName);
  if (!await exists(manifest)) return;
  await noSymlinks(outputRoot, manifest);
  const files: unknown = JSON.parse(await Deno.readTextFile(manifest));
  if (
    !Array.isArray(files) ||
    !files.every((name): name is string => typeof name === "string" && archiveName(name))
  ) {
    throw diagnostic(
      "DOWNLOAD.REQUEST_INVALID",
      "Повреждён перечень файлов project-download",
      { source: manifest, field: "manifest" },
    );
  }
  for (const name of files) {
    const path = join(directory, name);
    if (await exists(path)) {
      await noSymlinks(outputRoot, path);
      await Deno.remove(path);
    }
  }
  await Deno.remove(manifest);
});
/** Удаляет только временные заявки перед новым render. */
export const resetDownloadRequests = __metrics.wrapAsync({
  id: "project-download.infrastructure.runtime.resetDownloadRequests",
  kind: "io",
}, async function resetDownloadRequests(root: string): Promise<void> {
  const requests = child(root, "_generated/project-download/requests");
  if (await exists(requests)) {
    await noSymlinks(root, requests);
    await Deno.remove(requests, { recursive: true });
  }
});
/** Адреса и содержимое выдачи; Native context принадлежит Core. */
export interface NativeDownloadOptions {
  destinationDirectory?: string | undefined;
  baseUrl?: string | undefined;
  catalogBaseUrl?: string | undefined;
  referenceCatalog?: unknown;
  submission?: Parameters<SiblingModules["course-core"]["materializeProject"]>[2]["submission"];
}
export interface OrdinaryDownloadOptions {
  destinationDirectory?: string | undefined;
  profiles?: string[] | undefined;
  outputDirectory?: string | undefined;
}
export interface PreparedDownloads {
  publish(): Promise<number>;
  discard(): Promise<void>;
}
async function inputFiles(root: string) {
  const file = Deno.env.get("QUARTO_USE_FILE_FOR_PROJECT_INPUT_FILES");
  return (file
    ? await Deno.readTextFile(file)
    : Deno.env.get("QUARTO_PROJECT_INPUT_FILES") || "").split(/\r?\n/).filter(
      Boolean,
    ).map((path) => relative(root, resolve(root, path)).replaceAll("\\", "/"));
}
export const finish = __metrics.wrapAsync({
  id: "project-download.infrastructure.runtime.finish",
  kind: "io",
}, async function finish(
  root: string,
  options: OrdinaryDownloadOptions = {},
): Promise<number> {
  return await progress(`Финализация материалов: ${root}`, async () => {
    const count = await finishInternal(root, options);
    reportProgress(`Финализация материалов — archives=${count}`);
    return count;
  });
});
/** Все Core-bound helpers завершаются до возврата Download-owned draft. */
export async function prepareNativeDownloads(
  publication: NativePublication,
  options: NativeDownloadOptions = {},
): Promise<PreparedDownloads> {
  const Core = await progress("Подключение Core", () => sibling("course-core"));
  return await prepareDownloadsInternal(publication.root, options,
    [...publication.identity.profiles], publication.outputDirectory, { publication, Core });
}
async function finishInternal(root: string, options: OrdinaryDownloadOptions): Promise<number> {
  const draft = await prepareDownloadsInternal(root, options,
    options.profiles ?? (Deno.env.get("QUARTO_PROFILE") || "").split(",").filter(Boolean),
    options.outputDirectory || Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR"));
  try {
    return await draft.publish();
  } catch (cause) {
    try { await draft.discard(); } catch { /* Исходная ошибка публикации важнее cleanup. */ }
    throw cause;
  }
}
async function prepareDownloadsInternal(
  root: string,
  options: NativeDownloadOptions,
  profiles: string[],
  sourceOutput?: string,
  current?: { publication: NativePublication; Core: SiblingModules["course-core"] },
): Promise<PreparedDownloads> {
  let archives: { name: string; bytes: Uint8Array }[] = [];
  let resolvedOutput = sourceOutput;
  const collect = async (): Promise<number> => {
    const operation = current?.publication;
    let sources: string[] = [];
    let inspected: Awaited<ReturnType<typeof inspect>> | undefined;
    await progress("Чтение проекта", async () => {
      sources = operation?.catalog.documents.map((d) => d.source) ??
        await inputFiles(root);
      // Standalone без native hook env сохраняет обычный independent сценарий.
      if (!operation) {
        inspected = await inspect(root);
        sources = inspected.files.input.map((path: string) =>
          relative(root, path).replaceAll("\\", "/")
        );
        resolvedOutput ||= outputDirectory(inspected.config);
      }
    });
    const authoredInputs = new Set<string>(
      sources.map((source: string) => resolve(root, source)),
    );
    if (inspected) {
      for (const path of inspected.files.config) authoredInputs.add(resolve(root, path));
      // configResources включает и публичные metadata resources; это не author-only список.
      // Берём из него только готовые пути явно подключённых filters.
      for (const declaration of Array.isArray(inspected.config.filters)
        ? inspected.config.filters : inspected.config.filters ? [inspected.config.filters] : []) {
        const path = typeof declaration === "string" ? declaration
          : record(declaration) ? declaration.path : undefined;
        if (typeof path === "string") {
          const absolute = resolve(root, path);
          if (inspected.files.configResources.includes(absolute)) authoredInputs.add(absolute);
        }
      }
      // inspect даёт готовые пути filters, но hook оставляет строкой команды.
      // Прежнее извлечение путей нужно только для запрета hook-исходников в ZIP.
      for (
        const value of [
          record(inspected.config.project)
            ? inspected.config.project["pre-render"]
            : undefined,
          record(inspected.config.project)
            ? inspected.config.project["post-render"]
            : undefined,
        ]
      ) {
        for (
          const declaration of Array.isArray(value)
            ? value
            : value
            ? [value]
            : []
        ) {
          // Native hook schema: string или string[], не filter declaration.path.
          if (typeof declaration !== "string") continue;
          const paths = [
            declaration,
            ...(declaration.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((token) =>
              token.replace(/^["']|["']$/g, "")
            ),
          ];
          for (const path of paths) {
            if (await exists(resolve(root, path))) {
              authoredInputs.add(resolve(root, path));
            }
          }
        }
      }
    }
    const owned = await progress("Чтение заявок", () => inspectOwnedRequests(root, sources));
    const requests = owned.files;
    const configs = requests.map((request) =>
      configuration(
        request.configuration ?? inspected?.config["project-download"],
      )
    );
    const config = configuration({
      resources: {},
      "course-model": configs.some((c) => c["course-model"]),
    });
    for (const item of configs) {
      for (const [id, resource] of Object.entries(item.resources)) {
        if (
          config.resources[id] &&
          JSON.stringify(config.resources[id]) !== JSON.stringify(resource)
        ) {
          throw diagnostic(
            "DOWNLOAD.REQUEST_INVALID",
            "Несогласованные native resource declarations",
            { id, field: "resources" },
          );
        }
        config.resources[id] = resource;
      }
    }
    const artifacts = requests.flatMap((request) =>
      (request.artifacts ?? []).map((artifact) => ({
        ...artifact,
        source: request.source,
      }))
    );
    const authorStarter = operation?.identity.projection === "author"
      ? artifacts.find((request) => request.kind === "starter")
      : undefined;
    if (authorStarter) {
      throw diagnostic(
        "DOWNLOAD.STARTER_UNQUALIFIED",
        "Заготовка требует настоящую student-проекцию; author condition не даёт student inventory",
        {
          source: authorStarter.source,
          id: authorStarter.exerciseId,
          field: "kind",
        },
      );
    }
    const contexts = new Map<string, ProjectContractContext>(),
      plans = new Map<string, ProjectPlan>();
    const pack = async () =>
      await publish(config, profiles, {
        requests: () => Promise.resolve(requests),
        courseResource: (id, source) => {
          return Promise.reject(diagnostic(
            "DOWNLOAD.REQUEST_INVALID",
            "Учебный проект требует typed artifact request",
            { id, source, field: "artifacts" },
          ));
        },
        async modelArtifact(request, source) {
          if (!current) {
            throw diagnostic(
              "DOWNLOAD.CONFIG_INVALID",
              "Модельный комплект требует текущую публичную операцию Core",
              { source, field: "course-model" },
            );
          }
          const { publication: operation, Core } = current;
          if (
            !configs[requests.findIndex((r) => r.source === source)]
              ?.["course-model"]
          ) {
            throw diagnostic(
              "DOWNLOAD.CONFIG_INVALID",
              "Модельный комплект не включён в native документе",
              { source },
            );
          }
          const document = operation.document({ source }),
            declaration = document.definitions[request.exerciseId];
          const condition = operation.condition({
            source,
            exerciseId: request.exerciseId,
            view: operation.identity.projection,
          });
          if (
            request.kind === "full" &&
            operation.identity.projection === "student" &&
            !(declaration?.["course-role"] === "demonstration" &&
              declaration?.["statement-visibility"] === "open" &&
              document.hasPublicSolution[request.exerciseId])
          ) {
            throw diagnostic(
              "DOWNLOAD.FULL_UNQUALIFIED",
              "Full artifact в student требует открытой demonstration с фактическим публичным решением; actual full projection ждёт Core owner",
              { source, id: request.exerciseId, field: "kind" },
            );
          }
          // Core строит catalog из тех же visible occurrences: успешные
          // document/condition выше уже установили наличие source и exercise.
          const catalogDocument = operation.catalog.documents.find((d) =>
            d.source === source
          )!;
          const exercise = catalogDocument.exercises.find((e) =>
            e.id === request.exerciseId
          )!;
          const context = contexts.get(
            catalogDocument.format + ":" + exercise?.project,
          );
          if (!context) {
            throw diagnostic(
              "DOWNLOAD.RESOURCE_UNAVAILABLE",
              "Нет публичного кодового project context",
              { source, id: request.exerciseId, field: "project" },
            );
          }
          const audience = request.kind === "full" ||
                operation.identity.projection === "author"
              ? "full"
              : "student",
            key = catalogDocument.format + ":" + exercise.project + ":" +
              audience;
          let plan = plans.get(key);
          if (!plan) {
            plan = await Core.planProject(context, { audience });
            plans.set(key, plan);
          }
          const QRC = await sibling("reference-catalog");
          const baseUrl = options.baseUrl ||
            Deno.env.get("COURSE_SITE_PUBLICATION_BASE") || configs.find((c) =>
              c["base-url"]
            )?.["base-url"];
          if (!baseUrl) {
            throw diagnostic(
              "DOWNLOAD.PUBLICATION_REQUIRED",
              "Модельному README нужен конечный base-url",
              { source, field: "base-url" },
            );
          }
          const closure = await Core.materializationClosure(
            plan,
            condition,
          );
          const destination = {
            catalog: options.referenceCatalog ??
              {
                schema: "quarto-reference-catalog",
                generator: { quarto: "1.11.5" },
                targets: {},
              },
            baseUrl,
            ...(options.catalogBaseUrl === undefined ? {} : { catalogBaseUrl: options.catalogBaseUrl }),
            sources: Object.fromEntries(
              operation.catalog.documents.map((d) => [d.source, d.output]),
            ),
          };
          const linksBySource: Record<string, Record<string, string>> = {};
          const referencesBySource: Record<
            string,
            Record<string, { href: string; label: string }>
          > = {};
          const references = QRC.createBodyLinks({
            ...destination,
            baseUrl: destination.catalogBaseUrl ?? baseUrl,
          });
          for (const fragment of closure.fragments) {
            const urls: Record<string, string> = {},
              resourceLinks: string[] = [];
            for (const link of fragment.links) {
              const [pathname = ""] = link.split(/[?#]/);
              const target = pathname.split("/").pop();
              if (
                artifacts.some((a) =>
                  a.exerciseId + "-" + a.kind + ".zip" === target
                ) || Object.keys(config.resources).some((id) =>
                  id + ".zip" === target
                )
              ) {
                urls[link] = "_downloads/" + target +
                  (link.match(/[?#].*$/)?.[0] ?? "");
              } else if (
                !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link) &&
                !/\.(?:qmd|html)(?:[?#]|$)/i.test(link)
              ) resourceLinks.push(link);
            }
            const refs = Object.fromEntries(
              fragment.references.map((
                r,
              ) => [r.token, { key: r.key, style: r.style }]),
            );
            linksBySource[fragment.source] = QRC.bindConditionLinks({
              context: { input: fragment.source },
              links: fragment.links,
            }, { ...destination, urls, resourceLinks, references: refs });
            referencesBySource[fragment.source] = Object.fromEntries(
              fragment.references.map((
                r,
              ) => [
                r.token,
                references.resolve(r.key, r.style, fragment.source),
              ]),
            );
          }
          const materialize = request.kind === "conditions"
            ? Core.materializeCondition
            : Core.materializeProject;
          const artifact = await materialize(plan, condition, {
            linksBySource,
            referencesBySource,
            submission: options.submission ??
              {
                files: [],
                instructions:
                  "Сдайте исходники способом, указанным преподавателем.",
              },
          });
          const { packageArtifact } = await import(
            "../application/package-artifact.ts"
          );
          return {
            kind: request.kind,
            files: artifact.files.map((f) => ({
              name: f.target,
              bytes: f.bytes,
            })),
            package: () => packageArtifact(artifact),
          };
        },
        async files(resource) {
          if (operation) {
            const selected = await resourcePaths(root, resource);
            const resources = await operation.resourceFiles({
              files: selected.map((f) => ({
                source: f.source,
                target: f.name,
              })),
            });
            return resources.files.map((f) => ({
              name: f.target,
              bytes: f.bytes,
            }));
          }
          const files = await resourceFiles(root, resource);
          for (const file of files) {
            const path = join(resource.path.replace(/^\//, ""), file.name);
            if (
              /(^|\/)(?:\.[^/]+|_extensions|_freeze|_generated|reference|solutions?|tests|closed-tests)(\/|$)/
                .test(path) ||
              /\.(?:qmd|rmd|ipynb)$/i.test(path) ||
              /(^|\/)(?:_quarto(?:[-.][^/]*)?|_metadata\.ya?ml)$/i.test(path) ||
              authoredInputs.has(resolve(root, path))
            ) {
              throw diagnostic(
                "RESOURCE.PRIVATE_OR_SOURCE",
                "Ресурс содержит закрытый материал или авторский исходник",
                { source: path, field: "resources" },
              );
            }
          }
          return files;
        },
        async save(value) {
          // publish передаёт созданные им ZIP; внешнего владельца bytes здесь нет.
          archives = value;
        },
      });
    if (!operation) return await pack();
    const projectRequests = new Map<string, Set<string>>();
    for (const artifact of artifacts) {
      const doc = operation.catalog.documents.find((d) =>
        d.source === artifact.source
      );
      if (doc) {
        for (
          const exercise of doc.exercises.filter((e) =>
            e.id === artifact.exerciseId
          )
        ) {
          if (exercise.project) {
            let inputs = projectRequests.get(doc.format);
            if (!inputs) {
              inputs = new Set();
              projectRequests.set(doc.format, inputs);
            }
            inputs.add(exercise.project);
          }
        }
      }
    }
    if (projectRequests.size) {
      return await operation.withProjectContracts(
        [...projectRequests].map(([format, inputs]) => ({
          owner: root,
          directories: [...inputs],
          profiles,
          format,
        })),
        async (batch) => {
          for (const group of batch.groups) {
            for (const context of group.contexts) {
              contexts.set(
                context.format + ":" +
                  relative(root, context.input).replaceAll("\\", "/"),
                context,
              );
            }
          }
          return await pack();
        },
      );
    }
    return await pack();
  };
  const count = await progress("Подготовка загрузок", collect);
  return preparedDownloads(root, options.destinationDirectory || resolvedOutput!,
    archives, count);
}
/** Замыкание draft содержит только Download-owned данные, без borrowed Core/PL. */
function preparedDownloads(
  root: string,
  output: string,
  archives: { name: string; bytes: Uint8Array }[],
  count: number,
): PreparedDownloads {
  let state: "prepared" | "publishing" | "published" | "failed" | "discarded" = "prepared";
  const invalid = () => diagnostic("DOWNLOAD.REQUEST_INVALID",
    `Черновик загрузок уже использован: ${state}`, { source: root, field: "draft" });
  return {
    async publish() {
      if (state !== "prepared") throw invalid();
      state = "publishing";
      try {
        await publishArchives(root, output, archives);
        state = "published";
        archives = [];
        return count;
      } catch (cause) {
        state = "failed";
        throw cause;
      }
    },
    async discard() {
      if (state === "publishing") throw invalid();
      if (state === "prepared") state = "discarded";
      archives = [];
    },
  };
}
async function publishArchives(
  root: string,
  output: string,
  archives: { name: string; bytes: Uint8Array }[],
) {
  return await progress("Запись файлов", async () => {
    let existingParent = resolve(root, output);
    while (!await exists(existingParent)) {
      existingParent = dirname(existingParent);
    }
    await noSymlinks("/", existingParent);
    await clearOwned(root, output);
    if (!archives.length) {
      reportProgress("Запись файлов — files=0/0");
      return;
    }
    const outputRoot = resolve(root, output);
    const directory = child(outputRoot, "_downloads");
    if (
      await exists(outputRoot) && (await Deno.lstat(outputRoot)).isSymlink
    ) {
      throw diagnostic(
        "DOWNLOAD.PATH_INVALID",
        "Каталог вывода не должен быть символической ссылкой",
        { source: outputRoot, field: "output-dir" },
      );
    }
    await Deno.mkdir(directory, { recursive: true });
    if ((await Deno.lstat(outputRoot)).isSymlink) {
      throw diagnostic(
        "DOWNLOAD.PATH_INVALID",
        "Каталог вывода не должен быть символической ссылкой",
        { source: outputRoot, field: "output-dir" },
      );
    }
    await noSymlinks("/", outputRoot);
    await noSymlinks(outputRoot, directory);
    // Нельзя перезаписывать файл, которым это расширение не владело.
    for (const archive of archives) {
      if (await exists(join(directory, archive.name))) {
        throw diagnostic(
          "DOWNLOAD.OUTPUT_CONFLICT",
          `Посторонний файл мешает публикации архива: ${archive.name}`,
          {
            source: join(directory, archive.name),
            id: archive.name,
            field: "output",
            hint: "Выберите свободный путь или переместите посторонний архив.",
          },
        );
      }
    }
    // Манифест записывается первым: следующая сборка очистит и прерванную запись.
    await Deno.writeTextFile(
      join(directory, manifestName),
      JSON.stringify(archives.map((item) => item.name)) + "\n",
    );
    let files = 0;
    for (const archive of archives) {
      await Deno.writeFile(join(directory, archive.name), archive.bytes, {
        createNew: true,
      });
      reportProgress(`Запись файлов — files=${++files}/${archives.length}`);
    }
  });
}
