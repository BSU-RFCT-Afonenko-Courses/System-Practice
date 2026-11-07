import { join, relative } from "stdlib/path";
import { quartoOutputNames } from "../infrastructure/generated-paths.ts";
import { toolCachePath } from "../infrastructure/tool-cache.ts";
import { fail } from "../contracts/project.ts";
// @deno-types="../vendor/zod/v4/index.d.ts"
import { z } from "../vendor/zod/v4/index.js";
const pathSchema = z.string().min(1).refine((s) =>
  !s.startsWith("/") && !s.includes("\\") && !s.includes("\0") &&
  s.split("/").every((p) => p && p !== "." && p !== "..")
);
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
export function excluded(
  state: { root: string; outputDirectory: string },
  path: string,
) {
  const name = relative(state.root, path);
  return path === state.outputDirectory ||
    path.startsWith(state.outputDirectory + "/") ||
    toolCachePath(state.root, path) ||
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
