import { dirname, join, relative, resolve } from "stdlib/path";
import { quartoOutputNames } from "../infrastructure/generated-paths.ts";
import {
  toolCacheContainer,
  toolCachePath,
} from "../infrastructure/tool-cache.ts";
import { fail } from "../contracts/project.ts";
// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
export type SourceSnapshotState = {
  root: string;
  outputDirectory: string;
  rows: { path: string; signature: string; sha256: string }[];
  memberships: Record<string, string[]>;
  relevantInputs: string[];
  metrics: {
    fullWalks: number;
    sourceDirectoryReads: number;
    sourceHashReads: number;
    sourceHashBytes?: number;
    fullSourceFences: number;
    localSourceFences: number;
  };
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const pathSchema = z.string().min(1).refine((s) =>
  !s.startsWith("/") && !s.includes("\\") && !s.includes("\0") &&
  s.split("/").every((p) => p && p !== "." && p !== "..")
);
export const signature = (s: Deno.FileInfo) =>
  JSON.stringify([
    s.dev,
    s.ino,
    s.mode,
    s.size,
    s.mtime?.getTime(),
    s.ctime?.getTime(),
    s.isFile,
    s.isDirectory,
    s.isSymlink,
  ]);
export async function ownedPhysical(root: string, path: string) {
  if (!pathSchema.safeParse(path).success) {
    fail("RESOURCE_PATH", "Нужен canonical путь внутри owner");
  }
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    if ((await Deno.lstat(current)).isSymlink) {
      fail("OPERATION_CHANGED", "Символическая ссылка в native operation");
    }
  }
  if (await Deno.realPath(current) !== current) {
    fail("OPERATION_CHANGED", "Неканонический native path");
  }
  return current;
}
export async function regular(root: string, path: string) {
  const current = await ownedPhysical(root, path);
  if (!(await Deno.lstat(current)).isFile) {
    fail("OPERATION_CHANGED", "Нужен regular native file");
  }
  return current;
}
export async function hash(bytes: Uint8Array, algorithm = "SHA-256") {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(algorithm, new Uint8Array(bytes)),
    ),
  ].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export function excluded(
  state: Pick<SourceSnapshotState, "root" | "outputDirectory">,
  path: string,
) {
  const name = relative(state.root, path);
  return path === state.outputDirectory || toolCachePath(state.root, path) ||
    name.split("/").some((p) =>
      [
        ...quartoOutputNames,
        ".git",
        ".quarto",
        "_generated",
        "node_modules",
        ".gradle",
        "build",
      ]
        .includes(p)
    );
}
export async function snapshot(state: SourceSnapshotState) {
  state.metrics.fullWalks++;
  async function walk(dir: string) {
    const names: string[] = [];
    state.metrics.sourceDirectoryReads++;
    for await (const e of Deno.readDir(dir)) {
      const p = join(dir, e.name);
      if (excluded(state, p)) continue;
      if (e.isSymlink || !(e.isFile || e.isDirectory)) {
        fail(
          "OPERATION_UNQUALIFIED",
          "Native source symlink/special entry не квалифицирован",
        );
      }
      names.push(e.name);
      if (e.isDirectory) await walk(p);
      else {
        const signatureBefore = signature(await Deno.lstat(p));
        const bytes = await Deno.readFile(p);
        state.metrics.sourceHashReads++;
        if (typeof state.metrics.sourceHashBytes !== "number") {
          fail(
            "METRICS_UNAVAILABLE",
            "Fresh S requires sourceHashBytes counter",
          );
        }
        state.metrics.sourceHashBytes += bytes.length;
        if (signature(await Deno.lstat(p)) !== signatureBefore) {
          fail("OPERATION_CHANGED", "Source изменён при snapshot");
        }
        state.rows.push({
          path: relative(state.root, p),
          signature: signatureBefore,
          sha256: await hash(bytes),
        });
      }
    }
    state.memberships[relative(state.root, dir)] = names.sort();
  }
  await walk(state.root);
}
export async function assertSources(
  state: SourceSnapshotState,
  additions: readonly string[] = [],
  full = true,
  selectedInputs: readonly string[] = state.relevantInputs,
) {
  if (full) state.metrics.fullSourceFences++;
  else state.metrics.localSourceFences++;
  const relevant = new Set(selectedInputs);
  const directories = new Set(
    selectedInputs.map((p) => dirname(p) === "." ? "" : dirname(p)),
  );
  for (const input of selectedInputs) {
    if (Object.hasOwn(state.memberships, input)) directories.add(input);
    let directory = dirname(input);
    while (directory !== ".") {
      directories.add(directory);
      directory = dirname(directory);
    }
    directories.add("");
  }
  for (const row of state.rows) {
    if (!full && !relevant.has(row.path)) continue;
    const p = await regular(state.root, row.path);
    if (signature(await Deno.lstat(p)) !== row.signature) {
      fail("OPERATION_CHANGED", "Native source изменён: " + row.path);
    }
  }
  const allowed = new Set(additions);
  for (const [dir, names] of Object.entries(state.memberships)) {
    if (!full && !directories.has(dir)) continue;
    const current: string[] = [];
    state.metrics.sourceDirectoryReads++;
    for await (const entry of Deno.readDir(join(state.root, dir))) {
      const path = join(state.root, dir, entry.name);
      if (excluded(state, path)) continue;
      if (
        !names.includes(entry.name) &&
        await toolCacheContainer(state.root, path)
      ) continue;
      const local = relative(state.root, path);
      if (
        !names.includes(entry.name) &&
        [...allowed].some((p) => p === local || p.startsWith(local + "/"))
      ) continue;
      current.push(entry.name);
    }
    if (!same(current.sort(), names)) {
      fail("OPERATION_CHANGED", "Изменён состав native source: " + dir);
    }
  }
}
