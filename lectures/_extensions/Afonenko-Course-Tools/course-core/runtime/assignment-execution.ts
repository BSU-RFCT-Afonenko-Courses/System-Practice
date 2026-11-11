import {
  nativeChildBefore,
  ordinaryPandocChild,
  qualifiedPandocArgs,
  withNativeChildScope,
} from "./native-child.ts";
const nativeArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);
import type { NativePandocBinding } from "./pandoc-binding.ts";
import type { NativeCaptureCommand } from "./prepared-operation.ts";
import type { AssignmentRuntimeWitness } from "./assignment-admission.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { relative, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
type Execution = {
  runtime: AssignmentRuntimeWitness;
  root: string;
  pandocBinding?: (() => Promise<NativePandocBinding | undefined>) | undefined;
  beforeChild?: (() => Promise<void>) | undefined;
  lives: { active: boolean }[];
  token?: string;
};
const current = new AsyncLocalStorage<Execution>();
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function changed(message: string): never {
  return fail("BODY.PRODUCER_INPUT_CHANGED", message);
}
function execution() {
  const state = current.getStore();
  if (state?.lives.some((life) => !life.active)) {
    fail("OPERATION_EXPIRED", "Assignment execution scope истёк");
  }
  return state;
}
async function enter<T>(
  state: Omit<Execution, "lives"> & { lives?: Execution["lives"] },
  use: () => Promise<T>,
) {
  const life = { active: true };
  try {
    return await current.run(
      { ...state, lives: [...state.lives ?? [], life] },
      use,
    );
  } finally {
    life.active = false;
  }
}
export function withAssignmentExecution<T>(
  runtime: AssignmentRuntimeWitness,
  root: string,
  use: () => Promise<T>,
  beforeChild?: () => Promise<void>,
) {
  return enter({ runtime, root, beforeChild }, use);
}
export function withAssignmentBeforeChild<T>(
  beforeChild: () => Promise<void>,
  use: () => Promise<T>,
  life: { active: boolean },
  pandocBinding?: () => Promise<NativePandocBinding | undefined>,
) {
  const state = execution();
  return withNativeChildScope(
    { beforeChild, life, pandocBinding },
    () =>
      state
        ? enter({
          ...state,
          beforeChild,
          lives: [...state.lives, life],
          pandocBinding: pandocBinding ?? state.pandocBinding,
        }, use)
        : use(),
  );
}
export function withAssignmentCaptureChild<T>(
  token: string,
  use: () => Promise<T>,
) {
  const state = execution();
  if (!state) changed("Нет assignment execution для capture child");
  return enter({ ...state, token }, use);
}
export async function assignmentBeforeChild() {
  if (await nativeChildBefore()) return;
  const state = execution();
  await state?.beforeChild?.();
  execution();
}
export function assignmentQuarto() {
  return execution()?.runtime.executable;
}
/** Только existing Core call sites; caller capture получает отдельный exact render ниже. */
export function assignmentChild(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  const state = execution();
  if (!state) return undefined;
  const { runtime, root } = state;
  if (
    (executable !== "quarto" && executable !== runtime.executable) ||
    cwd !== root ||
    !nativeArray(args) || args.some((a) => typeof a !== "string")
  ) changed("Чужой native executable/cwd/argv");
  const base = runtime.profiles.join(",");
  const ownerInspect = equal(args, [
    "inspect",
    root,
    ...(base ? ["--profile", base] : []),
  ]);
  const render = !!state.token &&
    equal(args, [
      "render",
      "--output-dir",
      relative(root, runtime.outputDirectory),
      "--profile",
      base,
    ]);
  const pandoc = qualifiedPandocArgs(args, root);
  if (
    !ownerInspect && !render && !pandoc
  ) changed("Native command вне existing Core call site");
  const fixed = { ...runtime.environment };
  for (const [key, value] of Object.entries(env)) {
    if (key === "QUARTO_PROFILE") {
      if (value !== base) {
        changed("Чужой native profiles");
      }
    } else if (key === "COURSE_CORE_CAPTURE_TOKEN") {
      if (!state.token || value !== state.token || !render) {
        changed("Чужой child correlation");
      }
    } else if (fixed[key] !== value) changed("Чужой native environment " + key);
    fixed[key] = value;
  }
  // Private capture ждёт выхода Quarto; site ZIP в этой операции не нужны.
  if (render) fixed.COURSE_SITE_DEFER_DOWNLOADS = "1";
  return {
    executable: runtime.executable,
    options: { args: [...args], cwd, env: fixed, clearEnv: true as const },
  };
}
/** Тот же проверенный child, с existing operation Pandoc binding при наличии. */
export async function assignmentPandocChild(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  const qualified = assignmentChild(executable, args, cwd, env);
  const state = execution();
  if (!state) return await ordinaryPandocChild({ executable, args, cwd, env });
  const binding = await state.pandocBinding?.();
  execution();
  if (!binding || !qualified) return qualified;
  // Только эквивалентный frozen snapshot может заменить launcher.
  // Любое отличие host transport или runtime controls сохраняет fallback.
  const environment = qualified.options.env;
  if (
    binding.diagnosticTool !== qualified.executable ||
    binding.cwd !== qualified.options.cwd ||
    Object.keys(binding.environment).length !==
      Object.keys(environment).length ||
    Object.entries(binding.environment).some(([key, value]) =>
      environment[key] !== value
    )
  ) return qualified;
  const childEnvironment: Record<string, string> = {
    ...qualified.options.env,
    PWD: cwd,
  };
  return {
    executable: binding.executable,
    options: {
      args: [...args.slice(1)],
      cwd,
      env: childEnvironment,
      clearEnv: true as const,
    },
  };
}
export function runAssignmentCaptureChild(
  token: string,
  command: NativeCaptureCommand,
) {
  return withAssignmentCaptureChild(token, async () => {
    const state = execution()!, base = state.runtime.profiles.join(",");
    const expected = [
      "render",
      "--output-dir",
      relative(state.root, state.runtime.outputDirectory),
    ];
    if (!equal(command.args, expected)) {
      changed("Capture command требует точный owner render/output");
    }
    const args = [...expected, "--profile", base];
    const qualified = assignmentChild("quarto", args, state.root, {
      COURSE_CORE_CAPTURE_TOKEN: token,
      QUARTO_PROFILE: base,
    })!;
    await assignmentBeforeChild();
    const result = await new Deno.Command(qualified.executable, {
      ...qualified.options,
      stdout: command.stdout ?? "piped",
      stderr: command.stderr ?? "piped",
      ...(command.timeoutMs
        ? { signal: AbortSignal.timeout(command.timeoutMs) }
        : {}),
    }).output();
    if (!result.success) {
      fail(
        "OPERATION_INCOMPLETE",
        "Native capture child failed: " + result.code +
          ((command.stderr ?? "piped") === "piped"
            ? "\n" + new TextDecoder().decode(result.stderr)
            : ""),
      );
    }
    return result;
  });
}
export async function assignmentServiceDirectory(
  root: string,
  kind: "citations" | "validation",
) {
  const state = execution();
  if (!state) return undefined;
  if (root !== state.root) changed("Чужой assignment service owner");
  const { safeParent } = await import("../artifacts/files.ts");
  const directory = root + "/_generated/course-spec/assignment-work/" + kind;
  await safeParent(directory);
  await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}
