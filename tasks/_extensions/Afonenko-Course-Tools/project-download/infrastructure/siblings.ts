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

// Отложенные literal imports сохраняют типы публичных модулей владельцев.
const loaders: {
  [Name in keyof SiblingModules]: () => Promise<SiblingModules[Name]>;
} = {
  "course-core": () => import("../../course-core/public.ts"),
  "course-prairielearn": () => import("../../course-prairielearn/public.ts"),
  "reference-catalog": () => import("../../reference-catalog/public.ts"),
};
export async function sibling<Name extends keyof SiblingModules>(
  name: Name,
): Promise<SiblingModules[Name]> {
  return await loaders[name]();
}
