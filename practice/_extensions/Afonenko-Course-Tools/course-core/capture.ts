import { withAssignmentExecution } from "./runtime/assignment-execution.ts";
/** Existing capture scope: реальная owner operation и explicit assignment intent. */
import { prepareAssignment } from "./runtime/assignment-admission.ts";
import type { AssignmentPreparation } from "./runtime/assignment-admission.ts";
import type {
  NativeCaptureReservation,
  NativeCaptureScopeOptions,
} from "./runtime/contracts.ts";
import type { withNativeCaptureScope as OrdinaryCapture } from "./runtime/operation.ts";
import { NativeCaptureScopeOptionsSchema } from "./runtime/contracts.ts";
import { decode } from "./document/contracts.ts";
export type NativeAssignmentPreparation = AssignmentPreparation;
export async function withNativeCaptureScope<T>(
  reservation: NativeCaptureReservation,
  options: NativeCaptureScopeOptions | NativeAssignmentPreparation,
  use: Parameters<typeof OrdinaryCapture<T>>[2],
): Promise<T> {
  if (options && Object.hasOwn(options, "assignment") && "assignment" in options) {
    const fixedReservation = Object.freeze({ ...reservation });
    const prepared = await prepareAssignment(
      fixedReservation,
      options,
    );
    return await withAssignmentExecution(
      prepared.runtime,
      prepared.source.root,
      async () => {
        const runtime = await import("./runtime/operation.ts");
        return await runtime.withPreparedNativeCaptureScope(
          prepared,
          fixedReservation,
          use,
        );
      },
    );
  }
  const runtime = await import("./runtime/operation.ts");
  return await runtime.withNativeCaptureScope(
    reservation,
    decode(NativeCaptureScopeOptionsSchema, options, "OPERATION_BINDING"),
    use,
  );
}

export type {
  NativeCaptureCommand,
  NativeCaptureScope,
  NativePreparedLease,
  NativePreparedOperation,
} from "./runtime/prepared-operation.ts";
