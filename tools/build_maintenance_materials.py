#!/usr/bin/env python3
"""Воспроизводимая локальная Git-поставка сопровождения по авторскому договору."""
import argparse,hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path
from build_materials import target,packed,atomic_write
from build_git_materials import git,put,commit,initialize,normalize

DIRECTORY='tasks/projects/project-maintenance'
ARCHIVES={'practice/materials/project-maintenance-demo.zip','tasks/materials/project-maintenance-start.zip'}


def generate(seed):
    if set(seed)!=ARCHIVES:raise ValueError('Нужны ровно демонстрационный и самостоятельный наборы')
    roots={'practice/materials/project-maintenance-demo.zip':'maintenancelab','tasks/materials/project-maintenance-start.zip':'maintenance'}
    if any(spec.get('root')!=roots[name] for name,spec in seed.items()):raise ValueError('Корень исходного набора не соответствует объявленной поставке')
    outputs={};states={}
    with tempfile.TemporaryDirectory(prefix='maintenance-seed-') as temporary:
        parent=Path(temporary);template=parent/'template';template.mkdir()
        for archive,spec in seed.items():
            base=parent/spec['root'];base.mkdir();work=base/'work';initialize(work,template);ids={}
            # Создаём объявленные снимки и родителей; личная конфигурация не участвует.
            for label,node in spec['history'].items():
                git(work,'read-tree','--empty')
                for name,text in sorted(node['files'].items()):
                    target(work,name)
                    blob=git(work,'hash-object','-w','--stdin',input=text.encode()).decode().strip()
                    git(work,'update-index','--add','--cacheinfo','100644',blob,name)
                tree=git(work,'write-tree').decode().strip();parents=[]
                for predecessor in node['parents']:parents+=['-p',ids[predecessor]]
                ids[label]=git(work,'commit-tree',tree,*parents,'-m','Учебное состояние '+label).decode().strip()
            git(work,'update-ref','refs/heads/main',ids[spec['workHead']])
            for name,label in spec['workBranches'].items():git(work,'update-ref','refs/heads/'+name,ids[label])
            for name,label in spec['workTags'].items():git(work,'update-ref','refs/tags/'+name,ids[label])
            git(work,'reset','--hard','main')
            shared=base/'shared.git';shared.mkdir();git(shared,'init','-q','--bare','--initial-branch=main','--object-format=sha1','--template='+str(template))
            shutil.copytree(work/'.git/objects',shared/'objects',dirs_exist_ok=True)
            git(shared,'update-ref','refs/heads/main',ids[spec['sharedHead']])
            for name,label in spec['sharedTags'].items():git(shared,'update-ref','refs/tags/'+name,ids[label])
            (shared/'description').unlink(missing_ok=True)
            git(work,'switch','-q','--detach',ids[spec['patchBase']]);patch_spec=spec['patch'];put(work,{patch_spec['path']:patch_spec['text']})
            patch=git(work,'diff','--no-ext-diff','--binary','--',patch_spec['path'])
            git(work,'restore','--source=HEAD','--worktree','--',patch_spec['path']);git(work,'switch','-q','main')
            # Поступившая линия доступна через соседний bare; лишних объектов work нет.
            git(work,'prune','--expire=now')
            incoming=base/'incoming';incoming.mkdir();target(incoming,patch_spec['name']).write_bytes(patch)
            state=normalize(work)
            states[archive]={'root':spec['root'],'history':ids,**{k:ids[k] for k in ['A','M','F'] if k in ids},'work':state,'sharedRefs':git(shared,'show-ref').decode().splitlines(),'patch':{'name':patch_spec['name'],'sha256':hashlib.sha256(patch).hexdigest()}}
            entries={p.relative_to(parent).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file()};outputs[archive]=packed(entries)
    outputs[DIRECTORY+'/initial-state.json']=(json.dumps(states,ensure_ascii=False,indent=2)+'\n').encode()
    return outputs


def build(root,write=False):
    root=Path(root).resolve(strict=True);seed=json.loads(target(root,DIRECTORY+'/seed.json').read_text());outputs=generate(seed)
    manifest=target(root,DIRECTORY+'/materials-hashes.json');previous=json.loads(manifest.read_text()) if manifest.exists() else {};planned=[];hashes={}
    for name,data in outputs.items():
        if name not in ARCHIVES|{DIRECTORY+'/initial-state.json'}:raise ValueError('Не объявлено назначение набора')
        p=target(root,name);expected=hashlib.sha256(data).hexdigest();actual=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
        if actual is not None and actual!=expected and actual!=previous.get(name):raise ValueError('Локальная правка сохранена: '+name)
        planned.append((p,data,actual,expected));hashes[name]=expected
    if set(previous)-set(hashes):raise ValueError('Уменьшение состава требует отдельной проверки')
    if not write:
        if previous!=hashes or any(a!=e for _,_,a,e in planned):raise ValueError('Материалы сопровождения отсутствуют или устарели')
        return hashes
    for p,data,actual,expected in planned:
        if actual!=expected:atomic_write(p,data)
    content=(json.dumps(hashes,ensure_ascii=False,indent=2)+'\n').encode()
    if not manifest.exists() or manifest.read_bytes()!=content:atomic_write(manifest,content)
    return hashes


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--write',action='store_true');mode.add_argument('--check',action='store_true');a=p.parse_args();print(json.dumps(build(a.root,a.write),ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except (ValueError,OSError,subprocess.SubprocessError) as e:print(e,file=sys.stderr);raise SystemExit(1)
