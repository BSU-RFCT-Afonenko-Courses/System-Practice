import { withAssignmentA1Probe } from "../runtime/assignment-execution.ts";
import { quartoOutputNames } from "./generated-paths.ts";
import { toolCacheContainer, toolCachePath } from "./tool-cache.ts";
import { dirname, isAbsolute, join, relative, resolve } from "stdlib/path";
import { isAlias, parseDocument } from "../body-export/vendor/libraries.js";
import { command, quartoExecutable } from "./process.ts";
import { invocationIdentity } from "./common-path-binding.ts";
import {
  decodeProjectRequests,
  decodeProjectValue,
  fail,
  ProjectContextSchema,
} from "../contracts/project.ts";

const marker = "_course_core_origins_a1";
const namespace = "course-project";
const ignored = new Set([
  ...quartoOutputNames,
  ".git",
  ".quarto",
  "_generated",
  "node_modules",
]);
const stable = (v: unknown): string =>
  JSON.stringify(
    v,
    (_k, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
        : x,
  );
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const x of Object.values(value)) freeze(x);
    Object.freeze(value);
  }
  return value;
}
import type {
  NativeOrigin,
  ProjectContext,
  ProjectContextRequest,
} from "../contracts/project.ts";
export type {
  NativeOrigin,
  ProjectContext,
  ProjectContextRequest,
} from "../contracts/project.ts";
type Row = {
  path: string;
  signature: string;
  children?: string[];
  bytes?: Uint8Array;
};
type State = {
  active: boolean;
  rows: Map<string, Row>;
  relevant: Set<string>;
  metrics: {
    inspectCalls: number;
    fullWalks: number;
    fullFences: number;
    sourceBytesRead: number;
    sourceTreeHashes: number;
    toolHashReads: number;
  };
  owner: string;
  tool: string;
  version: string;
  invocation: string;
  localInvocation: string;
  bound?: {
    generation: object;
    sync: () => void;
    guard: (paths: readonly string[]) => Promise<void>;
    read: (path: string) => Promise<Uint8Array>;
  };
};
const states = new WeakMap<object, State>();
const signature = (s: Deno.FileInfo) =>
  stable({
    dev: s.dev,
    ino: s.ino,
    mode: s.mode,
    size: s.isFile ? s.size : undefined,
    mtime: s.isFile ? s.mtime?.getTime() : undefined,
    ctime: s.isFile ? s.ctime?.getTime() : undefined,
    file: s.isFile,
    dir: s.isDirectory,
    link: s.isSymlink,
  });
