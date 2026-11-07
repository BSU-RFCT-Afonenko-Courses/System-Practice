import { sibling, type SiblingModules } from "../infrastructure/siblings.ts";
import { diagnostic } from "../diagnostics.ts";
import { zip } from "../domain/zip.ts";

/**
 * Один ZIP из функционального набора файлов Core без чтения проекта и изменения README.
 * Размеры и CRC вычисляются по переданным bytes.
 */
export async function packageArtifact(value: unknown): Promise<Uint8Array> {
  let supplied: unknown;
  try {
    // До lazy import тоже нельзя отдавать caller право изменить будущий ZIP.
    supplied = structuredClone(value);
  } catch (cause) {
    throw diagnostic(
      "DOWNLOAD.FILES_INVALID",
      "Невозможно получить собственную копию файлов",
      { field: "artifact" },
      cause,
    );
  }
  const core = await sibling("course-core");
  let artifact: ReturnType<SiblingModules["course-core"]["ArtifactFilesSchema"]["parse"]>;
  try {
    artifact = core.ArtifactFilesSchema.parse(supplied);
  } catch (cause) {
    throw diagnostic(
      "DOWNLOAD.FILES_INVALID",
      "Файлы Core не соответствуют публичной схеме",
      { field: "artifact" },
      cause,
    );
  }
  // Обычные bytes уже принадлежат ранней копии; shared memory отделяется ниже.
  const files = artifact.files;
  const names = new Set<string>();
  for (const file of files) {
    // structuredClone сохраняет общую память SAB: оставляем прежнюю позднюю ownership copy.
    if (file.bytes.buffer instanceof SharedArrayBuffer) {
      file.bytes = new Uint8Array(file.bytes);
    }
    if (names.has(file.target) || file.audience !== artifact.audience) {
      throw diagnostic(
        "DOWNLOAD.FILES_INVALID",
        "Повторный target или чужая аудитория файла artifact",
        { id: file.target, field: "target/audience" },
      );
    }
    names.add(file.target);
  }
  for (const name of names) {
    const parts = name.split("/");
    while (parts.length > 1) {
      parts.pop();
      if (names.has(parts.join("/"))) {
        throw diagnostic(
          "DOWNLOAD.FILES_INVALID",
          "Файл artifact пересекается с каталогом другого файла",
          { id: name, field: "target" },
        );
      }
    }
  }
  files.sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0);
  return zip(files.map((file) => ({
    name: file.target,
    bytes: file.bytes,
  })));
}
