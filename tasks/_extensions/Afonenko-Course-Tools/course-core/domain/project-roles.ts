import { fail } from "../contracts/project.ts";
export type ProjectFileRole = {
  path: string;
  tree: boolean;
  public: boolean;
  reason: string;
};
const inside = (root: string, path: string) =>
  path === root || path.startsWith(root + "/");
const invalid = (message: string): never =>
  fail("BODY.ASSIGNMENT_PROJECT_PLANS", message);
/** Роли одного проекта; policy общая для ordinary и assignment выдачи. */
export function projectFileRoles(
  paths: readonly { field: string; path: string }[],
  selected: { testsets: readonly string[]; components: readonly string[] },
): ProjectFileRole[] {
  return paths.map(({ field, path }) => {
    if (field === "starter.path") {
      return { path, tree: true, public: true, reason: field };
    }
    if (field.startsWith("solutions.") && field.endsWith(".path")) {
      return { path, tree: true, public: false, reason: field };
    }
    if (field.startsWith("testsets.") && field.endsWith(".path")) {
      return {
        path,
        tree: true,
        public: selected.testsets.includes(field.slice(9, -5)),
        reason: field,
      };
    }
    if (field.startsWith("components.") && field.endsWith(".path")) {
      return {
        path,
        tree: true,
        public: selected.components.includes(field.slice(11, -5)),
        reason: field,
      };
    }
    if (
      field.startsWith("build.files.") ||
      ["instructions.gradle.path", "instructions.local.path"].includes(field)
    ) return { path, tree: false, public: true, reason: field };
    return invalid("Неизвестная роль файла " + field);
  });
}
/** Роли и actual physical aliases; не проверка неизменности source. */
export function projectRolePredicate(
  roles: readonly ProjectFileRole[],
  projectRoots: readonly string[],
  sourceFiles: readonly { path: string; identity: string }[] = [],
) {
  const ordered = [...roles].sort((a, b) => a.path.localeCompare(b.path)),
    stack: ProjectFileRole[] = [];
  for (const row of ordered) {
    while (stack.length && !inside(stack.at(-1)!.path, row.path)) stack.pop();
    for (const ancestor of stack) {
      if (
        ancestor.public !== row.public &&
        (ancestor.tree || ancestor.path === row.path)
      ) {
        invalid(
          "Конфликт публичной и закрытой роли: " + ancestor.path + " / " +
            row.path,
        );
      }
    }
    stack.push(row);
  }
  const lexicalClosed = (path: string) =>
    roles.some((r) =>
      !r.public && (path === r.path || r.tree && inside(r.path, path))
    );
  const identities = new Map<string, Set<string>>();
  for (const row of sourceFiles) {
    const known = identities.get(row.path) ?? new Set<string>();
    known.add(row.identity);
    identities.set(row.path, known);
  }
  const closedIdentities = new Set(
    sourceFiles.filter((row) => lexicalClosed(row.path)).map((row) =>
      row.identity
    ),
  );
  for (const row of sourceFiles) {
    if (
      closedIdentities.has(row.identity) &&
      roles.some((r) =>
        r.public && (row.path === r.path || r.tree && inside(r.path, row.path))
      )
    ) {
      invalid(
        "Конфликт physical alias публичной и закрытой роли " + row.path,
      );
    }
  }
  const assertIdentity = (identity: string) => {
    if (closedIdentities.has(identity)) {
      fail("BODY.RESOURCE_PRIVATE_ROLE", "Physical alias закрытого A1 роль");
    }
  };
  const assertPath = (path: string) => {
    if (
      [...(identities.get(path) ?? [])].some((id) => closedIdentities.has(id))
    ) {
      fail(
        "BODY.RESOURCE_PRIVATE_ROLE",
        "Physical alias закрытого A1 роль " + path,
      );
    }

    if (
      roles.some((r) =>
        !r.public && (path === r.path || r.tree && inside(r.path, path))
      )
    ) fail("BODY.RESOURCE_PRIVATE_ROLE", "Закрытый declared A1 роль " + path);
    const known = roles.some((r) =>
      r.public && (path === r.path || r.tree && inside(r.path, path))
    );
    if (!known && projectRoots.some((root) => inside(root, path))) {
      fail(
        "BODY.RESOURCE_ROLE_UNPROVEN",
        "Нет публичной роли внутри declared project " + path,
      );
    }
  };
  return Object.assign(assertPath, { assertIdentity });
}
