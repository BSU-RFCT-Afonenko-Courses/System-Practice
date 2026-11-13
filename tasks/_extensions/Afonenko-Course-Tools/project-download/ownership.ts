import { diagnostic } from "./diagnostics.ts";
import { dirname, relative, resolve } from "stdlib/path";
import type { ArtifactRequest } from "./application/publish.ts";
import { RESOURCE_ID } from "./domain/config.ts";
import { child, exists, noSymlinks } from "./infrastructure/files.ts";

/** Проверенные временные заявки после завершения нативного рендера. */
export interface OwnedRequestState {
  protocol: 1;
  root: string;
  directory: string;
  files: {
    path: string;
    source: string;
    resources: string[];
    artifacts?: ArtifactRequest[];
    configuration?: unknown;
  }[];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function resourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID.test(value);
}
function artifactKind(value: unknown): value is ArtifactRequest["kind"] {
  const kinds: readonly unknown[] = ["starter", "full", "conditions"];
  return kinds.includes(value);
}
function artifact(value: unknown): value is ArtifactRequest {
  return (
    record(value) &&
    !Object.keys(value).some((key) => !["exerciseId", "kind"].includes(key)) &&
    resourceId(value.exerciseId) &&
    artifactKind(value.kind)
  );
}

async function requestDirectory(
  root: string,
  sources: string[],
): Promise<{ directory: string; present: boolean }> {
  if (root !== resolve(root)) {
    throw diagnostic(
      "DOWNLOAD.REQUEST_INVALID",
      "Корень заявок должен быть каноническим абсолютным путём",
      { source: root, field: "root" },
    );
  }
  // lstat проверяет и dangling links; realPath не должен скрыть ссылку в корне/родителях.
  for (let current = root; ; current = dirname(current)) {
    const info = await Deno.lstat(current);
    if (info.isSymlink || !info.isDirectory) {
      throw diagnostic(
        "DOWNLOAD.REQUEST_INVALID",
        `Недопустимый каталог в пути корня заявок: ${current}`,
        { source: current, field: "root" },
      );
    }
    if (dirname(current) === current) break;
  }
  for (const source of sources) {
    if (
      !source ||
      source.includes("\\") ||
      /^[A-Za-z]:/.test(source) ||
      source
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      relative(root, child(root, source)) !== source
    ) {
      throw diagnostic(
        "DOWNLOAD.REQUEST_INVALID",
        `Источник заявки должен быть каноническим относительным путём: ${source}`,
        { source, field: "source" },
      );
    }
  }
  const directory = child(root, "_generated/project-download/requests");
  for (const path of [
    child(root, "_generated"),
    child(root, "_generated/project-download"),
    directory,
  ]) {
    if (!(await exists(path))) return { directory, present: false };
    const info = await Deno.lstat(path);
    if (info.isSymlink || !info.isDirectory) {
      throw diagnostic(
        "DOWNLOAD.REQUEST_INVALID",
        `Недопустимый каталог заявок: ${path}`,
        { source: path, field: "request" },
      );
    }
  }
  await noSymlinks(root, directory);
  return { directory, present: true };
}

/** Потребитель передаёт уже проверенные входные документы владельца. */
export async function inspectOwnedRequests(
  root: string,
  sources: string[],
): Promise<OwnedRequestState> {
  const { directory, present } = await requestDirectory(root, sources);
  const state: OwnedRequestState = { protocol: 1, root, directory, files: [] };
  if (!present) return state;
  const requests = new Map<string, string>();
  const directories = new Set<string>();
  for (const source of sources) {
    requests.set(child(directory, source + "/request.json"), source);
    for (
      let path = child(directory, source);
      path !== directory;
      path = dirname(path)
    ) {
      directories.add(path);
    }
  }
  const files: { path: string; source: string }[] = [];
  async function collect(current: string): Promise<void> {
    const entries = await Array.fromAsync(Deno.readDir(current));
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (current !== directory && !entries.length) {
      throw diagnostic("DOWNLOAD.REQUEST_INVALID", "Пустой каталог заявки", {
        source: current,
        field: "request",
      });
    }
    for (const entry of entries) {
      const path = child(current, entry.name),
        info = await Deno.lstat(path);
      const source = requests.get(path);
      if (
        info.isSymlink ||
        (!info.isDirectory && !info.isFile) ||
        (info.isDirectory ? !directories.has(path) : source === undefined)
      ) {
        throw diagnostic(
          "DOWNLOAD.REQUEST_INVALID",
          `Посторонний объект в области заявок: ${path}`,
          { source: path, field: "request" },
        );
      }
      if (info.isDirectory) await collect(path);
      else if (source !== undefined) files.push({ path, source });
    }
  }
  await collect(directory);
  for (const { path, source } of files) {
    await noSymlinks(root, path);
    const bytes = await Deno.readFile(path);
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch (cause) {
      throw diagnostic(
        "DOWNLOAD.REQUEST_INVALID",
        "Не удалось прочитать JSON заявки",
        { source: path, field: "request" },
        cause,
      );
    }
    if (!record(value)) {
      throw diagnostic(
        "DOWNLOAD.REQUEST_INVALID",
        `Повреждённая заявка: ${path}`,
        { source: path, field: "request" },
      );
    }
    const fields = value;
    if (
      Object.keys(fields).some(
        (key) =>
          ![
            "source",
            "resources",
            "artifacts",
            "courseProcessed",
            "configuration",
            "native",
          ].includes(key),
      ) ||
      (Object.hasOwn(fields, "native") && typeof fields.native !== "boolean") ||
      (Object.hasOwn(fields, "courseProcessed") &&
        typeof fields.courseProcessed !== "boolean") ||
      !Object.hasOwn(fields, "source") ||
      !Object.hasOwn(fields, "resources") ||
      typeof fields.source !== "string" ||
      fields.source !== source ||
      !Array.isArray(fields.resources) ||
      !fields.resources.every(resourceId)
    ) {
      throw diagnostic(
        "DOWNLOAD.REQUEST_INVALID",
        `Недопустимые поля заявки: ${path}`,
        { source: path, field: "request" },
      );
    }
    if (
      fields.artifacts !== undefined &&
      (!Array.isArray(fields.artifacts) || !fields.artifacts.every(artifact))
    ) {
      throw diagnostic(
        "DOWNLOAD.REQUEST_INVALID",
        "Недопустимые модельные заявки",
        { source: path, field: "artifacts" },
      );
    }
    state.files.push({
      path,
      source: fields.source,
      resources: fields.resources,
      ...(fields.artifacts ? { artifacts: fields.artifacts } : {}),
      ...(Object.hasOwn(fields, "configuration")
        ? { configuration: fields.configuration }
        : {}),
    });
  }
  return state;
}

/** Вызывать последовательно, когда нативный процесс уже завершился. */
export async function clearOwnedRequests(
  root: string,
  sources: string[],
): Promise<void> {
  const state = await inspectOwnedRequests(root, sources);
  if (!(await exists(state.directory))) return;
  const directories = new Set<string>();
  for (const file of state.files) {
    await Deno.remove(file.path);
    for (
      let path = dirname(file.path);
      path !== state.directory;
      path = dirname(path)
    ) {
      directories.add(path);
    }
  }
  // Удаление каталогов нерекурсивное: новая чужая запись не будет удалена.
  for (const path of [...directories].sort((a, b) => b.length - a.length)) {
    await Deno.remove(path);
  }
  await Deno.remove(state.directory);
}
