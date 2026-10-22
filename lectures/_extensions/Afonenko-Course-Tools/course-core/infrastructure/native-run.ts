import {createMetrics as __createMetrics} from "../observability/bridge.ts";
const __metrics=__createMetrics("course-core");
import { diagnostic } from "../domain/diagnostics.ts";
import { isAbsolute, join, relative, resolve } from "stdlib/path";
import type {
  Adapter,
  AdapterFragment,
  DocumentResult,
} from "../domain/model.ts";
import { child, exists } from "./files.ts";
import {
  cleanHiddenResourceOutputs,
  normalizeResourceFacts,
  validateCapturedResources,
} from "./resources.ts";
import {produceCommonPathBinding,readCommonPathBinding,validateCapturedCommon,stable} from "./common-path-binding.ts";
import {validateCompletedExportScope} from './native-export-retirement.ts';
export interface NativeRunPointer {
  schema: "course-native-run-pointer-v2";
  directory: string;
  projectRoot: string;
  profiles: string[];
  outputDirectory: string;
  initialInputFiles?: string[];
  renderAll: boolean;
  configurationHashes: Record<string,string|false>;
  commonPathBinding: {file:"common-files-path-binding.json";sha1:string;sha256:string};
  commonPathRetirement?: {profile:string;file:string;sha1:string;sha256:string};
}
export interface NativeRun {
  schema: "course-native-run-v1";
  renderAll: boolean;
  projectRoot: string;
  outputDirectory: string;
  profiles: string[];
  documents: DocumentResult[];
  adapters: Adapter[];
  outputFiles: string[];
  inputFiles: string[];
}
export interface NativeRunExpectation {
  profiles?: string[];
  view?: "student" | "full";
  outputDirectory?: string;
}
const base = (root: string) => join(root, "_generated/course-spec");
const read = async (path: string) => JSON.parse(await Deno.readTextFile(path));
const profiles = () =>
  (Deno.env.get("QUARTO_PROFILE") || "").split(/[, ]+/).filter(Boolean);
