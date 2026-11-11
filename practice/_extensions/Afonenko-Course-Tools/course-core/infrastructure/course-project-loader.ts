function yamlDocument(
  value: unknown,
): value is { errors: unknown[]; toJS(): unknown } {
  return record(value) && Array.isArray(value.errors) &&
    typeof value.toJS === "function";
}
import { dirname, isAbsolute, join, relative, resolve } from "stdlib/path";
import { parseDocument } from "../body-export/vendor/libraries.js";
import {
  boundInput,
  decodeProjectValue,
  fail,
  ProjectAddressSchema,
} from "../contracts/project.ts";
import type { ProjectContract } from "../contracts/project.ts";
import { toolCachePath } from "./tool-cache.ts";

export type ProjectLoaderMetrics = {
  yamlFileReads: number;
  yamlBytesRead: number;
  directoryLayers: number;
  sourceFileReads: number;
  sourceBytesRead: number;
};
export const emptyProjectMetrics = (): ProjectLoaderMetrics => ({
  yamlFileReads: 0,
  yamlBytesRead: 0,
  directoryLayers: 0,
  sourceFileReads: 0,
  sourceBytesRead: 0,
});
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function assertInside(owner: string, path: string): void {
  const rel = relative(owner, path);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) {
    fail("CONTEXT_PATH", "Путь выходит из owner", path);
  }
  if (toolCachePath(owner, path)) {
    fail("CONTEXT_CACHE", "Tool cache не является предметным input", path);
  }
}
/** Слияние только namespace; адрес path/base заменяется как одно значение. */
function merge(
  base: unknown,
  overlay: unknown,
  field: readonly string[] = [],
): unknown {
  if (!record(base) || !record(overlay)) return structuredClone(overlay);
  const result = { ...base };
  const address = field.length === 1 && field[0] === "starter" ||
    field.length === 2 &&
      ["components", "testsets", "solutions", "instructions"].includes(
        field[0] ?? "",
      ) ||
    field.length === 3 && field[0] === "build" && field[1] === "files";
  if (
    address &&
    (Object.hasOwn(overlay, "path") || Object.hasOwn(overlay, "base"))
  ) {
    delete result.path;
    delete result.base;
  }
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = Object.hasOwn(result, key)
      ? merge(result[key], value, [...field, key])
      : structuredClone(value);
  }
  return result;
}
function addresses(
  contract: Record<string, unknown>,
  use: (address: Record<string, unknown>) => void,
) {
  const node = (value: unknown) => {
    if (record(value)) use(value);
  };
  node(contract.starter);
  for (const key of ["components", "testsets", "solutions", "instructions"]) {
    const map = contract[key];
    if (record(map)) { for (const value of Object.values(map)) node(value); }
  }
  if (record(contract.build) && record(contract.build.files)) {
    for (const value of Object.values(contract.build.files)) node(value);
  }
}
export function projectPathEntries(
  contract: ProjectContract,
): { field: string; path: string }[] {
  const rows: { field: string; path: string }[] = [];
  if (contract.starter) {
    rows.push({ field: "starter.path", path: contract.starter.path });
  }
  for (const key of ["components", "testsets", "solutions"] as const) {
    for (const [name, address] of Object.entries(contract[key])) {
      rows.push({ field: `${key}.${name}.path`, path: address.path });
    }
  }
  for (const [name, address] of Object.entries(contract.instructions ?? {})) {
    if (address) {
      rows.push({ field: `instructions.${name}.path`, path: address.path });
    }
  }
  for (const [target, address] of Object.entries(contract.build.files)) {
    rows.push({ field: `build.files.${target}`, path: address.path });
  }
  return rows;
}

