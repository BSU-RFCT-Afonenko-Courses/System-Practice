import type { NativeCaptureCommand } from "./prepared-operation.ts";
import type { AssignmentRuntimeWitness } from "./assignment-admission.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { relative, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
type Execution = {
  runtime: AssignmentRuntimeWitness;
  root: string;
  beforeChild?: () => Promise<void>;
  lives: { active: boolean }[];
  token?: string;
  probe?: { temporaryInput: string; originalInput: string; technical: string };
  contractProbe?: { temporaryOwner: string; guard: () => void };
};
const current = new AsyncLocalStorage<Execution>();
const carrierGuard = new AsyncLocalStorage<() => Promise<void>>();
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
) {
  const state = execution();
  return state
    ? enter({ ...state, beforeChild, lives: [...state.lives, life] }, use)
    : use();
}
export function withAssignmentCaptureChild<T>(
  token: string,
  use: () => Promise<T>,
) {
  const state = execution();
  if (!state) changed("Нет assignment execution для capture child");
  return enter({ ...state, token }, use);
}
export function withAssignmentA1Probe<T>(
  probe: NonNullable<Execution["probe"]>,
  use: () => Promise<T>,
) {
  const state = execution();
  if (!state) return use();
  if (
    !probe.originalInput.startsWith(state.root + "/") ||
    resolve(probe.originalInput) !== probe.originalInput ||
    !probe.temporaryInput.startsWith("/") ||
    resolve(probe.temporaryInput) !== probe.temporaryInput ||
    !/^course-a1-[-a-z0-9]+$/.test(probe.technical)
  ) changed("Чужой A1 probe");
  return enter({ ...state, probe: { ...probe } }, use);
}
export async function withAssignmentContractProbe<T>(probe: {
  temporaryOwner: string;
  originalInputs: readonly string[];
  format: string;
  guard: () => void;
  beforeSpawn?: () => Promise<void>;
}, use: () => Promise<T>) {
  const state = execution();
  const run = () =>
    carrierGuard.run(async () => {
      probe.guard();
      await probe.beforeSpawn?.();
      probe.guard();
    }, use);
  if (!state) return await run();
  probe.guard();
  if (
    probe.format !== "html" || !probe.temporaryOwner.startsWith("/") ||
    resolve(probe.temporaryOwner) !== probe.temporaryOwner ||
    /[\\\0]/.test(probe.temporaryOwner) ||
    probe.temporaryOwner === state.root ||
    probe.temporaryOwner.startsWith(state.root + "/") ||
    !probe.originalInputs.length ||
    new Set(probe.originalInputs).size !== probe.originalInputs.length ||
    probe.originalInputs.some((input) =>
      !input.startsWith(state.root + "/") || resolve(input) !== input
    )
  ) changed("Aggregate probe вне принятых project inputs/format");
  return await enter({
    ...state,
    contractProbe: { temporaryOwner: probe.temporaryOwner, guard: probe.guard },
  }, run);
}
export async function assignmentBeforeChild() {
  const state = execution();
  state?.contractProbe?.guard();
  await state?.beforeChild?.();
  state?.contractProbe?.guard();
  await carrierGuard.getStore()?.();
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
    !Array.isArray(args) || args.some((a) => typeof a !== "string")
  ) changed("Чужой native executable/cwd/argv");
  state.contractProbe?.guard();
  const base = runtime.profiles.join(","),
    technical = state.probe
      ? [...runtime.profiles, state.probe.technical].join(",")
      : undefined;
  const aggregate = !!state.contractProbe &&
    equal(args, ["inspect", state.contractProbe.temporaryOwner]);
  const probe = !!state.probe &&
    equal(args, [
      "inspect",
      state.probe.temporaryInput,
      "--profile",
      technical,
    ]);
  const ownerInspect = equal(args, [
    "inspect",
    root,
    ...(base ? ["--profile", base] : []),
  ]);
  const localInspect = args[0] === "inspect" &&
    args[1]?.startsWith(root + "/") && resolve(args[1]) === args[1] &&
    equal(args, ["inspect", args[1], ...(base ? ["--profile", base] : [])]);
  const render = !!state.token &&
    equal(args, [
      "render",
      "--output-dir",
      relative(root, runtime.outputDirectory),
      "--profile",
      base,
    ]);
  const pandoc = args[0] === "pandoc" && (
    equal(args, [
      "pandoc",
      "--from",
      "markdown",
      "--to",
      "json",
      "--wrap=none",
    ]) ||
    equal(args, ["pandoc", "--from", "json", "--to", "gfm", "--wrap=none"]) ||
    args.length === 5 &&
      equal(args.slice(0, 4), [
        "pandoc",
        "--from=json",
        "--to=json",
        "--citeproc",
      ]) &&
      args[4].startsWith("--resource-path=") &&
      (args[4] === "--resource-path=" + root ||
        args[4].slice(16).startsWith(root + "/")) &&
      resolve(args[4].slice(16)) === args[4].slice(16)
  );
  if (
    !aggregate && !probe && !ownerInspect && !localInspect && !render && !pandoc
  ) changed("Native command вне existing Core call site");
  const fixed = { ...runtime.environment };
  for (const [key, value] of Object.entries(env)) {
    if (key === "QUARTO_PROFILE") {
      if (value !== (aggregate ? "" : probe ? technical : base)) {
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