async function contained(root: string, path: string) {
  const real = await Deno.realPath(path);
  if (real !== root) child(root, real);
  return real;
}
async function configurationHashes(root:string,activeProfiles:string[]):Promise<Record<string,string|false>>{
  const names=["_quarto.yml","_quarto.yaml",...activeProfiles.flatMap(profile=>["_quarto-"+profile+".yml","_quarto-"+profile+".yaml"])];
  const hashes:Record<string,string|false>={};
  for(const name of names){
    try{
      const bytes=await Deno.readFile(child(root,name));
      const digest=await crypto.subtle.digest("SHA-1",bytes);
      hashes[name]=Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("");
    }catch(error){if(error instanceof Deno.errors.NotFound)hashes[name]=false;else throw error;}
  }
  return hashes;
}
async function validatedPointer(root: string): Promise<{pointer:NativeRunPointer;witness:Awaited<ReturnType<typeof readCommonPathBinding>>}> {
  const p = await read(join(base(root), "active-native-run.json"));
  if (p.schema !== "course-native-run-pointer-v2" || p.projectRoot !== root) {
    throw diagnostic("NATIVE.RUN_POINTER_INVALID", "Указатель текущей native-сборки некорректен", {source: root, field: "native-run"});
  }
  if(Object.keys(p).some(k=>!['schema','directory','projectRoot','profiles','outputDirectory','initialInputFiles','renderAll','configurationHashes','commonPathBinding','commonPathRetirement'].includes(k))||!Array.isArray(p.profiles)||p.profiles.some((x:unknown)=>typeof x!=='string'||!/^[-a-zA-Z0-9_]+$/.test(x))||typeof p.renderAll!=='boolean')throw diagnostic('NATIVE.RUN_POINTER_INVALID','Некорректная private pointer schema',{source:root,field:'native-run'});
  child(join(base(root), "native-runs"), p.directory);
  await contained(root, p.directory);
  const current=Array.isArray(p.profiles)?await configurationHashes(root,p.profiles):{};
  if(!Array.isArray(p.profiles) || !p.configurationHashes || Object.keys(current).length!==Object.keys(p.configurationHashes).length || Object.entries(current).some(([name,hash])=>p.configurationHashes[name]!==hash)) {
    throw diagnostic("NATIVE.RUN_NOT_CURRENT","Нативная конфигурация изменилась после начала запуска",{source:root,field:"native-run"});
  }
  const witness=await readCommonPathBinding(p);
  return {pointer:p,witness};
}
async function pointer(root:string):Promise<NativeRunPointer>{return (await validatedPointer(root)).pointer}
async function list(root: string, key: string) {
  const mode = Deno.env.get(
    key.replace("QUARTO_PROJECT_", "QUARTO_USE_FILE_FOR_PROJECT_"),
  );
  const content = mode
    ? await Deno.readTextFile(mode)
    : Deno.env.get(key) || "";
  const values = content.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(values.map((path) => resolve(root, path)))];
}
export async function currentNativeOutputs(
  projectRoot: string,
): Promise<string[]> {
  return await list(projectRoot, "QUARTO_PROJECT_OUTPUT_FILES");
}
export async function beginNativeRun(
  projectRoot: string,
): Promise<NativeRunPointer> {
  const root = await Deno.realPath(projectRoot),
    outputDirectory = resolve(
      root,
      Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR") || ".",
    );
  if (outputDirectory !== root) child(root, outputDirectory);
  await Deno.mkdir(base(root), { recursive: true });
  await contained(root, base(root));
  for (
    const name of ["active-native-run.json", "native-run.json", "course.json", "course-candidate.json"]
  ) {
    const path = join(base(root), name);
    if (await exists(path)) await Deno.remove(path);
  }
  const runs = join(base(root), "native-runs");
  await Deno.mkdir(runs, { recursive: true });
  await contained(root, runs);
  if (await exists(outputDirectory)) await contained(root, outputDirectory);
  const directory = join(runs, crypto.randomUUID());
  await Deno.mkdir(join(directory, "documents"), { recursive: true });
  await Deno.mkdir(join(directory, "adapters"));
  const p = {
    schema: "course-native-run-pointer-v2",
    projectRoot: root,
    directory,
    profiles: profiles(),
    outputDirectory,
    initialInputFiles: await list(root, "QUARTO_PROJECT_INPUT_FILES"),
    renderAll: Deno.env.get("QUARTO_PROJECT_RENDER_ALL") === "1",
    configurationHashes:await configurationHashes(root,profiles()),
  } as NativeRunPointer;
  p.commonPathBinding=await produceCommonPathBinding(p);
  await Deno.writeTextFile(
    join(base(root), "active-native-run.json"),
    JSON.stringify(p),
  );
  return p;
}
export async function finishNativeRun(projectRoot: string): Promise<NativeRun> {
  const root = await Deno.realPath(projectRoot), p = await pointer(root);
  const complete = join(base(root), "native-run.json");
  if (await exists(complete)) await Deno.remove(complete);
  if (JSON.stringify(p.profiles) !== JSON.stringify(profiles())) {
    throw diagnostic("NATIVE.PROFILES_CHANGED", "Профили изменились во время сборки", {source: root, field: "native-run"});
  }
  const outputFiles = await currentNativeOutputs(root);
  if (!outputFiles.length) throw diagnostic("NATIVE.NO_CURRENT_OUTPUTS", "У сборки нет текущих выходных файлов", {source: root, field: "native-run"});
  for (const path of outputFiles) {
    if (path !== p.outputDirectory) child(p.outputDirectory, path);
    await contained(root, path);
    if (!(await Deno.stat(path)).isFile) {
      throw diagnostic("NATIVE.OUTPUT_NOT_FILE", "Выходной путь не является файлом: " + path, {source: root, field: "native-run"});
    }
  }
  const documents: DocumentResult[] = [];
  const intermediateOutputs = new Map<string, string>();
  for await (const e of Deno.readDir(join(p.directory, "documents"))) {
    if (!e.isFile || !e.name.endsWith(".json")) continue;
    const d: DocumentResult = await read(
      join(p.directory, "documents", e.name),
    );
    if (
      d.scope !== "document" || d.source !== d.document?.source ||
      JSON.stringify(d.document.profiles) !== JSON.stringify(p.profiles)
    ) throw diagnostic("NATIVE.DOCUMENT_INVALID", "Контекст входного документа не соответствует текущей сборке", {source: d.source, field: "document"});
    const input = child(root, d.source);
    let out = resolve(p.outputDirectory, d.document.output);
    // Quarto's JSON writer reports an authored output-file beside the input
    // before project relocation. Accept only its exact relocated file from
    // this run's native inventory, never a guessed or previously saved output.
    if (d.document.exportContext === true && d.document.format === "json" && !outputFiles.includes(out)) {
      child(root, out);
      const relocated = child(p.outputDirectory, relative(root, out));
      if (outputFiles.includes(relocated)) {
        intermediateOutputs.set(d.source + "\0" + d.document.format, d.document.output);
        d.document.output = relative(p.outputDirectory, relocated).replaceAll("\\", "/");
        out = relocated;
      }
    }
    child(p.outputDirectory, out);
    await contained(root, input);
    // Pandoc reports the native LaTeX intermediate before Quarto builds the PDF.
    // Bind only its exact final stem present in this process's public inventory.
    if (
      !outputFiles.includes(out) && d.document.format === "latex" &&
      /\.tex$/i.test(out)
    ) {
      const pdf = out.replace(/\.tex$/i, ".pdf");
      if (outputFiles.includes(pdf)) {
        intermediateOutputs.set(
          d.source + "\0" + d.document.format,
          d.document.output,
        );
        d.document.output = relative(p.outputDirectory, pdf).replaceAll(
          "\\",
          "/",
        );
        out = pdf;
      }
    }
    if (!outputFiles.includes(out)) {
      throw diagnostic("NATIVE.DOCUMENT_NOT_CURRENT", "Документ не связан с текущим выходным файлом: " + d.source, {source: d.source, field: "document"});
    }
    if (d.document.exportContext === true && d.document.format === "json" && documents.some(existing => resolve(p.outputDirectory, existing.document.output) === out)) {
      throw diagnostic("NATIVE.DUPLICATE_OUTPUT", "Несколько исходных документов используют один выходной файл: " + d.document.output, {source: d.source, field: "output-file"});
    }
    if (
      documents.some((x) =>
        x.source === d.source && x.document.format === d.document.format
      )
    ) throw diagnostic("NATIVE.DUPLICATE_DOCUMENT", "Повторный документ одного формата", {source: d.source, field: "document"});
    if (d.resources) {
      d.resources = normalizeResourceFacts(d.resources);
      if (
        d.resources.source !== d.source ||
        resolve(d.resources.outputDirectory) !== p.outputDirectory
      ) {
        throw diagnostic("NATIVE.RESOURCE_CONTEXT_INVALID", "Ресурс относится к другому документу или выходному каталогу", {source: d.source, field: "document"});
      }
      for (const file of d.resources.capturedFiles || []) {
        if (file.capture) {
          await contained(p.directory, child(p.directory, file.capture));
        }
      }
      await validateCapturedResources(root, d.resources);
    }
    documents.push(d);
  }
  if (documents.length) {
    for (const output of outputFiles) {
      if (
        /\.html?$/i.test(output) &&
        !documents.some((d) =>
          resolve(p.outputDirectory, d.document.output) === output
        )
      ) throw diagnostic("NATIVE.MISSING_DOCUMENT", "Для текущего HTML не найден результат Core: " + output, {source: root, field: "native-run"});
    }
  }
  await cleanHiddenResourceOutputs(
    root,
    documents.flatMap((d) => d.resources ? [d.resources] : []),
  );
  const inputFiles = documents.length
    ? documents.map((d) => resolve(root, d.source))
    : p.initialInputFiles || [];
  const adapters: Adapter[] = [];
  for await (const e of Deno.readDir(join(p.directory, "adapters"))) {
    if (!e.isDirectory) continue;
    const dir = join(p.directory, "adapters", e.name),
      c = await read(join(dir, "contract.json"));
    if (
      c.name !== e.name || typeof c.rules !== "string" ||
      typeof c.directory !== "string"
    ) throw diagnostic("NATIVE.ADAPTER_CONTRACT_INVALID", "Некорректный контракт установленного адаптера", {source: root, field: "native-run"});
    child(c.directory, c.rules);
    await contained(root, c.directory);
    const fragments = new Map<string, AdapterFragment>();
    for await (const f of Deno.readDir(dir)) {
      if (
        !f.isFile || f.name === "contract.json" || !f.name.endsWith(".json")
      ) continue;
      const v = await read(join(dir, f.name));
      const d = documents.find((x) => x.source === v.source);
      if (
        d && intermediateOutputs.has(d.source + "\0" + d.document.format) &&
        v.document?.output ===
          intermediateOutputs.get(d.source + "\0" + d.document.format)
      ) {
        v.document.output = d.document.output;
      }
      if (
        !d || v.document?.source !== d.document.source ||
        v.document?.format !== d.document.format ||
        v.document?.output !== d.document.output ||
        JSON.stringify(v.document?.profiles) !==
          JSON.stringify(d.document.profiles) ||
        v.course?.id !== d.course.id || v.course?.view !== d.course.view ||
        v.adapter !== c.name || fragments.has(v.source)
      ) throw diagnostic("NATIVE.ADAPTER_NOT_CURRENT", "Фрагмент адаптера не относится к текущему документу", {source: v.source, id: c.name, field: "adapter"});
      fragments.set(v.source, v);
    }
    adapters.push({
      directory: c.directory,
      contract: { name: c.name, rules: c.rules },
      fragments,
    });
  }
  const run: NativeRun = {
    schema: "course-native-run-v1",
    renderAll: p.renderAll,
    projectRoot: root,
    outputDirectory: p.outputDirectory,
    profiles: p.profiles,
    documents,
    adapters,
    outputFiles,
    inputFiles,
  };
  await saveNativeRun(run);
  return run;
}
export async function saveNativeRun(run:NativeRun,persistDocuments=false){
  const root=await Deno.realPath(run.projectRoot),p=await pointer(root);
  for(const doc of persistDocuments?run.documents:[]){
    const digest=await crypto.subtle.digest("SHA-1",new TextEncoder().encode(doc.source+"\0"+doc.document.format));
    const filename=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("")+".json";
    const encoded=JSON.stringify(doc);
    for await(const entry of Deno.readDir(join(p.directory,"documents"))){
      if(!entry.isFile||!entry.name.endsWith(".json"))continue;
      const current=await read(join(p.directory,"documents",entry.name));
      if(current.source===doc.source&&current.document?.format===doc.document.format)await Deno.writeTextFile(join(p.directory,"documents",entry.name),encoded);
    }
    const directory=join(base(root),"documents",doc.course.view??"default");
    await Deno.mkdir(directory,{recursive:true});
    await Deno.writeTextFile(join(directory,filename),encoded);
  }
  const witness=await readCommonPathBinding(p);await validateCapturedCommon(run,witness);
  const serialized=JSON.stringify({...run,directory:p.directory,adapters:run.adapters.map(a=>({...a,fragments:[...a.fragments.values()]}))});
  await Deno.writeTextFile(join(p.directory,"native-run.json"),serialized);
  await Deno.writeTextFile(join(base(root),"native-run.json"),serialized);
  if(witness.forcedWriter){try{await validateCompletedExportScope(p,witness)}catch(e){
   for(const file of [join(p.directory,'native-run.json'),join(base(root),'native-run.json')]){try{if(await Deno.readTextFile(file)===serialized)await Deno.remove(file)}catch{}}throw e;
  }}
}
/** Rebind only the exporter-owned temporary profile's planned removal. */
export async function prepareNativeExportCleanup(projectRoot:string,profile:string){
  const root=await Deno.realPath(projectRoot),p=await pointer(root);
  const run=await read(join(p.directory,"native-run.json"));
  if(run.directory!==p.directory || !run.documents?.length || !run.documents.every((doc:DocumentResult)=>doc.document.exportContext===true) || !p.profiles.includes(profile)) {
    throw diagnostic("NATIVE.RUN_NOT_CURRENT","Нельзя завершить временную конфигурацию чужого запуска",{source:root,field:"native-run"});
  }
  const name="_quarto-"+profile+".yml";
  if(!(name in p.configurationHashes))throw diagnostic("NATIVE.RUN_NOT_CURRENT","Временный профиль отсутствует в текущем запуске",{source:root,field:"native-run"});
  const witness=await readCommonPathBinding(p),owned=witness.temporaryExportProfile;
  if(!owned||owned.profile!==profile||owned.file!==name||owned.sha1!==p.configurationHashes[name])throw diagnostic("NATIVE.RUN_NOT_CURRENT","Профиль не принадлежит generated export текущего запуска",{source:root,field:"native-run"});
  await validateCompletedExportScope(p,witness);
  p.commonPathRetirement=owned;
  p.configurationHashes[name]=false;
  await Deno.writeTextFile(join(base(root),"active-native-run.json"),JSON.stringify(p));
}
export async function loadNativeRun(
  projectRoot: string,
  expectation: NativeRunExpectation = {},
): Promise<NativeRun> {
  const root = await Deno.realPath(projectRoot),
    p = await pointer(root),
    run = await read(join(base(root), "native-run.json"));
  if (
    run.schema !== "course-native-run-v1" || run.directory !== p.directory ||
    run.projectRoot !== root
  ) throw diagnostic("NATIVE.RUN_NOT_CURRENT", "Сохранённая native-сборка не является текущей", {source: root, field: "native-run"});
  if (
    expectation.profiles &&
      JSON.stringify(expectation.profiles) !== JSON.stringify(run.profiles) ||
    expectation.view &&
      run.documents.some((d: DocumentResult) =>
        d.course.view !== expectation.view
      ) ||
    expectation.outputDirectory &&
      resolve(root, expectation.outputDirectory) !== run.outputDirectory
  ) throw diagnostic("NATIVE.EXPECTATION_MISMATCH", "Native-сборка не соответствует выбранному профилю, представлению или каталогу", {source: root, field: "native-run"});
  const witness=await readCommonPathBinding(p);await validateCapturedCommon(run,witness);
  if(witness.forcedWriter)await validateCompletedExportScope(p,witness);
  run.adapters = run.adapters.map((a: any) => ({
    ...a,
    fragments: new Map(a.fragments.map((f: AdapterFragment) => [f.source, f])),
  }));
  return run;
}