/** Одна операция: каждый contributing YAML парсится один раз; наследование в памяти. */
export function projectLoader(
  owner: string,
  profiles: readonly string[],
  metrics: ProjectLoaderMetrics,
) {
  const yaml = new Map<string, Promise<Record<string, unknown>>>();
  const layers = new Map<string, Promise<unknown>>();
  const directories = new Map<string, Promise<unknown>>();
  const selected = new Map<string, Promise<string | undefined>>();
  async function regular(path: string) {
    assertInside(owner, path);
    const info = await Deno.lstat(path);
    if (!info.isFile || info.isSymlink || await Deno.realPath(path) !== path) {
      fail(
        "PROJECT_SOURCE",
        "Нужен обычный файл без символических ссылок",
        path,
      );
    }
  }
  function read(path: string) {
    let value = yaml.get(path);
    if (!value) {
      value = (async () => {
        await regular(path);
        const text = await Deno.readTextFile(path);
        metrics.yamlFileReads++;
        metrics.yamlBytesRead += new TextEncoder().encode(text).length;
        const document: unknown = parseDocument(text);
        if (!yamlDocument(document)) {
          fail("PROJECT_YAML", "Не удалось прочитать YAML", path);
        }
        if (document.errors.length) {
          const first: unknown = document.errors[0];
          fail(
            "PROJECT_YAML",
            record(first) && typeof first.message === "string"
              ? first.message
              : "Повреждённый YAML",
            path,
          );
        }
        const parsed: unknown = document.toJS();
        if (parsed === null) return {};
        if (!record(parsed)) fail("PROJECT_YAML", "Нужна карта YAML", path);
        // Проверяется namespace, а не чужие Quarto значения/теги.
        return parsed;
      })();
      yaml.set(path, value);
    }
    return value;
  }
  function find(base: string) {
    let value = selected.get(base);
    if (!value) {
      value = (async () => {
        for (const path of [base + ".yml", base + ".yaml"]) {
          try {
            await Deno.lstat(path);
            return path;
          } catch (e) {
            if (!(e instanceof Deno.errors.NotFound)) throw e;
          }
        }
        return undefined;
      })();
      selected.set(base, value);
    }
    return value;
  }
  function layer(
    path: string,
    format: string,
    includes: boolean,
    chain: readonly string[] = [],
  ): Promise<unknown> {
    if (chain.includes(path)) {
      fail(
        "PROJECT_INCLUDE_CYCLE",
        "Цикл metadata-files: " + [...chain, path].join(" → "),
        path,
      );
    }
    const key = path + "\0" + format + "\0" + includes;
    let value = layers.get(key);
    if (!value) {
      value = (async () => {
        const data = await read(path);
        const namespace = Object.hasOwn(data, "course-project")
          ? data["course-project"]
          : {};
        boundInput(namespace, path);
        const specific = record(data.format) && record(data.format[format])
          ? data.format[format]["course-project"]
          : undefined;
        // Обе декларации нормализуются отдельно: format override без base сбрасывает прежнюю базу.
        function normalize(value: unknown): unknown {
          const result = structuredClone(value);
          if (record(result)) {
            const normalized = new WeakSet<object>();
            addresses(result, (address) => {
              if (normalized.has(address)) return;
              normalized.add(address);
              if (
                !Object.hasOwn(address, "path") &&
                !Object.hasOwn(address, "base")
              ) return;
              const parsed = ProjectAddressSchema.safeParse({
                path: address.path,
                base: address.base,
              });
              if (!parsed.success || isAbsolute(parsed.data.path)) {
                fail(
                  "PROJECT_PATH",
                  "Нужен относительный {path, base?: config}",
                  path,
                );
              }
              if (parsed.data.base === "config") {
                address.path = resolve(dirname(path), parsed.data.path);
              }
              delete address.base;
            });
          }
          return result;
        }
        let result = normalize(namespace);
        if (specific !== undefined) {
          boundInput(specific, path);
          result = merge(result, normalize(specific));
        }
        if (includes) {
          const list: unknown[] = [];
          if (data["metadata-file"] !== undefined) {
            list.push(data["metadata-file"]);
          }
          if (data["metadata-files"] !== undefined) {
            if (!Array.isArray(data["metadata-files"])) {
              fail("PROJECT_INCLUDE", "Нужен список metadata-files", path);
            }
            const included: unknown[] = data["metadata-files"];
            list.push(...included);
          }
          for (const name of list) {
            if (
              typeof name !== "string" || !name || isAbsolute(name) ||
              /[\0\\]/.test(name)
            ) {
              fail(
                "PROJECT_INCLUDE",
                "Нужен относительный путь metadata-files",
                path,
              );
            }
            const included = resolve(dirname(path), name);
            assertInside(owner, included);
            result = merge(
              result,
              await layer(included, format, true, [...chain, path]),
            );
          }
        }
        return result;
      })();
      layers.set(key, value);
    }
    return value;
  }
  async function root(format: string) {
    let result: unknown = {};
    const config = await find(join(owner, "_quarto"));
    if (config) result = merge(result, await layer(config, format, true));
    for (const profile of [...profiles].reverse()) {
      const file = await find(join(owner, "_quarto-" + profile));
      if (file) result = merge(result, await layer(file, format, false));
    }
    for (
      const file of [
        join(owner, "_quarto.yml.local"),
        join(owner, "_quarto.yaml.local"),
      ]
    ) {
      try {
        await Deno.lstat(file);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) continue;
        throw e;
      }
      result = merge(result, await layer(file, format, false));
      break;
    }
    return result;
  }
  function inherited(directory: string, format: string): Promise<unknown> {
    const key = directory + "\0" + format;
    let result = directories.get(key);
    if (!result) {
      result = (async () => {
        assertInside(owner, directory);
        let value = directory === owner
          ? await root(format)
          : await inherited(dirname(directory), format);
        const file = await find(join(directory, "_metadata"));
        if (file) {
          metrics.directoryLayers++;
          value = merge(value, await layer(file, format, true));
        }
        return value;
      })();
      directories.set(key, result);
    }
    return result;
  }
  return async (
    directory: string,
    format: string,
  ): Promise<ProjectContract> => {
    const inheritedValue = structuredClone(await inherited(directory, format));
    if (record(inheritedValue)) {
      addresses(inheritedValue, (address) => {
        if (typeof address.path === "string") {
          address.path = resolve(directory, address.path);
        }
      });
    }
    const result = decodeProjectValue(inheritedValue, directory);
    for (const { field, path } of projectPathEntries(result)) {
      assertInside(owner, path);
      try {
        const info = await Deno.lstat(path);
        if (
          info.isSymlink || !(info.isFile || info.isDirectory) ||
          await Deno.realPath(path) !== path
        ) {
          fail(
            "PROJECT_SOURCE",
            "Путь должен быть обычным файлом/каталогом без символических ссылок",
            path,
            field,
          );
        }
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          fail(
            "PROJECT_PATH_MISSING",
            "Объявленный путь отсутствует",
            path,
            field,
          );
        }
        throw e;
      }
    }
    return result;
  };
}
