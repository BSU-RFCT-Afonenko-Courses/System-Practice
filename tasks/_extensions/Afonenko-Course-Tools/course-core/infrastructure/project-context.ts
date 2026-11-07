import { createMetrics as __createMetrics } from "../observability/bridge.ts";
import { isAbsolute, join, relative, resolve } from "stdlib/path";
import { decodeProjectRequests, fail } from "../contracts/project.ts";
import type {
  ProjectContext,
  ProjectContextRequest,
  ProjectContract,
} from "../contracts/project.ts";
import {
  assertInside,
  emptyProjectMetrics,
  projectLoader,
} from "./course-project-loader.ts";
import type { ProjectLoaderMetrics } from "./course-project-loader.ts";
export type {
  ProjectContext,
  ProjectContextRequest,
  ProjectContextView,
  ProjectContract,
  ProjectContractContext,
} from "../contracts/project.ts";

// Private binding ограничивает lifetime callbacks, а не доказывает неизменность source.
type State = {
  active: boolean;
  owner: string;
  metrics: ProjectLoaderMetrics;
  operation?: { generation: object; sync: () => void } | undefined;
};
const states = new WeakMap<object, State>();
function state(context: unknown): State {
  const value = context && typeof context === "object"
    ? states.get(context)
    : undefined;
  if (!value?.active) fail("CONTEXT_EXPIRED", "Чужой или завершённый контекст");
  value.operation?.sync();
  return value;
}
export async function assertProjectContext(context: unknown): Promise<void> {
  state(context);
}
export function decodeProjectContract(
  context: ProjectContext,
): ProjectContract {
  state(context);
  return context.contract;
}
export type ProjectContextGroup = {
  contexts: readonly ProjectContext[];
  readonly metrics: Readonly<ProjectLoaderMetrics>;
};
export async function readProjectContexts<T>(
  requests: readonly ProjectContextRequest[],
  use: (groups: readonly ProjectContextGroup[]) => Promise<T>,
): Promise<T> {
  return await acquire(requests, use);
}
type OwnerLoader = {
  profiles: string[];
  load: ReturnType<typeof projectLoader>;
  metrics: ProjectLoaderMetrics;
};
async function acquire<T>(
  requests: readonly ProjectContextRequest[],
  use: (groups: readonly ProjectContextGroup[]) => Promise<T>,
  operation?: State["operation"],
  cache = new Map<string, OwnerLoader>(),
): Promise<T> {
  const corePhaseAction = async function acquirePhase(): Promise<T> {
    const decoded = decodeProjectRequests(requests);
    const owners = new Map<
      string,
      OwnerLoader & { state: State; before: ProjectLoaderMetrics }
    >();
    const groups: ProjectContextGroup[] = [];
    const keys = new Set<string>();
    try {
      for (const request of decoded) {
        operation?.sync();
        const { owner, profiles, format } = request;
        if (
          resolve(owner) !== owner || await Deno.realPath(owner) !== owner ||
          new Set(profiles).size !== profiles.length
        ) {
          fail(
            "CONTEXT_REQUEST",
            "Нужны canonical owner и unique selected profiles",
            owner,
          );
        }
        let selected = owners.get(owner);
        if (!selected) {
          let loader = cache.get(owner);
          if (
            loader && JSON.stringify(loader.profiles) !== JSON.stringify(profiles)
          ) {
            fail("CONTEXT_REQUEST", "Другие profiles в той же операции", owner);
          }
          if (!loader) {
            const metrics = emptyProjectMetrics();
            loader = {
              profiles,
              metrics,
              load: projectLoader(owner, profiles, metrics),
            };
            cache.set(owner, loader);
          }
          selected = {
            ...loader,
            before: { ...loader.metrics },
            state: { active: true, owner, metrics: loader.metrics, operation },
          };
          owners.set(owner, selected);
        } else if (
          JSON.stringify(selected.profiles) !== JSON.stringify(profiles)
        ) {
          fail(
            "CONTEXT_REQUEST",
            "Один owner должен иметь одинаковые selected profiles",
            owner,
          );
        }
        const contexts: ProjectContext[] = [];
        for (const directory of request.directories) {
          if (isAbsolute(directory) || /[\0\\]/.test(directory)) {
            fail(
              "CONTEXT_REQUEST",
              "Нужен owner-relative code directory",
              directory,
            );
          }
          const path = resolve(owner, directory);
          assertInside(owner, path);
          const key = path + "\0" + format;
          if (keys.has(key)) {
            fail("CONTEXT_REQUEST", "Повторный code directory/format", path);
          }
          keys.add(key);
          if (
            !(await Deno.stat(path)).isDirectory ||
            await Deno.realPath(path) !== path
          ) {
            fail(
              "CONTEXT_INPUT",
              "Нужен code directory без символических ссылок",
              path,
            );
          }
          const contract = await selected.load(path, format);
          const context: ProjectContext = {
            owner,
            input: path,
            profiles: [...profiles],
            format,
            contract,
          };
          states.set(context, selected.state);
          contexts.push(context);
        }
        const current = selected.state, before = selected.before;
        groups.push({
          contexts,
          get metrics() {
            return {
              yamlFileReads: current.metrics.yamlFileReads - before.yamlFileReads,
              yamlBytesRead: current.metrics.yamlBytesRead - before.yamlBytesRead,
              directoryLayers: current.metrics.directoryLayers -
                before.directoryLayers,
              sourceFileReads: current.metrics.sourceFileReads -
                before.sourceFileReads,
              sourceBytesRead: current.metrics.sourceBytesRead -
                before.sourceBytesRead,
            };
          },
        });
      }
      return await use(groups);
    } finally {
      for (const selected of owners.values()) selected.state.active = false;
    }
  };
  return await __createMetrics("course-core").wrapAsync({
    id: "course-core.infrastructure.project-context.acquire",
    kind: "phase",
    origin: "manual",
  }, corePhaseAction)();
}
async function safeFile(
  context: ProjectContext,
  path: string,
): Promise<Deno.FileInfo> {
  const current = state(context);
  assertInside(current.owner, path);
  const info = await Deno.lstat(path);
  if (info.isSymlink || await Deno.realPath(path) !== path) {
    fail("PROJECT_SOURCE", "Символическая ссылка в source", path);
  }
  return info;
}
/** Только выбранное дерево; source не копируется и не фиксируется snapshot. */
export async function projectContextFiles(
  context: ProjectContext,
  base: string,
  onTreeWalk?: () => void,
): Promise<string[]> {
  if (!(await safeFile(context, base)).isDirectory) {
    fail("PROJECT_SOURCE", "Нужен source directory", base);
  }
  onTreeWalk?.();
  const paths: string[] = [];
  const visit = async (path: string) => {
    const info = await safeFile(context, path);
    if (info.isFile) paths.push(path);
    else if (info.isDirectory) {
      for await (const entry of Deno.readDir(path)) {
        await visit(join(path, entry.name));
      }
    } else fail("PROJECT_SOURCE", "Неподдержанный тип source entry", path);
  };
  await visit(base);
  return paths.sort();
}
export async function readProjectContextFile(
  context: ProjectContext,
  path: string,
): Promise<Uint8Array> {
  const current = state(context);
  if (!(await safeFile(context, path)).isFile) {
    fail("PROJECT_SOURCE", "Нужен обычный source file", path);
  }
  const bytes = await Deno.readFile(path);
  current.metrics.sourceFileReads++;
  current.metrics.sourceBytesRead += bytes.length;
  return bytes;
}
/** Функциональное наличие source для materializer, без captured-membership registry. */
export function projectFileExists(
  context: ProjectContext,
  path: string,
): boolean {
  const current = state(context);
  assertInside(current.owner, path);
  try {
    const info = Deno.lstatSync(path);
    return info.isFile && !info.isSymlink && Deno.realPathSync(path) === path;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
export function assertProjectContextGeneration(
  context: ProjectContext,
  generation: object,
): void {
  if (state(context).operation?.generation !== generation) {
    fail(
      "BODY.ASSIGNMENT_PROJECT_PLANS",
      "Контекст принадлежит другой операции",
    );
  }
}
/** Physical aliases проверяются по фактически выбранным roles, не по всему owner tree. */
export async function projectContextSourceIdentities(
  context: ProjectContext,
  onTreeWalk?: () => void,
): Promise<readonly { path: string; identity: string }[]> {
  state(context);
  const { projectPathEntries } = await import("./course-project-loader.ts");
  const files = new Set<string>();
  for (const { path } of projectPathEntries(context.contract)) {
    const info = await safeFile(context, path);
    if (info.isDirectory) {
      for (const file of await projectContextFiles(context, path, onTreeWalk)) {
        files.add(file);
      }
    } else if (info.isFile) files.add(path);
  }
  const rows = [];
  for (const path of files) {
    const info = await safeFile(context, path);
    rows.push({ path, identity: JSON.stringify([info.dev, info.ino]) });
  }
  return rows;
}
export type NativeOperationProjectContextMetrics = Readonly<
  ProjectLoaderMetrics
>;
export type NativeOperationProjectContextBatch = Readonly<{
  groups: readonly ProjectContextGroup[];
  metrics: NativeOperationProjectContextMetrics;
  checkpoint(): Promise<void>;
}>;
export function operationProjectContextReuse(
  source: {
    owner: string;
    profiles: readonly string[];
    generation: object;
    outputDirectory: string;
    sync: () => void;
  },
) {
  let running = false;
  const cache = new Map<string, OwnerLoader>();
  return async <T>(
    requests: readonly ProjectContextRequest[],
    use: (
      batch: Omit<NativeOperationProjectContextBatch, "checkpoint">,
    ) => Promise<T>,
  ): Promise<T> => {
    source.sync();
    if (
      running || requests.some((r) =>
        r.owner !== source.owner ||
        JSON.stringify(r.profiles) !== JSON.stringify(source.profiles)
      )
    ) fail("CONTEXT_REQUEST", "Active batch либо чужой owner/profiles");
    running = true;
    try {
      if (!requests.length) {
        return await use({ groups: [], metrics: emptyProjectMetrics() });
      }
      return await acquire(
        requests,
        async (groups) =>
          use({
            groups,
            get metrics() {
              return groups[0]!.metrics;
            },
          }),
        { generation: source.generation, sync: source.sync },
        cache,
      );
    } finally {
      running = false;
    }
  };
}