/** Внутренний мост Lua, связанный с текущим pointer, без caller override. */
export async function commonPathDocument(root:string,source:string,format:string){
 root=await Deno.realPath(root);const {witness:w}=await validatedPointer(root);
 const rows=w.documents.filter(d=>d.source===source&&d.format===format);
 if(rows.length!==1)throw diagnostic('NATIVE.COMMON_PATH_BINDING_INVALID','Неизвестный source/format текущего witness',{source,field:'native-run'});
 return rows[0];
}
/** Произвольный retained NativeRun не разрешает materialization общих файлов. */
export async function assertCommonPathRun(run:NativeRun){
 const root=await Deno.realPath(run.projectRoot),p=await pointer(root),w=await readCommonPathBinding(p);
 const current=await read(join(p.directory,'native-run.json'));
 if(current.projectRoot!==run.projectRoot||current.outputDirectory!==run.outputDirectory||current.renderAll!==run.renderAll||stable(current.profiles)!==stable(run.profiles)||stable(current.documents)!==stable(run.documents)||stable(current.inputFiles)!==stable(run.inputFiles)||stable(current.outputFiles)!==stable(run.outputFiles))throw diagnostic('NATIVE.RUN_NOT_CURRENT','NativeRun не совпадает с текущим captured proof',{source:root,field:'native-run'});
 await validateCapturedCommon(run,w);if(w.forcedWriter)await validateCompletedExportScope(p,w);return w;
}

