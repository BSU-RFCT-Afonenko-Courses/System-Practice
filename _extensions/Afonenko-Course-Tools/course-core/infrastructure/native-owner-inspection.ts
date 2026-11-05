import { fail } from "../contracts/project.ts";
import { SupportedQuartoVersionSchema } from "./quarto-version.ts";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Только потребляемые owner/config поля; остальные native данные сохраняются. */
export type NativeOwnerConfiguration = Record<string, unknown> & {
  dir: string;
  quarto: Record<string, unknown> & { version: string };
  config: Record<string, unknown>;
  files?: Record<string, unknown> & { config?: string[] };
};

export function decodeNativeOwnerConfiguration(
  value: unknown,
  root: string,
): NativeOwnerConfiguration {
  if (!record(value)) {
    fail("OPERATION_UNQUALIFIED", "Требуется native Quarto>=1.11.5 owner");
  }
  let files: NativeOwnerConfiguration["files"];
  if (value.files !== undefined) {
    if (!record(value.files)) {
      fail("OPERATION_BINDING", "Некорректный native owner config scope");
    }
    const paths: unknown = value.files.config;
    if (
      paths !== undefined &&
      (!Array.isArray(paths) ||
        !paths.every((path: unknown) => typeof path === "string"))
    ) fail("OPERATION_BINDING", "Некорректный native owner config scope");
    files = {
      ...value.files,
      ...(paths === undefined ? {} : { config: paths }),
    };
  }
  const version = SupportedQuartoVersionSchema.safeParse(
    record(value.quarto) ? value.quarto.version : undefined,
  );
  if (
    !version.success || value.dir !== root || !record(value.config) ||
    !record(value.quarto)
  ) {
    fail("OPERATION_UNQUALIFIED", "Требуется native Quarto>=1.11.5 owner");
  }
  return {
    ...value,
    dir: value.dir,
    quarto: { ...value.quarto, version: version.data },
    config: value.config,
    ...(files === undefined ? {} : { files }),
  };
}

export type NativeOwnerInspection = NativeOwnerConfiguration & {
  files: Record<string, unknown> & { input: string[]; config?: string[] };
};

/** Operation требует input scope; A1 использует только общие owner/config поля. */
export function decodeNativeOwnerInspection(
  value: unknown,
  root: string,
): NativeOwnerInspection {
  if (!record(value) || !record(value.files)) {
    fail("OPERATION_BINDING", "Нет native owner input scope");
  }
  const inputs: unknown = value.files.input;
  if (
    !Array.isArray(inputs) ||
    !inputs.every((path: unknown) => typeof path === "string")
  ) fail("OPERATION_BINDING", "Нет native owner input scope");
  const owner = decodeNativeOwnerConfiguration(value, root);
  return {
    ...owner,
    files: { ...owner.files, input: inputs },
  };
}
