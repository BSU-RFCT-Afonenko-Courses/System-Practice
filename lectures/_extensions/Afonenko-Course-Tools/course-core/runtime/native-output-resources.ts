import { relative, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import { regular } from "./source-paths.ts";

// Physical identity связывает роли и открытый handle, а не версию bytes.
async function resourceIdentity(path: string) {
  const info = await Deno.lstat(path);
  if (info.dev === null || info.ino === null) {
    fail("RESOURCE_PATH", "Physical identity native ресурса недоступна");
  }
  return JSON.stringify([info.dev, info.ino]);
}

export async function finishedNativeResource(
  state: { root: string; outputDirectory: string },
  source: string,
  sourceIdentities: readonly string[] = [],
  capturedSource?: string,
) {
  const output = resolve(state.outputDirectory, source);
  let original: string | undefined;
  try {
    original = await regular(state.root, source);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  let path: string;
  try {
    path = await regular(
      state.root,
      relative(state.root, capturedSource ?? output),
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    if (capturedSource) {
      fail(
        "RESOURCE_CURRENT_BYTES_MISSING",
        "Не найден native mediabag source",
      );
    }
    if (!original) {
      fail(
        "RESOURCE_CURRENT_BYTES_MISSING",
        "Не найден конечный native ресурс",
      );
    }
    path = original;
  }
  const identity = await resourceIdentity(path);
  return {
    path,
    identity,
    // Поздний перенос/удаление source не снимает уже установленную private роль.
    sourceIdentities: sourceIdentities.length
      ? [...sourceIdentities]
      : [original ? await resourceIdentity(original) : identity],
  };
}

export async function nativeResourceHandleIdentity(
  root: string,
  path: string,
  opened: Deno.FsFile,
) {
  const info = await opened.stat();
  if (!info.isFile) fail("RESOURCE_PATH", "Нужен regular native ресурс");
  // Deno.open не даёт portable no-follow/openat. Эта однократная проверка
  // после open отклоняет постоянную подмену пути и связывает его с handle.
  const actual = await regular(root, relative(root, path));
  const current = await Deno.lstat(actual);
  if (
    info.dev === null || info.ino === null ||
    current.dev === null || current.ino === null ||
    info.dev !== current.dev || info.ino !== current.ino
  ) {
    fail(
      "RESOURCE_PATH",
      "Открытый handle не принадлежит native resource path",
    );
  }
  return JSON.stringify([info.dev, info.ino]);
}