// @ts-expect-error JS допускает замену function binding; сигнатура публичного API сохраняется.
currentNativeOutputs=__metrics.wrapAsync({id:"course-core.infrastructure.native-run.currentNativeOutputs",kind:"io"},currentNativeOutputs);
// @ts-expect-error JS допускает замену function binding; сигнатура публичного API сохраняется.
beginNativeRun=__metrics.wrapAsync({id:"course-core.infrastructure.native-run.beginNativeRun",kind:"io"},beginNativeRun);
// @ts-expect-error JS допускает замену function binding; сигнатура публичного API сохраняется.
finishNativeRun=__metrics.wrapAsync({id:"course-core.infrastructure.native-run.finishNativeRun",kind:"io"},finishNativeRun);
// @ts-expect-error JS допускает замену function binding; сигнатура публичного API сохраняется.
saveNativeRun=__metrics.wrapAsync({id:"course-core.infrastructure.native-run.saveNativeRun",kind:"io"},saveNativeRun);
// @ts-expect-error JS допускает замену function binding; сигнатура публичного API сохраняется.
prepareNativeExportCleanup=__metrics.wrapAsync({id:"course-core.infrastructure.native-run.prepareNativeExportCleanup",kind:"io"},prepareNativeExportCleanup);
// @ts-expect-error JS допускает замену function binding; сигнатура публичного API сохраняется.
loadNativeRun=__metrics.wrapAsync({id:"course-core.infrastructure.native-run.loadNativeRun",kind:"io"},loadNativeRun);
