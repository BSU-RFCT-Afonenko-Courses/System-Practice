const nativeArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);
import { dirname, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import {
  assertProjectContext,
  assertProjectContextGeneration,
  projectContextSourceIdentities,
} from "../infrastructure/project-context.ts";
import { projectPathEntries } from "../infrastructure/course-project-loader.ts";
import { projectPlanState } from "../artifacts/plan.ts";
import type { ProjectContextView } from "../contracts/project.ts";
import type { ProjectPlan } from "../artifacts/contracts.ts";
export type NativeAssignmentProjectPlans = {
  source: string;
  exerciseId: string;
  student: ProjectPlan;
  full: ProjectPlan;
};
export type AssignmentProjectDeclaration = {
  source: string;
  id: string;
  project: string;
};
import {
  projectFileRoles,
  projectRolePredicate as assignmentRolePredicate,
} from "../domain/project-roles.ts";
import type { ProjectFileRole as AssignmentRole } from "../domain/project-roles.ts";
export { projectRolePredicate as assignmentRolePredicate } from "../domain/project-roles.ts";
export type { ProjectFileRole as AssignmentRole } from "../domain/project-roles.ts";
const inside = (root: string, path: string) =>
  path === root || path.startsWith(root + "/");
function invalid(s: string): never {
  return fail("BODY.ASSIGNMENT_PROJECT_PLANS", s);
}
export function assignmentProjectRoot(
  root: string,
  definition: AssignmentProjectDeclaration,
) {
  const source = resolve(root, definition.source);
  return resolve(
    definition.project.startsWith("/") ? root : dirname(source),
    definition.project.replace(/^\//, ""),
  );
}
/** The exact complete plan set is required before the first Body resource lookup. */
export async function assignmentRoleIndex(
  { root, profiles, documents, declared, pairs, resources, generation }: {
    root: string;
    profiles: readonly string[];
    documents: readonly { source: string; format: string }[];
    declared: readonly AssignmentProjectDeclaration[];
    pairs: readonly NativeAssignmentProjectPlans[];
    resources: readonly { path: string; identity: string }[];
    generation: object;
  },
) {
  if (
    !nativeArray(pairs) || pairs.length !== declared.length ||
    pairs.length > 4096
  ) invalid("Неполное покрытие declared projects");
  const roles: AssignmentRole[] = [],
    contexts = new Map<ProjectContextView, ProjectPlan>(),
    projectRoots: string[] = [],
    plans = new Map<string, NativeAssignmentProjectPlans>();
  for (const pair of pairs) {
    if (
      !pair ||
      Object.keys(pair).some((k) =>
        !["source", "exerciseId", "student", "full"].includes(k)
      )
    ) invalid("Неверная project plan row");
    const key = pair.source + "\0" + pair.exerciseId,
      definition = declared.find((d) =>
        d.source === pair.source && d.id === pair.exerciseId
      ),
      doc = documents.find((d) => d.source === pair.source);
    if (!definition || !doc || plans.has(key)) {
      invalid("Чужой/повторный project plan");
    }
    const student = await projectPlanState(pair.student),
      full = await projectPlanState(pair.full),
      context = student.context;
    if (
      context !== full.context || pair.student.audience !== "student" ||
      pair.full.audience !== "full" || context.owner !== root ||
      context.format !== doc.format ||
      JSON.stringify(context.profiles) !== JSON.stringify(profiles)
    ) invalid("Student/full context/format/profiles/owner отличаются");
    assertProjectContextGeneration(context, generation);
    const project = assignmentProjectRoot(root, definition);
    if (project !== context.input) {
      invalid("Plan относится к другому declared project");
    }
    plans.set(key, pair);
    contexts.set(context, pair.student);
    projectRoots.push(context.input);
  }
  for (const [context, selected] of contexts) {
    const paths = projectPathEntries(context.contract);
    for (const { path } of paths) {
      if (resolve(path) !== path || !inside(root, path)) {
        invalid("Неканонический physical path");
      }
    }
    roles.push(...projectFileRoles(paths, selected));
  }
  const identities = resources.map((row) => ({
    path: resolve(root, row.path),
    identity: row.identity,
  }));
  for (const [context, selected] of contexts) {
    const state = await projectPlanState(selected);
    identities.push(
      ...await projectContextSourceIdentities(
        context,
        () => state.metrics.treeWalks++,
      ),
    );
  }
  const assertPath = assignmentRolePredicate(
    roles,
    projectRoots,
    identities,
  );

  return {
    plans,
    roles: Object.freeze(roles),
    assertPath,
    assertIdentity: assertPath.assertIdentity,
    async guard() {
      for (const context of contexts.keys()) {
        await assertProjectContext(context);
      }
    },
  };
}
