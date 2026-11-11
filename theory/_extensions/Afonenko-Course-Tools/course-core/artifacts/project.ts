import {
  catalogueCitations,
  catalogueCiteInlines,
  catalogueReference,
} from "../document/catalogue-cite.ts";
import {
  assignmentBeforeChild,
  assignmentPandocChild,
} from "../runtime/assignment-execution.ts";
import {
  assertAssignmentArtifactSource,
  assertAssignmentConditionPlan,
} from "../runtime/assignment-condition.ts";
import { toolCachePath } from "../infrastructure/tool-cache.ts";
import {
  artifactTargetIssue,
  excluded,
  privateNames,
  publicExcluded,
} from "./policy.ts";
import {
  assertNativeValue,
  readNativeResource,
} from "../runtime/capabilities.ts";
import { dirname, join, relative, resolve } from "stdlib/path";
import { boundInput, fail } from "../contracts/project.ts";
import {
  assertProjectContext,
  projectContextFiles,
  projectFileExists,
  readProjectContextFile,
} from "../infrastructure/project-context.ts";
import { quartoExecutable } from "../infrastructure/process.ts";
import {
  isContainer,
  isLink,
  isNode,
  isRecord,
  nodeAttributes,
  requireNodes,
} from "../document/native-ast.ts";
import {
  boundDocument,
  decode,
  PandocDocumentSchema,
} from "../document/contracts.ts";
import {
  ArtifactDestinationSchema,
  ArtifactFilesDataSchema,
  ArtifactFilesSchema,
  ArtifactTargetSchema,
  ArtifactWriteResultSchema,
  MaterializableConditionSchema,
  MaterializationBindingsSchema,
  MaterializationClosureSchema,
  ResolvedConditionSchema,
} from "./contracts.ts";
import type {
  ArtifactFile,
  ArtifactFiles,
  ArtifactWriteResult,
  MaterializableCondition,
  MaterializationBindings,
  MaterializationClosure,
  ProjectPlan,
  ResolvedCondition,
} from "./contracts.ts";
import { assertProjectPublicRoles, projectPlanState } from "./plan.ts";
import type { PlanState } from "./plan.ts";
import { absent, inside, real, safeParent } from "./files.ts";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export function assertArtifactTarget(
  target: string,
  audience: "student" | "full",
  owner?: string,
) {
  decode(ArtifactTargetSchema, target, "ARTIFACT_CONTRACT");
  const issue = artifactTargetIssue(target, audience, owner);
  if (issue) fail(issue.code, issue.message);
}
function copyArtifactFiles(value: ArtifactFiles): ArtifactFiles {
  return {
    ...value,
    files: value.files.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) })),
  };
}
async function pandoc(
  state: PlanState,
  from: string,
  to: string,
  input: string,
) {
  state.metrics.pandocCalls++;
  const args = ["pandoc", "--from", from, "--to", to, "--wrap=none"];
  await assignmentBeforeChild();
  const qualified = await assignmentPandocChild(
    quartoExecutable(),
    args,
    state.context.owner,
    { QUARTO_RUN_NO_NETWORK: "true" },
  );
  const child = new Deno.Command(qualified?.executable ?? quartoExecutable(), {
    ...(qualified?.options ??
      {
        args,
        cwd: state.context.owner,
        env: { QUARTO_RUN_NO_NETWORK: "true" },
      }),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(encoder.encode(input));
  await writer.close();
  const result = await child.output();
  if (!result.success) {
    fail("CONDITION_WRITER", "Native Pandoc " + decoder.decode(result.stderr));
  }
  if (result.stdout.length > 16 * 1024 * 1024) {
    fail("CONDITION_LIMIT", "Слишком большой writer output");
  }
  return decoder.decode(result.stdout);
}
function nativeReference(
  value: unknown,
): { token: string; key: string; style: string } | undefined {
  if (
    (!isLink(value) && !isContainer(value)) ||
    (value.t !== "Link" && value.t !== "Span")
  ) return undefined;
  const attr = value.c[0];
  const key = attr[2].find(([name]) => name === "data-qrc-ref")?.[1];
  if (!key) return undefined;
  const style = attr[2].find(([name]) => name === "data-qrc-style")?.[1] ??
    "default";
  return catalogueReference(key, style);
}
function assertSourcePath(
  state: PlanState,
  audience: "student" | "full",
  path: string,
) {
  const context = state.context;
  if (audience === "student") state.publicSource?.(path);
  if (toolCachePath(context.owner, path)) {
    fail("ARTIFACT_SOURCE", "Tool cache source в выдаче");
  }
  const parts = relative(context.owner, path).split("/");
  if (parts.some((p) => excluded.has(p))) {
    fail("ARTIFACT_SOURCE", "Служебный/generated source в выдаче");
  }
  if (
    audience === "student" &&
    relative(context.owner, path).split("/").some((p) => privateNames.has(p))
  ) fail("ARTIFACT_PRIVATE", "Закрытый source partition в student");
  if (audience === "student" && parts.some(publicExcluded)) {
    fail("ARTIFACT_SOURCE", "Source/config/generated файл в student");
  }
}
async function readSource(
  state: PlanState,
  audience: "student" | "full",
  path: string,
) {
  assertSourcePath(state, audience, path);
  if (audience === "student" && state.publicSource) {
    const info = await Deno.lstat(path);
    state.publicSource.assertIdentity(JSON.stringify([info.dev, info.ino]));
  }
  const context = state.context;
  state.metrics.fileReads++;
  return await readProjectContextFile(context, path);
}

async function parsedFragment(
  state: PlanState,
  audience: "student" | "full",
  path: string,
) {
  const cached = state.fragments.get(path);
  if (cached) return structuredClone(cached);
  const text = decoder.decode(await readSource(state, audience, path));
  if (text.includes("{{<") || text.includes("{{%")) {
    fail(
      "CONDITION_UNQUALIFIED",
      "Quarto shortcode в Markdown fragment требует native разрешения",
    );
  }
  const raw: unknown = JSON.parse(
    await pandoc(state, "markdown", "json", text),
  );
  boundDocument(raw);
  const doc = decode(PandocDocumentSchema, raw, "DOCUMENT_AST", path);
  state.fragments.set(path, structuredClone(doc.blocks));
  return doc.blocks;
}
function assertConditionBinding(
  state: PlanState,
  plan: ProjectPlan,
  condition: MaterializableCondition,
  originalCondition: MaterializableCondition = condition,
) {
  const context = state.context;
  if ("kind" in condition) {
    assertAssignmentConditionPlan(originalCondition, plan);
    if (
      condition.context.projection !== "author" ||
      condition.audience !== "student" ||
      context.format !== condition.context.format ||
      !["html", "revealjs"].includes(context.format) ||
      JSON.stringify(context.profiles) !==
        JSON.stringify(condition.context.profiles)
    ) {
      fail(
        "CONDITION_BINDING",
        "Assignment actual context/format/profiles отличаются",
      );
    }
  } else {
    if (
      context.format !== condition.context.format ||
      condition.view !== condition.context.projection ||
      (plan.audience === "student" && condition.view !== "student")
    ) {
      fail(
        "CONDITION_BINDING",
        "Condition/project format/projection отличаются",
      );
    }
    if (
      condition.context.format !== "html" ||
      !["student", "author"].includes(condition.view)
    ) {
      fail(
        "CONDITION_UNQUALIFIED",
        "Native condition materialization требует HTML",
      );
    }
  }
  // The code-project identity must be the actual exercise declaration binding.
  const conditionSource = resolve(context.owner, condition.context.input);
  if (!inside(context.owner, conditionSource)) {
    fail("CONDITION_BINDING", "Condition input вне owner");
  }
  const declaredProject = condition.project
    ? resolve(
      condition.project.startsWith("/")
        ? context.owner
        : dirname(conditionSource),
      condition.project.replace(/^\//, ""),
    )
    : undefined;
  if (
    !declaredProject ||
    declaredProject !== context.input
  ) fail("CONDITION_BINDING", "Condition ссылается на другой code-project");
  return conditionSource;
}
export async function materializationClosure(
  plan: ProjectPlan,
  condition: MaterializableCondition,
): Promise<MaterializationClosure> {
  const state = await projectPlanState(plan), context = state.context;
  await assertNativeValue(condition, context.owner);
  await assertProjectPublicRoles(plan, state);
  assertConditionBinding(state, plan, condition);
  const fragments: MaterializationClosure["fragments"] = [];
  function entry(
    source: string,
    kind: "condition" | "gradle" | "local",
    baseKind: "document" | "definition" | "project",
    body: unknown[],
  ) {
    const links = new Set<string>(),
      resources = new Set<string>(),
      references = new Map<
        string,
        { token: string; key: string; style: string }
      >();
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      const citations = catalogueCitations(value);
      for (const { reference } of citations ?? []) {
        links.add(reference.token);
        references.set(reference.token, reference);
      }
      const ref = nativeReference(value);
      if (ref) {
        links.add(ref.token);
        references.set(ref.token, ref);
      }
      if (
        !ref && isNode(value) && (value.t === "Link" || value.t === "Image")
      ) {
        if (!isLink(value)) fail("CONDITION_NODE", "Повреждённый URL");
        (value.t === "Link" ? links : resources).add(value.c[2][0]);
      }
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) {
          for (const item of child) visit(item);
        } else visit(child);
      }
    }
    visit(body);
    for (const url of links) {
      if (
        url.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(url) ||
        url.startsWith("//")
      ) continue;
      let path: string;
      try {
        path = decodeURIComponent(url.replace(/[?#].*$/, ""));
      } catch {
        fail("RESOURCE_PATH", "Некорректный URL");
      }
      if (/\.(qmd|rmd|ipynb)$/i.test(path)) continue;
      const resolved = resolve(
        path.startsWith("/")
          ? context.owner
          : dirname(resolve(context.owner, source)),
        path.replace(/^\//, ""),
      );
      if (
        inside(context.owner, resolved) &&
        projectFileExists(context, resolved)
      ) resources.add(url);
    }
    fragments.push({
      source,
      kind,
      baseKind,
      links: [...links].sort(),
      resources: [...resources].sort(),
      references: [...references.values()],
    });
  }
  entry(
    relative(context.owner, resolve(context.owner, condition.context.input)),
    "condition",
    "document",
    condition.body,
  );
  for (const kind of ["gradle", "local"] as const) {
    const path = state[kind];
    if (path) {
      assertAssignmentArtifactSource(condition, path);
      entry(
        relative(context.owner, path),
        kind,
        "document",
        await parsedFragment(state, plan.audience, path),
      );
    }
  }
  await assertProjectContext(context);
  await assertNativeValue(condition, context.owner);
  return immutableClosure(MaterializationClosureSchema.parse({ fragments }));
}
function immutableClosure(value: MaterializationClosure) {
  for (const item of value.fragments) {
    Object.freeze(item.links);
    Object.freeze(item.resources);
    for (const ref of item.references) Object.freeze(ref);
    Object.freeze(item.references);
    Object.freeze(item);
  }
  Object.freeze(value.fragments);
  return Object.freeze(value);
}
export function materializeProject(
  plan: ProjectPlan,
  condition: MaterializableCondition,
  bindings: MaterializationBindings,
) {
  return materialize(plan, condition, bindings, "project");
}
export function materializeCondition(
  plan: ProjectPlan,
  condition: MaterializableCondition,
  bindings: MaterializationBindings,
) {
  return materialize(plan, condition, bindings, "conditions");
}
/** One writer for the complete late condition and every origin-bearing fragment. */
async function materialize(
  plan: ProjectPlan,
  conditionValue: MaterializableCondition,
  bindingsValue: MaterializationBindings,
  kind: "project" | "conditions",
): Promise<ArtifactFiles> {
  const state = await projectPlanState(plan), context = state.context;
  await assertNativeValue(conditionValue, context.owner);
  boundDocument(conditionValue);
  boundInput(bindingsValue);
  const condition = decode(
    MaterializableConditionSchema,
    conditionValue,
    "CONDITION_CONTRACT",
  );
  const bindings = decode(
    MaterializationBindingsSchema,
    bindingsValue,
    "ARTIFACT_BINDINGS",
  );
  const conditionSource = assertConditionBinding(
    state,
    plan,
    condition,
    conditionValue,
  );
  await assertProjectPublicRoles(plan, state);
  const key = JSON.stringify({ condition, bindings, kind });
  const cached = state.cache.get(key);
  if (cached) {
    state.metrics.cacheHits++;
    await assertProjectContext(context);
    await assertNativeValue(conditionValue, context.owner);
    return copyArtifactFiles(cached);
  }
  const files = new Map<string, ArtifactFile>();
  const provenance = new Map<string, string>();
  const add = async (
    target: string,
    bytes: Uint8Array,
    reason: string,
    source?: string,
  ) => {
    assertArtifactTarget(target, plan.audience, context.owner);
    if (files.size >= 4096 || bytes.length > 128 * 1024 * 1024) {
      fail("ARTIFACT_LIMIT", "Превышен лимит файлов/байтов");
    }
    if (
      files.has(target) ||
      [...files.keys()].some((p) =>
        p.startsWith(target + "/") || target.startsWith(p + "/")
      )
    ) fail("ARTIFACT_COLLISION", "Два владельца target " + target);
    files.set(target, {
      target,
      bytes: new Uint8Array(bytes),
      audience: plan.audience,
      reason,
    });
    if (source) provenance.set(target, source);
  };
  const read = (path: string) => {
    if (plan.audience === "student") {
      assertAssignmentArtifactSource(conditionValue, path);
    }
    return readSource(state, plan.audience, path);
  };
  async function collectProjectFiles() {
    if (kind === "project") {
      for (const file of state.files) {
        await add(file.target, await read(file.path), file.reason, file.path);
      }
      for (const tree of state.trees) {
        if (
          plan.audience === "student" &&
          relative(context.owner, tree.path).split("/").some((p) =>
            privateNames.has(p)
          )
        ) fail("ARTIFACT_PRIVATE", "Закрытый source partition в student");
        const paths = await projectContextFiles(
          context,
          tree.path,
          () => state.metrics.treeWalks++,
        );
        for (const path of paths) {
          const name = relative(tree.path, path), parts = name.split("/");
          if (path === state.local && name === "README.md") continue;
          if (parts.some((p) => privateNames.has(p))) {
            fail(
              "ARTIFACT_PRIVATE",
              "Закрытый partition внутри выдаваемого tree",
            );
          }
          if (plan.audience === "student" && parts.some(publicExcluded)) {
            continue;
          }
          if (
            parts.some((p) =>
              excluded.has(p) || p.startsWith(".") && p !== ".gitignore"
            )
          ) continue;
          if (
            /\.(qmd|rmd|ipynb|class|jar|pyc)$/i.test(name) ||
            parts.some((p) => /^_quarto|^_metadata\.ya?ml$/.test(p))
          ) continue;
          await add(tree.prefix + name, await read(path), tree.reason, path);
        }
      }
    }
  }
  await collectProjectFiles();
  const resources = new Map<string, string>();
  const resourceBytes = new Map<string, Uint8Array>();
  const anchors = new Set<string>();
  const localLinks = new Set<string>();
  async function collectResource(
    resource: { path: string; target: string },
    path: string,
    canonical: string,
  ) {
    const previous = resources.get(resource.target);
    if (previous && previous !== path) {
      fail(
        "ARTIFACT_COLLISION",
        "Resource target имеет разные origins: " + resource.target,
      );
    }
    if (!previous) {
      resources.set(resource.target, path);
      if (files.has(resource.target)) {
        resourceBytes.set(
          resource.target,
          new Uint8Array(files.get(resource.target)!.bytes),
        );
        if (provenance.get(resource.target) !== path) {
          fail(
            "ARTIFACT_COLLISION",
            "Resource target уже принадлежит другому source: " +
              resource.target,
          );
        }
      } else {
        assertArtifactTarget(resource.target, plan.audience, context.owner);
        assertSourcePath(state, plan.audience, path);
        let bytes: Uint8Array;
        if (projectFileExists(context, path)) bytes = await read(path);
        else {
          const observed = await readNativeResource(
            conditionValue,
            context.owner,
            canonical,
            resource.target,
            state.publicSource?.assertIdentity,
          );
          if (!observed) {
            fail(
              "RESOURCE_MISSING",
              "Нет captured/observed текущих bytes ресурса: " + canonical,
            );
          }
          bytes = observed;
        }
        resourceBytes.set(resource.target, new Uint8Array(bytes));
        await add(resource.target, bytes, "condition-resource", path);
      }
    }
  }
  const mapUrl = async (
    url: string,
    base: string | undefined,
    image: boolean,
  ): Promise<string> => {
    if (url.startsWith("#")) {
      localLinks.add(url.slice(1));
      return url;
    }
    if (base && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) {
      let local: string;
      try {
        local = decodeURIComponent(url.split(/[?#]/)[0] ?? "");
      } catch {
        fail("RESOURCE_PATH", "Некорректный URL ресурса");
      }
      assertAssignmentArtifactSource(
        conditionValue,
        resolve(
          local.startsWith("/") ? context.owner : dirname(base),
          local.replace(/^\//, ""),
        ),
      );
    }
    const scoped = base
      ? bindings.linksBySource[relative(context.owner, base)]?.[url]
      : undefined;
    if (!image && scoped) return checkedLink(scoped);
    if (!image && Object.hasOwn(bindings.links, url)) {
      return checkedLink(bindings.links[url]!);
    }
    if (url.startsWith("course-reference:")) {
      fail("CONDITION_LINK", "Нет конечного owner binding ссылки каталога");
    }
    if (/^(https?:|mailto:)/.test(url) && !image) return checkedLink(url);
    if (!base) {
      fail(
        "FRAGMENT_BASE",
        "Для относительной ссылки фрагмента нужна явная база: " + url,
      );
    }
    const suffix = url.match(/[?#].*$/)?.[0] ?? "";
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.slice(0, url.length - suffix.length));
    } catch {
      fail("RESOURCE_PATH", "Некорректный URL ресурса");
    }
    const expected = resolve(
      pathname.startsWith("/") ? context.owner : dirname(base),
      pathname.replace(/^\//, ""),
    );
    if (!inside(context.owner, expected)) {
      fail("RESOURCE_PATH", "Resource выходит из owner: " + url);
    }
    const canonical = relative(context.owner, expected);
    const explicitResource = bindings.resources[canonical] ??
      bindings.resources[url];
    const resource = explicitResource ??
      { path: canonical, target: "resources/" + canonical };
    if (!resource) {
      fail("RESOURCE_MISSING", "Нет конечного binding ресурса: " + canonical);
    }
    const path = resolve(context.owner, resource.path);
    if (path !== expected) {
      fail(
        "RESOURCE_BASE",
        "Binding не соответствует собственной базе фрагмента: " + canonical,
      );
    }
    if (/\.(qmd|rmd|ipynb)$/i.test(canonical)) {
      if (image || explicitResource) {
        fail("ARTIFACT_SOURCE", "Source document не является resource bytes");
      }
      fail("CONDITION_LINK", "Нужен конечный destination документа: " + url);
    }
    await collectResource(resource, path, canonical);
    return resource.target + suffix;
  };
  function checkedLink(url: string) {
    if (url.startsWith("#")) {
      localLinks.add(url.slice(1));
      return url;
    }
    if (/^(https?:|mailto:)/.test(url) && !/[\u0000-\u0020<>]/.test(url)) {
      return url;
    }
    if (
      url.startsWith("#") ||
      (!url.startsWith("/") && !/[\\\0:\u0000-\u0020<>]/.test(url) &&
        !url.split("/").some((p) => p === ".." || p === "."))
    ) return url;
    fail("CONDITION_LINK", "Недопустимый конечный link target");
  }
  const transform = async (
    value: unknown,
    base: string | undefined,
  ): Promise<unknown> => {
    if (Array.isArray(value)) {
      const out = [];
      for (const v of value) out.push(await transform(v, base));
      return out;
    }
    if (!isRecord(value)) return value;
    const citations = catalogueCitations(value);
    if (citations) {
      const resolved = new Map<string, { href: string; label: string }>();
      for (const { reference } of citations) {
        const binding = base
          ? bindings.referencesBySource[relative(context.owner, base)]
            ?.[reference.token]
          : undefined;
        if (!binding) {
          fail(
            "CONDITION_REFERENCE_UNRESOLVED",
            "Для catalogue Cite нужен owner binding {href,label}: " +
              reference.key,
          );
        }
        resolved.set(reference.token, binding);
      }
      return {
        t: "Span",
        c: [
          ["", [], []],
          await transform(
            catalogueCiteInlines(citations, (ref) => {
              const binding = resolved.get(ref.token)!;
              return {
                t: "Link",
                c: [["", [], []], [{ t: "Str", c: binding.label }], [
                  checkedLink(binding.href),
                  "",
                ]],
              };
            }),
            base,
          ),
        ],
      };
    }
    const ref = nativeReference(value);
    if (ref) {
      if (!isLink(value) && !isContainer(value)) {
        fail("DOCUMENT_AST", "Повреждённый native reference");
      }
      const attr = structuredClone(value.c[0]);
      attr[1] = attr[1].filter((c: string) =>
        !["qrc-reference", "qrc-link"].includes(c)
      );
      attr[2] = attr[2].filter((p) => !p[0].startsWith("data-qrc-"));
      const binding = base
        ? bindings.referencesBySource[relative(context.owner, base)]
          ?.[ref.token]
        : undefined;
      const custom = value.c[0][2].some((p: string[]) =>
        p[0] === "data-qrc-custom" && p[1] === "true"
      );
      return {
        t: "Link",
        c: [
          attr,
          binding && !custom
            ? [{ t: "Str", c: binding.label }]
            : await transform(value.c[1], base),
          [
            binding
              ? checkedLink(binding.href)
              : await mapUrl(ref.token, base, false),
            "",
          ],
        ],
      };
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = await transform(v, base);
    }
    nodeAttributes(result);
    if (isLink(result)) {
      result.c[2][0] = await mapUrl(result.c[2][0], base, result.t === "Image");
    }
    if (
      typeof result.t === "string" &&
      ["Header", "Div", "Span", "CodeBlock"].includes(result.t)
    ) {
      const attr = nodeAttributes(result);
      if (Array.isArray(attr) && typeof attr[0] === "string" && attr[0]) {
        if (!attr[0] || /[\u0000-\u0020'"<>&]/u.test(attr[0])) {
          fail("CONDITION_ANCHOR", "Непереносимый anchor");
        }
        if (anchors.has(attr[0])) {
          fail("CONDITION_ANCHOR", "Повторный anchor " + attr[0]);
        }
        anchors.add(attr[0]);
        // Explicit anchors survive Pandoc GFM even when its heading identifier differs.
        const anchor = '<a id="' + attr[0] + '"></a>';
        attr[0] = "";
        if (result.t === "Span") {
          return {
            t: "Span",
            c: [["", [], []], [
              { t: "RawInline", c: ["html", anchor] },
              result,
            ]],
          };
        }
        return {
          t: "Div",
          c: [["", [], []], [{ t: "RawBlock", c: ["html", anchor] }, result]],
        };
      }
    }
    return result;
  };
  const blocks = requireNodes(await transform(condition.body, conditionSource));
  if (condition.anchor) {
    if (
      /[\u0000-\u0020'"<>&]/u.test(condition.anchor) ||
      anchors.has(condition.anchor)
    ) {
      fail(
        "CONDITION_ANCHOR",
        "Некорректный/повторный native occurrence anchor",
      );
    }
    anchors.add(condition.anchor);
    blocks.unshift({
      t: "RawBlock",
      c: ["html", '<a id="' + condition.anchor + '"></a>'],
    });
  }
  const fragment = async (path: string) => {
    assertAssignmentArtifactSource(conditionValue, path);
    return requireNodes(
      await transform(
        await parsedFragment(state, plan.audience, path),
        path,
      ),
    );
  };
  if (state.gradle) blocks.push(...await fragment(state.gradle));
  if (state.local) blocks.push(...await fragment(state.local));
  const rawSubmission: unknown = JSON.parse(
    await pandoc(state, "markdown", "json", bindings.submission.instructions),
  );
  boundDocument(rawSubmission);
  const submissionDoc = decode(
    PandocDocumentSchema,
    rawSubmission,
    "DOCUMENT_AST",
  );
  blocks.push(
    ...requireNodes([
      await transform({
        t: "Header",
        c: [2, ["submission", [], []], [{ t: "Str", c: "Сдача" }]],
      }, undefined),
    ]),
  );
  blocks.push(
    ...requireNodes(
      await transform(
        submissionDoc.blocks,
        bindings.submissionBase
          ? resolve(context.owner, bindings.submissionBase)
          : undefined,
      ),
    ),
  );
  for (const item of bindings.submission.files) {
    if (
      kind === "project" && item.starterPath && !files.has(item.starterPath)
    ) {
      fail(
        "SUBMISSION_STARTER",
        "Нет реального starter mapping: " + item.starterPath,
      );
    }
    blocks.push({
      t: "Para",
      c: [
        { t: "Code", c: [["", [], []], item.name] },
        ...(item.starterPath
          ? [{ t: "Str", c: " — " }, {
            t: "Code",
            c: [["", [], []], item.starterPath],
          }]
          : []),
      ],
    });
  }
  const gfm = await pandoc(
    state,
    "json",
    "gfm",
    JSON.stringify({
      "pandoc-api-version": condition.pandocApiVersion,
      meta: {},
      blocks,
    }),
  );
  for (const anchor of anchors) {
    if (
      !gfm.includes('id="' + anchor + '"') && !gfm.includes("{#" + anchor + "}")
    ) {
      // Pandoc drops Div/Span attributes in GFM; refusal is safer than a broken link.
      fail("CONDITION_ANCHOR", "GFM writer потерял anchor " + anchor);
    }
  }
  for (const anchor of localLinks) {
    if (!anchors.has(anchor)) {
      fail("CONDITION_ANCHOR", "Не найден anchor конечного README: " + anchor);
    }
  }
  await add(
    "README.md",
    encoder.encode(gfm),
    "resolved-condition+gradle+local+submission",
  );
  for (const group of kind === "project" ? plan.groups : []) {
    // Every independent author build gets the same resource closure and one owner-written README.
    for (const [target, path] of resources) {
      const groupTarget = "author/" + group + "/" + target;
      if (files.has(groupTarget)) {
        if (provenance.get(groupTarget) !== path) {
          fail(
            "ARTIFACT_COLLISION",
            "Author resource target принадлежит другому source: " + groupTarget,
          );
        }
        continue;
      }
      await add(
        groupTarget,
        resourceBytes.get(target) ?? await read(path),
        "condition-resource",
        path,
      );
    }
    await add(
      "author/" + group + "/README.md",
      encoder.encode(gfm),
      "resolved-condition+gradle+local+submission",
    );
  }
  await assertProjectContext(context);
  const inventory = decode(ArtifactFilesSchema, {
    exerciseId: condition.exerciseId,
    audience: plan.audience,
    files: [...files.values()].sort((a, b) => a.target.localeCompare(b.target)),
  }, "ARTIFACT_CONTRACT");
  if (state.cache.size >= 16) {
    fail("ARTIFACT_LIMIT", "Не более 16 вариантов на один явный plan");
  }
  await assertNativeValue(conditionValue, context.owner);
  state.cache.set(key, copyArtifactFiles(inventory));
  return inventory;
}
/** Final consumer IO boundary accepts the public bytes DTO, not a private receipt. */
export async function writeArtifactFiles(
  value: ArtifactFiles,
  destination: string,
): Promise<ArtifactWriteResult> {
  if (!value || !Array.isArray(value.files) || value.files.length > 4096) {
    fail("ARTIFACT_CONTRACT", "Некорректный inventory");
  }
  const decoded = decode(
    ArtifactFilesDataSchema,
    value,
    "ARTIFACT_CONTRACT",
  );
  const inventory = copyArtifactFiles(decoded);
  const targets = new Set<string>();
  let total = 0;
  for (const file of inventory.files) {
    assertArtifactTarget(file.target, inventory.audience);
    if (
      file.audience !== inventory.audience || targets.has(file.target) ||
      [...targets].some((t) =>
        t.startsWith(file.target + "/") || file.target.startsWith(t + "/")
      )
    ) fail("ARTIFACT_COLLISION", "Inventory target/audience collision");
    targets.add(file.target);
    total += file.bytes.length;
    if (total > 512 * 1024 * 1024) {
      fail("ARTIFACT_LIMIT", "Inventory превышает лимит");
    }
  }
  const output = resolve(
    decode(ArtifactDestinationSchema, destination, "ARTIFACT_OUTPUT"),
  );
  await safeParent(output);
  if (!await absent(output)) {
    fail("ARTIFACT_OUTPUT", "Выходной каталог должен быть новым");
  }
  await Deno.mkdir(dirname(output), { recursive: true });
  await real(dirname(output));
  await Deno.mkdir(output);
  try {
    for (const file of inventory.files) {
      const path = join(output, file.target);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeFile(path, file.bytes, { createNew: true });
    }
  } catch (error) {
    await Deno.remove(output, { recursive: true });
    throw error;
  }
  return ArtifactWriteResultSchema.parse({
    files: inventory.files.length,
    bytes: total,
  });
}