function inside(root: string, path: string) {
  const r = relative(root, path);
  if (isAbsolute(r) || r === ".." || r.startsWith("../")) {
    fail("CONTEXT_PATH", "Путь выходит из owner", path);
  }
  return r;
}
async function inspect(path: string, profiles: string[], state: State) {
  state.metrics.inspectCalls++;
  return JSON.parse(
    await command(
      state.tool,
      [
        "inspect",
        path,
        ...(profiles.length ? ["--profile", profiles.join(",")] : []),
      ],
      state.owner,
      { QUARTO_PROFILE: profiles.join(",") },
    ),
  );
}
async function copyOwner(root: string, destination: string, state: State) {
  state.metrics.fullWalks++;
  async function visit(path: string) {
    const info = await Deno.lstat(path);
    if (info.isSymlink || !(info.isFile || info.isDirectory)) {
      fail("CONTEXT_ENTRY", "Непроверенный тип source entry", path);
    }
    const target = join(destination, inside(root, path)),
      row: Row = { path, signature: signature(info) };
    if (info.isDirectory) {
      await Deno.mkdir(target, { recursive: true });
      row.children = [];
      for await (const entry of Deno.readDir(path)) {
        if (
          !ignored.has(entry.name) &&
          !toolCachePath(state.owner, join(path, entry.name))
        ) row.children.push(entry.name);
      }
      row.children.sort();
      state.rows.set(path, row);
      for (const child of row.children) await visit(join(path, child));
    } else {
      row.bytes = await Deno.readFile(path);
      state.metrics.sourceBytesRead += row.bytes.length;
      await Deno.writeFile(target, row.bytes);
      state.rows.set(path, row);
      if (signature(await Deno.lstat(path)) !== row.signature) {
        fail("CONTEXT_CHANGED", "Source изменён во время чтения", path);
      }
    }
  }
  await visit(root);
}
async function checkRow(row: Row, owner: string) {
  let current: Deno.FileInfo;
  try {
    current = await Deno.lstat(row.path);
  } catch {
    fail("CONTEXT_CHANGED", "Source исчез", row.path);
  }
  if (signature(current!) !== row.signature) {
    fail("CONTEXT_CHANGED", "Source identity/bytes изменены", row.path);
  }
  if (row.children) {
    const names = [];
    for await (const entry of Deno.readDir(row.path)) {
      if (
        ignored.has(entry.name) ||
        toolCachePath(owner, join(row.path, entry.name))
      ) continue;
      if (
        !row.children.includes(entry.name) &&
        await toolCacheContainer(owner, join(row.path, entry.name))
      ) continue;
      names.push(entry.name);
    }
    if (stable(names.sort()) !== stable(row.children)) {
      fail("CONTEXT_CHANGED", "Изменён состав файлов", row.path);
    }
  }
}
async function checkState(state: State, full: boolean) {
  if (!state.active) fail("CONTEXT_EXPIRED", "Контекст операции завершён");
  if (state.bound) {
    if (full) state.metrics.fullFences++;
    await state.bound.guard([...state.relevant]);
    return;
  }
  if (
    await invocationIdentity(state.owner, full) !==
      (full ? state.invocation : state.localInvocation)
  ) fail("CONTEXT_CHANGED", "Изменён native executable/environment");
  if (quartoExecutable() !== state.tool) {
    fail("CONTEXT_CHANGED", "Изменён Quarto executable");
  }
  if (full) {
    state.metrics.fullFences++;
    state.metrics.toolHashReads++;
  }
  for (const path of full ? state.rows.keys() : state.relevant) {
    const row = state.rows.get(path);
    if (row) await checkRow(row, state.owner);
  }
}
export async function assertProjectContext(context: unknown) {
  const state = context && typeof context === "object"
    ? states.get(context)
    : undefined;
  if (!state) fail("CONTEXT_EXPIRED", "Чужой или завершённый контекст");
  await checkState(state, false);
}
export function decodeProjectContract(context: ProjectContext) {
  const state = states.get(context);
  if (!state?.active) fail("CONTEXT_EXPIRED", "Контекст операции завершён");
  state.bound?.sync();
  return freeze(
    decodeProjectValue(
      context.effectiveMetadata[namespace] ?? {},
      context.input,
    ),
  );
}
type Declaration = {
  raw: unknown;
  sourceFile: string;
  range?: [number, number];
  field: string;
};
function instrument(
  text: string,
  path: string,
  declarations: Map<number, Declaration>,
  qmd: boolean,
): string {
  let yaml = text, offset = 0, end = text.length;
  if (qmd) {
    const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/
      .exec(text);
    if (!match) return text;
    yaml = match[1];
    offset = match[0].indexOf(yaml);
    end = offset + yaml.length;
  }
  const doc = parseDocument(yaml, { keepSourceTokens: true, uniqueKeys: true });
  if (!doc || doc.errors.length || doc.warnings.length) {
    fail("ORIGIN_YAML", "YAML не квалифицирован", path);
  }
  const root = doc.contents;
  if (root && !Array.isArray(root.items)) {
    fail("ORIGIN_YAML", "Нужна карта YAML", path);
  }
  if (doc.has(marker)) {
    fail("ORIGIN_COLLISION", "Коллизия служебного ключа", path, marker);
  }
  if (doc.has("metadata-files") || doc.has("metadata-file")) {
    fail("ORIGIN_UNQUALIFIED", "metadata-files ещё не квалифицированы", path);
  }
  // Format-specific owner contracts требуют отдельной native qualification.
  const formats = doc.get("format", true);
  if (formats && JSON.stringify(formats.toJSON()).includes(namespace)) {
    fail(
      "ORIGIN_UNQUALIFIED",
      "Format contributor ещё не квалифицирован",
      path,
    );
  }
  const node = doc.get(namespace, true);
  if (!node) return text;
  let count = 0;
  function tree(n: any, field: string): unknown {
    if (++count > 4096) {
      fail("CONTRACT_LIMIT", "Слишком много YAML declarations", path);
    }
    if (isAlias(n) || n?.anchor || n?.tag) {
      fail(
        "ORIGIN_UNQUALIFIED",
        "Aliases/tags ещё не квалифицированы",
        path,
        field,
      );
    }
    if (n && Array.isArray(n.items)) {
      if (!n.items.every((p: any) => p && "key" in p)) {
        fail(
          "ORIGIN_UNQUALIFIED",
          "Массив не имеет доказанного scalar origin",
          path,
          field,
        );
      }
      const pairs = n.items.map((p: any) => {
        if (typeof p.key?.value !== "string") {
          fail("ORIGIN_UNQUALIFIED", "Непроверенное имя карты", path, field);
        }
        return [
          p.key.value,
          tree(p.value, field ? field + "." + p.key.value : p.key.value),
        ];
      });
      return Object.fromEntries(pairs);
    }
    const raw = n?.value ?? null, id = declarations.size + 1;
    declarations.set(id, {
      raw,
      sourceFile: path,
      range: n?.range ? [n.range[0] + offset, n.range[1] + offset] : undefined,
      field,
    });
    return id;
  }
  const markers = tree(node, "");
  const addition = "\n" + marker + ": " + JSON.stringify(markers) + "\n";
  return qmd
    ? text.slice(0, end) + addition + text.slice(end)
    : text + addition;
}
function collectOrigins(
  effective: any,
  ids: any,
  declarations: Map<number, Declaration>,
  input: string,
  state: State,
  field = "",
  result: Record<string, NativeOrigin> = {},
) {
  if (effective && typeof effective === "object") {
    if (
      Array.isArray(effective) || !ids || typeof ids !== "object" ||
      Array.isArray(ids) ||
      stable(Object.keys(effective).sort()) !== stable(Object.keys(ids).sort())
    ) {
      fail(
        "ORIGIN_UNPROVEN",
        "Native value/marker shape отличается",
        input,
        field,
      );
    }
    for (const key of Object.keys(effective)) {
      collectOrigins(
        effective[key],
        ids[key],
        declarations,
        input,
        state,
        field ? field + "." + key : key,
        result,
      );
    }
  } else {
    const origin = declarations.get(ids);
    if (!origin || origin.field !== field) {
      fail("ORIGIN_UNPROVEN", "Нет однозначного native origin", input, field);
    }
    const isPath = field.endsWith(".path") || field.startsWith("build.files.");
    const baseKind =
      (field.startsWith("testsets.") || field === "starter.path" ||
          field.startsWith("solutions.") ||
          field === "instructions.local.path") && field.endsWith(".path")
        ? "project"
        : "definition";
    const resolvedPath = isPath && typeof origin.raw === "string"
      ? resolve(
        baseKind === "project" ? dirname(input) : dirname(origin.sourceFile),
        origin.raw,
      )
      : undefined;
    if (resolvedPath) {
      inside(state.owner, resolvedPath);
      if (toolCachePath(state.owner, resolvedPath)) {
        fail(
          "ORIGIN_CACHE",
          "Tool cache не является предметным input",
          origin.sourceFile,
          field,
        );
      }
      if (!state.rows.has(resolvedPath)) {
        fail(
          "ORIGIN_MISSING",
          "Объявленный путь отсутствует",
          origin.sourceFile,
          field,
        );
      }
      for (const path of state.rows.keys()) {
        if (path === resolvedPath || path.startsWith(resolvedPath + "/")) {
          state.relevant.add(path);
        }
      }
      state.relevant.add(dirname(resolvedPath));
    }
    state.relevant.add(origin.sourceFile);
    result[field] = {
      raw: origin.raw,
      effective,
      sourceFile: origin.sourceFile,
      range: origin.range,
      baseKind,
      ...(resolvedPath ? { resolvedPath } : {}),
      evidence: "native-scalar-marker",
    };
  }
  return result;
}
export type ProjectContextGroup = {
  ownerMetadata: Record<string, any>;
  contexts: readonly ProjectContext[];
  readonly metrics: Readonly<State["metrics"]>;
};
/** Один disposable native-контекст на owner; lifetime ограничен callback. */
export async function readProjectContexts<T>(
  requests: readonly ProjectContextRequest[],
  use: (groups: readonly ProjectContextGroup[]) => Promise<T>,
): Promise<T> {
  const decodedRequests = decodeProjectRequests(requests);
  const groups: ProjectContextGroup[] = [],
    cleanups: string[] = [],
    allStates: State[] = [];
  try {
    const owners = new Set<string>();
    for (const request of decodedRequests) {
      const { owner, inputs, profiles, format } = request;
      if (
        resolve(owner) !== owner || await Deno.realPath(owner) !== owner ||
        owners.has(owner) || !inputs.length ||
        new Set(inputs).size !== inputs.length ||
        new Set(profiles).size !== profiles.length || profiles.some((p) =>
          !/^[-a-z0-9]+$/.test(p)
        ) || !/^[-a-z0-9]+$/.test(format)
      ) {
        fail(
          "CONTEXT_REQUEST",
          "Некорректный owner/input/profile/format",
          owner,
        );
      }
      owners.add(owner);
      const state: State = {
        active: true,
        owner,
        rows: new Map(),
        relevant: new Set(),
        metrics: {
          inspectCalls: 0,
          fullWalks: 0,
          fullFences: 0,
          sourceBytesRead: 0,
          sourceTreeHashes: 0,
          toolHashReads: 1,
        },
        tool: quartoExecutable(),
        version: "1.11.5",
        invocation: await invocationIdentity(owner),
        localInvocation: await invocationIdentity(owner, false),
      };
      allStates.push(state);
      const original = await inspect(owner, profiles, state);
      if (
        original.quarto?.version !== state.version || original.dir !== owner ||
        !original.config
      ) {
        fail(
          "CONTEXT_RUNTIME",
          "Требуется настоящий Quarto 1.11.5 owner",
          owner,
        );
      }
      const temp = await Deno.makeTempDir({ prefix: "course-native-context-" });
      cleanups.push(temp);
      await copyOwner(owner, temp, state);
      const declarations = new Map<number, Declaration>();
      const contributors = new Set<string>(original.files?.config ?? []);
      for (const input of inputs) {
        const source = resolve(owner, input);
        inside(owner, source);
        if (toolCachePath(owner, source)) {
          fail("CONTEXT_CACHE", "Tool cache не является code input", source);
        }
        let directory = dirname(source);
        if (!state.rows.get(directory)?.children) {
          fail("CONTEXT_INPUT", "Каталог кодового проекта отсутствует", source);
        }
        state.relevant.add(source);
        while (true) {
          state.relevant.add(directory);
          for (const name of ["_metadata.yml", "_metadata.yaml"]) {
            contributors.add(join(directory, name));
          }
          if (directory === owner) break;
          directory = dirname(directory);
        }
      }
      for (const [path, row] of state.rows) {
        if (!row.bytes) continue;
        const name = relative(owner, path).replaceAll("\\", "/");
        if (
          contributors.has(path) ||
          inputs.includes(name)
        ) {
          const source = new TextDecoder("utf-8", { fatal: true }).decode(
            row.bytes,
          );
          await Deno.writeTextFile(
            join(temp, name),
            instrument(source, path, declarations, name.endsWith(".qmd")),
          );
          state.relevant.add(path);
        }
      }
      const technical = "course-a1-" + crypto.randomUUID();
      const synthetic = await Promise.all(inputs.map(async (input) => {
        const source = resolve(owner, input);
        inside(owner, source);
        if (toolCachePath(owner, source)) {
          fail("CONTEXT_CACHE", "Tool cache не является code input", source);
        }
        if (
          !input.endsWith(".qmd") ||
          state.rows.has(source) && !state.rows.get(source)?.bytes
        ) {
          fail("CONTEXT_INPUT", "Нужен существующий QMD input", source);
        }
        if (!state.rows.has(source)) {
          await Deno.writeTextFile(
            join(temp!, input),
            "# Native code-project context\n",
          );
        }
        return input;
      }));
      await Deno.writeTextFile(
        join(temp, "_quarto-" + technical + ".yml"),
        "project:\n  type: default\n  render: " + JSON.stringify(synthetic) +
          "\n",
      );
      const contexts: ProjectContext[] = [];
      for (const input of inputs) {
        const live: any = await withAssignmentA1Probe({
          temporaryInput: join(temp!, input),
          originalInput: join(owner, input),
          technical,
        }, () => inspect(join(temp!, input), [...profiles, technical], state));
        if (
          live.project?.dir !== temp || live.quarto?.version !== state.version
        ) fail("CONTEXT_OWNER", "Native input потерял disposable owner", input);
        const metadata = live.formats?.[format]?.metadata;
        if (!metadata) {
          fail(
            "CONTEXT_FORMAT",
            "Формат отсутствует в native result",
            input,
            format,
          );
        }
        const ids = metadata[marker];
        delete metadata[marker];
        // Native effective paths остаются относительными к тому же input; абсолютные temp paths не публикуются.
        const origins = collectOrigins(
          metadata[namespace] ?? {},
          ids ?? {},
          declarations,
          join(owner, input),
          state,
        );
        const context = freeze(ProjectContextSchema.parse({
          owner,
          input: join(owner, input),
          profiles: [...profiles],
          format,
          effectiveMetadata: metadata,
          origins,
        }));
        states.set(context, state);
        contexts.push(context);
        decodeProjectContract(context);
      }
      groups.push({
        ownerMetadata: freeze(original.config),
        contexts: freeze(contexts),
        get metrics() {
          return Object.freeze({ ...state.metrics });
        },
      });
    }
    for (const state of allStates) await checkState(state, true);
    const result = await use(groups);
    for (const state of allStates) await checkState(state, true);
    return result;
  } finally {
    for (const state of allStates) state.active = false;
    for (const path of cleanups) await Deno.remove(path, { recursive: true });
  }
}

