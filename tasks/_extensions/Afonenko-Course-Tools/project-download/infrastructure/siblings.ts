import { dirname, fromFileUrl, join, toFileUrl } from "stdlib/path";

// Только типы: обычные resources не загружают optional provider runtime.
export type SiblingModules = {
  "course-core": typeof import("../../course-core/public.ts");
  "course-prairielearn": typeof import("../../course-prairielearn/public.ts");
  "reference-catalog": typeof import("../../reference-catalog/public.ts");
};
export type {
  NativePublication,
  ProjectContractContext,
  ProjectPlan,
} from "../../course-core/public.ts";

export async function sibling<Name extends keyof SiblingModules>(
  name: Name,
): Promise<SiblingModules[Name]> {
  const extension = dirname(dirname(fromFileUrl(import.meta.url)));
  return await import(
    toFileUrl(join(dirname(extension), name, "public.ts")).href
  );
}
