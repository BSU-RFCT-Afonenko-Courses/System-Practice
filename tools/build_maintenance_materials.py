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
    outputs={};states={}
    with tempfile.TemporaryDirectory(prefix='maintenance-seed-') as temporary:
        parent=Path(temporary);template=parent/'template';template.mkdir()
        for archive,spec in seed.items():
            base=parent/spec['root'];base.mkdir();work=base/'work';initialize(work,template)
            a=commit(work,spec['files'],'Исходное описание отчёта');git(work,'tag','base',a)
            m=commit(work,spec['main'],'Изменить локальный отчёт');git(work,'tag','start',m)
            git(work,'switch','-qc','transfer-source',a);f=commit(work,spec['shared'],'Изменить совместный отчёт')
            # Bare receives objects by a local trusted seed copy, without recording a remote path.
            shared=base/'shared.git';shared.mkdir();git(shared,'init','-q','--bare','--initial-branch=main','--object-format=sha1','--template='+str(template))
            shutil.copytree(work/'.git/objects',shared/'objects',dirs_exist_ok=True)
            git(shared,'update-ref','refs/heads/main',f);git(shared,'update-ref','refs/tags/base',a);git(shared,'update-ref','refs/tags/incoming',f)
            (shared/'description').unlink(missing_ok=True)
            git(work,'switch','-q','main');git(work,'branch','-D','transfer-source')
            # A plain diff is computed on A; this operation creates no commit and is reverted before packing.
            git(work,'switch','-q','--detach',a);p=spec['patch'];put(work,{p['path']:p['text']})
            patch=git(work,'diff','--no-ext-diff','--binary','--',p['path']);git(work,'restore','--source=HEAD','--worktree','--',p['path']);git(work,'switch','-q','main')
            incoming=base/'incoming';incoming.mkdir();target(incoming,p['name']).write_bytes(patch)
            state=normalize(work)
            states[archive]={'root':spec['root'],'A':a,'M':m,'F':f,'work':state,'sharedRefs':git(shared,'show-ref').decode().splitlines(),'patch':{'name':p['name'],'sha256':hashlib.sha256(patch).hexdigest()}}
            entries={p.relative_to(parent).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file()}
            outputs[archive]=packed(entries)
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
