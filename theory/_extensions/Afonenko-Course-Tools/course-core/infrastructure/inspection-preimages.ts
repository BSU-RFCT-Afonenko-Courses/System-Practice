/** Exact stock stdout, scoped only to one private native run. */
import {join,resolve} from 'stdlib/path';
import {diagnostic} from '../domain/diagnostics.ts';
import {readOwnedProfileEvidence} from './owned-export-profile.ts';
import type {CommonPathWitness} from './common-path-binding.ts';
const fail=(s:string):never=>{throw diagnostic('NATIVE.COMMON_PATH_BINDING_INVALID',s,{field:'project-materialization'})};
const hash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b).buffer)),x=>x.toString(16).padStart(2,'0')).join('');
const hex=(h:unknown):h is string=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
const stable=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
async function directory(path:string){const s=await Deno.lstat(path);if(s.isSymlink||!s.isDirectory||await Deno.realPath(path)!==path||(s.mode!==null&&(s.mode&0o7777)!==0o700))fail('Private inspection directory/type/mode: '+path)}
async function rootDirectory(root:string){if(resolve(root)!==root||await Deno.realPath(root)!==root||!(await Deno.lstat(root)).isDirectory)fail('Чужой private inspection run')}
/** Reader never creates/repairs evidence. Exact set is derived from existing refs. */
export async function checkInspectionStore(root:string,refs:ReadonlySet<string>){
 try{
 await rootDirectory(root);if([...refs].some(h=>!hex(h)))fail('Некорректный inspection ref');
 const top=join(root,'inspections'),dir=join(top,'sha256');await directory(top);await directory(dir);
 const names=async(path:string)=>{const a=[];for await(const e of Deno.readDir(path))a.push(e.name);return a.sort()};
 if(stable(await names(top))!==stable(['sha256'])||stable(await names(dir))!==stable([...refs].map(h=>h+'.json').sort()))fail('Private inspection inventory missing/extra');
 const result:Record<string,any>={};
 for(const h of refs){const path=join(dir,h+'.json'),s=await Deno.lstat(path);if(s.isSymlink||!s.isFile||await Deno.realPath(path)!==path||(s.mode!==null&&(s.mode&0o7777)!==0o600))fail('Private inspection file/type/mode');const bytes=await Deno.readFile(path);if(await hash(bytes)!==h)fail('Original inspection bytes/hash изменены');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail('Нет original stock inspection');result[h]=value;
 }return result;
 }catch(e){if((e as any)?.code==='NATIVE.COMMON_PATH_BINDING_INVALID')throw e;return fail('Private inspection evidence unavailable: '+String(e))}
}
export async function storeInspection(root:string,text:string,refs:Set<string>){
 const bytes=new TextEncoder().encode(text),h=await hash(bytes);await rootDirectory(root);
 if(!refs.size){await Deno.mkdir(join(root,'inspections'),{mode:0o700});await Deno.mkdir(join(root,'inspections/sha256'),{mode:0o700})}
 await checkInspectionStore(root,refs);
 const path=join(root,'inspections/sha256',h+'.json');
 if(refs.has(h)){const old=await Deno.readFile(path);if(old.length!==bytes.length||old.some((v,i)=>v!==bytes[i]))fail('Same-H original bytes collision')}
 else {await Deno.writeFile(path,bytes,{createNew:true,mode:0o600});refs.add(h)}
 await checkInspectionStore(root,refs);return h;
}
export function inspectionRefs(w:CommonPathWitness){
 const sources=w.inputFiles,rows=w.sourceIdentities?.sources;
 if(new Set(sources).size!==sources.length||!Array.isArray(rows)||rows.length!==sources.length||stable(rows.map(r=>r.source))!==stable(sources)||stable(Object.keys(w.documentInspectionHashes).sort())!==stable([...sources].sort()))fail('Неполный original inspection scope');
 const refs=[w.ownerInspectionHash,...Object.values(w.documentInspectionHashes),...rows.map(r=>r.physicalInspectionHash)];if(refs.some(h=>!hex(h)))fail('Некорректный original inspection hash');return new Set(refs);
}
/** Cross-role bindings use original stock shape, never an arbitrary JSON preimage. */
export async function originalInspections(w:CommonPathWitness){
 const owned=await readOwnedProfileEvidence(w);
 const all=await checkInspectionStore(w.runDirectory,inspectionRefs(w)),owner=all[w.ownerInspectionHash],physical:Record<string,any>={},lexical:Record<string,any>={};
 const object=(v:any)=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const keys=(v:any,names:string[])=>object(v)&&Object.keys(v).sort().join(',')===names.sort().join(',');
 const formats=(v:any)=>object(v)&&Object.keys(v).length>0&&Object.values(v).every((f:any)=>object(f)&&object(f.identifier)&&typeof f.identifier['target-format']==='string'&&!!f.identifier['target-format']&&typeof f.identifier['base-format']==='string'&&!!f.identifier['base-format']&&object(f.metadata));
 const configs=(v:any)=>{if(!Array.isArray(v)||v.some(x=>typeof x!=='string'||resolve(w.projectRoot,x)!==x)||new Set(v).size!==v.length)fail('Нет original config inventory');return v};
 const raw=(doc:any,path:string)=>{const v=doc.fileInformation?.[path];if(!v||!v.metadata||typeof v.metadata!=='object'||Array.isArray(v.metadata)||!Array.isArray(v.includeMap))fail('Нет original raw physical/lexical key');return v};
 if(owner.dir!==w.projectRoot||owner.quarto?.version!==w.quartoVersion||!owner.config||!owner.fileInformation||!Array.isArray(owner.files?.input)||stable(configs(owner.files.config))!==stable(w.metadataClosure.nativeConfigFiles.owner))fail('Original owner/Quarto/config role mismatch');
 for(const row of w.sourceIdentities.sources){
  const p=all[row.physicalInspectionHash],d=all[w.documentInspectionHashes[row.source]],path=resolve(w.projectRoot,row.source);physical[row.source]=p;lexical[row.source]=d;
  if(row.nativeOwner!==w.projectRoot||!owner.files.input.includes(path)||!owner.fileInformation[row.source]||p.project?.dir!==w.projectRoot||p.quarto?.version!==w.quartoVersion||!formats(p.formats)||d.project?.dir!==w.projectRoot||d.quarto?.version!==w.quartoVersion||!formats(d.formats)||stable(configs(d.project.files?.config))!==stable(w.metadataClosure.nativeConfigFiles.documents[row.source]))fail('Original physical/lexical source/owner/config mismatch');
  if(p.project.files&&Object.hasOwn(p.project.files,'config')){
   if(stable(configs(p.project.files.config))!==stable(w.metadataClosure.nativeConfigFiles.owner))fail('Original physical profile/config mismatch');
  }else if(row.linkTarget===null||row.physicalPath===path||owner.files.input.includes(row.physicalPath)||!keys(p.project.files,['input'])||!Array.isArray(p.project.files.input)||p.project.files.input.length||!keys(p.project.config,['project','engines'])||!keys(p.project.config.project,[])||!Array.isArray(p.project.config.engines)||stable(p.project.config.engines)!==stable(owner.config.engines)||!Array.isArray(p.project.engines)||p.project.engines.length||!keys(p.project.fileInformation,[])||stable(p.engines)!==stable(d.engines)||p.quarto.version!==d.quarto.version)fail('Нет exact original unlisted physical alias shape');
  const a=raw(p,row.physicalPath),b=raw(d,path),c=owner.fileInformation[row.source];if(stable(a.metadata)!==stable(b.metadata)||stable(b.metadata)!==stable(c.metadata)||stable(b.includeMap)!==stable(c.includeMap))fail('Original raw role mismatch');
  if(stable((owned?['json']:Object.keys(d.formats)).map(f=>['pdf','beamer'].includes(f)?'latex':f).sort())!==stable(w.documents.filter(v=>v.source===row.source).map(v=>v.format).sort()))fail('Original lexical format scope mismatch');
 }
 return {owner,physical,lexical};
}