/** Internal materializer view of the already captured owner; no additional source walk. */
export async function projectContextFiles(
  context: ProjectContext,
  base: string,
): Promise<string[]> {
  await assertProjectContext(context);
  const state = states.get(context)!;
  inside(state.owner, base);
  if (toolCachePath(state.owner, base)) {
    fail(
      "PROJECT_SOURCE",
      "Tool cache не является captured source",
      context.input,
    );
  }
  const root = state.rows.get(base);
  if (!root?.children) {
    fail("PROJECT_SOURCE", "Нужен captured source directory", context.input);
  }
  const paths: string[] = [];
  for (const [path, row] of state.rows) {
    if (path === base || path.startsWith(base + "/")) {
      state.relevant.add(path);
      if (row.bytes) paths.push(path);
    }
  }
  return paths.sort();
}
/** Snapshot bytes are copied, and their physical identity is fenced until dependent IO. */
export async function readProjectContextFile(
  context: ProjectContext,
  path: string,
): Promise<Uint8Array> {
  await assertProjectContext(context);
  const state = states.get(context)!;
  inside(state.owner, path);
  if (toolCachePath(state.owner, path)) {
    fail(
      "PROJECT_SOURCE",
      "Tool cache не является captured source",
      context.input,
    );
  }
  const row = state.rows.get(path);
  if (!row?.bytes) {
    fail("PROJECT_SOURCE", "Нет captured regular file", context.input);
  }
  state.relevant.add(path);
  let parent = dirname(path);
  while (parent.startsWith(state.owner)) {
    state.relevant.add(parent);
    if (parent === state.owner) break;
    parent = dirname(parent);
  }
  if (state.bound) {
    await state.bound.guard([path]);
    return await state.bound.read(path);
  }
  await checkRow(row, state.owner);
  return new Uint8Array(row.bytes);
}
/** Только membership уже captured snapshot; вызывается между context fences, без IO. */
export function capturedProjectFile(
  context: ProjectContext,
  path: string,
): boolean {
  const state = states.get(context);
  if (!state?.active) fail("CONTEXT_EXPIRED", "Контекст операции завершён");
  state.bound?.sync();
  inside(state.owner, path);
  return !!state.rows.get(path)?.bytes;
}

