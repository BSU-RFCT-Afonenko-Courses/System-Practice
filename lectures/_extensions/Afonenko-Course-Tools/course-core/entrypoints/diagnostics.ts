import { CoreContractError } from "../contracts/project.ts";

const expected = (error: Error) => error instanceof CoreContractError ||
  ["ExtensionDiagnostic", "ExternalToolFailure"].includes(error.name);

/** Узкая CLI-граница: известные ошибки печатаются один раз, неизвестные сохраняют stack. */
export async function runCli(main: () => Promise<unknown>): Promise<void> {
  try { await main(); }
  catch (error) {
    if (!(error instanceof Error) || !expected(error)) throw error;
    let current: unknown = error;
    const seen = new Set<Error>();
    while (current instanceof Error && !seen.has(current)) {
      seen.add(current);
      console.error(expected(current) ? current.message : current.stack ?? current.message);
      current = current.cause;
    }
    Deno.exit(1);
  }
}