/** Internal only: no public DTO can manufacture this private generation binding. */
export function assertProjectContextGeneration(
  context: ProjectContext,
  generation: object,
) {
  const state = states.get(context);
  if (!state?.active || state.bound?.generation !== generation) {
    fail(
      "BODY.ASSIGNMENT_PROJECT_PLANS",
      "A1 context принадлежит другому S/generation",
    );
  }
}
export type NativeOperationProjectContextMetrics = Readonly<
  State["metrics"] & {
    sourceFileReads: number;
    sourceCopyBytes: number;
    probeCacheHits: number;
  }
>;
export type NativeOperationProjectContextBatch = Readonly<
  {
    groups: readonly Readonly<
      Pick<ProjectContextGroup, "ownerMetadata" | "contexts">
    >[];
    metrics: NativeOperationProjectContextMetrics;
  }
>;
/** Core-internal adapter. The caller is the live operation closure, never a public provider. */
export function operationProjectContextReuse(source: {
  owner: string;
  profiles: readonly string[];
  generation: object;
  sync: () => void;
  ownerWitness: {
    config: Record<string, unknown>;
    files: { config: string[] };
  };
  rows: readonly { path: string }[];
  memberships: Record<string, string[]>;
  guard: (paths: readonly string[]) => Promise<void>;
  read: (path: string) => Promise<Uint8Array>;
}) {
  const byteCache = new Map<string, Uint8Array>();
  const cache = new Map<
    string,
    {
      values: Map<
        string,
        { metadata: Record<string, any>; origins: Record<string, NativeOrigin> }
      >;
      relevant: string[];
    }
  >();
  let running = false;
  return async function useContexts<T>(
    requests: readonly ProjectContextRequest[],
    use: (batch: NativeOperationProjectContextBatch) => Promise<T>,
  ): Promise<T> {
    if (running) {
      fail("CONTEXT_REQUEST", "Пересекающиеся bound A1 batches запрещены");
    }
    running = true;
    let temp: string | undefined;
    const metrics = {
      inspectCalls: 0,
      fullWalks: 0,
      fullFences: 0,
      sourceBytesRead: 0,
      sourceTreeHashes: 0,
      toolHashReads: 0,
      sourceFileReads: 0,
      sourceCopyBytes: 0,
      probeCacheHits: 0,
    };
    const state: State = {
      active: true,
      owner: source.owner,
      rows: new Map(),
      relevant: new Set(),
      metrics,
      tool: quartoExecutable(),
      version: "1.11.5",
      invocation: "",
      localInvocation: "",
    };
    const read = async (path: string) => {
      let bytes = byteCache.get(path);
      if (!bytes) {
        bytes = await source.read(path);
        metrics.sourceFileReads++;
        metrics.sourceBytesRead += bytes.length;
        byteCache.set(path, new Uint8Array(bytes));
      }
      return new Uint8Array(bytes);
    };
    state.bound = {
      generation: source.generation,
      sync: source.sync,
      guard: source.guard,
      read,
    };
    for (const [name, names] of Object.entries(source.memberships)) {
      state.rows.set(join(source.owner, name), {
        path: join(source.owner, name),
        signature: "",
        children: [...names],
      });
    }
    for (const row of source.rows) {
      state.rows.set(join(source.owner, row.path), {
        path: join(source.owner, row.path),
        signature: "",
        bytes: byteCache.get(join(source.owner, row.path)),
      });
    }
    const inputs = [...new Set(requests.flatMap((r) => r.inputs))].sort();
    const formats = new Map(
      inputs.map((input) => [
        input,
        [
          ...new Set(
            requests.filter((r) => r.inputs.includes(input)).map((r) =>
              r.format
            ),
          ),
        ].sort(),
      ]),
    );
    const key = stable({
      profiles: source.profiles,
      inputs: [...formats],
      phase: "native-scalar-markers-v1",
    });
    try {
      await source.guard([]);
      const contributors = new Set(
        source.ownerWitness.files.config.map((path) =>
          resolve(source.owner, path)
        ),
      );
      for (const input of inputs) {
        const absolute = resolve(source.owner, input);
        if (
          inside(source.owner, absolute) !== input ||
          !input.endsWith("/native-input.qmd")
        ) {
          fail(
            "CONTEXT_INPUT",
            "Требуется canonical code-project native-input.qmd",
            input,
          );
        }
        let directory = dirname(absolute);
        if (!state.rows.get(directory)?.children) {
          fail("CONTEXT_INPUT", "Каталог project отсутствует в S", input);
        }
        state.relevant.add(absolute);
        while (true) {
          state.relevant.add(directory);
          for (const name of ["_metadata.yml", "_metadata.yaml"]) {
            contributors.add(join(directory, name));
          }
          if (directory === source.owner) break;
          directory = dirname(directory);
        }
      }
      for (const contributor of contributors) {
        if (
          state.rows.get(contributor)?.bytes ||
          source.rows.some((r) => join(source.owner, r.path) === contributor)
        ) state.relevant.add(contributor);
      }
      const saved = cache.get(key);
      let resolved = saved?.values;
      if (saved) {
        saved.relevant.forEach((path) => state.relevant.add(path));
        metrics.probeCacheHits = inputs.length;
        for (const row of state.rows.values()) {
          if (byteCache.has(row.path)) {
            row.bytes = new Uint8Array(byteCache.get(row.path)!);
          }
        }
      } else if (inputs.length) {
        // Membership and row lists are the SAME S. No owner discovery/copyOwner call.
        await source.guard([...state.rows.keys()]);
        temp = await Deno.makeTempDir({ prefix: "course-bound-context-" });
        for (const row of state.rows.values()) {
          if (row.children) {
            await Deno.mkdir(join(temp, inside(source.owner, row.path)), {
              recursive: true,
            });
          }
        }
        for (const fact of source.rows) {
          const path = join(source.owner, fact.path), bytes = await read(path);
          state.rows.get(path)!.bytes = bytes;
          await Deno.writeFile(join(temp, fact.path), bytes);
          metrics.sourceCopyBytes += bytes.length;
        }
        await source.guard([...state.rows.keys()]);
        const declarations = new Map<number, Declaration>();
        for (const [path, row] of state.rows) {
          if (!row.bytes) continue;
          const name = inside(source.owner, path);
          if (contributors.has(path) || inputs.includes(name)) {
            await Deno.writeTextFile(
              join(temp, name),
              instrument(
                new TextDecoder("utf-8", { fatal: true }).decode(row.bytes),
                path,
                declarations,
                name.endsWith(".qmd"),
              ),
            );
          }
        }
        for (const input of inputs) {
          const row = state.rows.get(join(source.owner, input));
          if (row && !row.bytes) {
            fail("CONTEXT_INPUT", "Code input имеет необычный тип", input);
          }
          if (!row) {
            await Deno.writeTextFile(
              join(temp!, input),
              "# Native code-project context\n",
            );
          }
        }
        const technical = "course-a1-" + crypto.randomUUID();
        await Deno.writeTextFile(
          join(temp, "_quarto-" + technical + ".yml"),
          "project:\n  type: default\n  render: " + JSON.stringify(inputs) +
            "\n",
        );
        resolved = new Map();
        for (const input of inputs) {
          await checkState(state, false);
          const live: any = await withAssignmentA1Probe(
            {
              temporaryInput: join(temp!, input),
              originalInput: join(source.owner, input),
              technical,
            },
            () =>
              inspect(
                join(temp!, input),
                [...source.profiles, technical],
                state,
              ),
          );
          if (
            live.project?.dir !== temp || live.quarto?.version !== state.version
          ) {
            fail(
              "CONTEXT_OWNER",
              "Native input потерял disposable owner",
              input,
            );
          }
          for (const format of formats.get(input)!) {
            const metadata = structuredClone(live.formats?.[format]?.metadata);
            if (!metadata) {
              fail(
                "CONTEXT_FORMAT",
                "Формат отсутствует в native result",
                input,
                format,
              );
            }
            const ids = metadata[marker];
            delete metadata[marker];
            const origins = collectOrigins(
              metadata[namespace] ?? {},
              ids ?? {},
              declarations,
              join(source.owner, input),
              state,
            );
            resolved.set(input + "\0" + format, { metadata, origins });
          }
        }
        cache.set(key, { values: resolved, relevant: [...state.relevant] });
      }
      const contexts = new Map<string, ProjectContext>();
      const groups = requests.map((request) => ({
        ownerMetadata: freeze(structuredClone(source.ownerWitness.config)),
        contexts: freeze(request.inputs.map((input) => {
          const id = input + "\0" + request.format;
          let context = contexts.get(id);
          if (!context) {
            const value = resolved?.get(id);
            if (!value) {
              fail(
                "CONTEXT_FORMAT",
                "Отсутствует bound native result",
                input,
                request.format,
              );
            }
            context = freeze(ProjectContextSchema.parse({
              owner: source.owner,
              input: join(source.owner, input),
              profiles: [...source.profiles],
              format: request.format,
              effectiveMetadata: structuredClone(value.metadata),
              origins: structuredClone(value.origins),
            }));
            states.set(context, state);
            decodeProjectContract(context);
            contexts.set(id, context);
          }
          return context;
        })),
      }));
      const batch: NativeOperationProjectContextBatch = Object.freeze({
        groups: freeze(groups),
        get metrics() {
          return Object.freeze({ ...metrics });
        },
      });
      if (!inputs.length) {
        const result = await use(batch);
        await source.guard([]);
        return result;
      }
      await checkState(state, true);
      const result = await use(batch);
      await checkState(state, true);
      return result;
    } finally {
      state.active = false;
      running = false;
      if (temp) await Deno.remove(temp, { recursive: true });
    }
  };
}
