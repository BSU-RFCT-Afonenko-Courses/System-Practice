#!/usr/bin/env python3
"""Воспроизводимые обычные Git-репозитории по авторскому исходному договору."""
import argparse,hashlib,json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
from build_materials import target,packed,atomic_write


def git_env():
    env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_COUNT='0',GIT_OPTIONAL_LOCKS='0',GIT_INDEX_VERSION='2',GIT_AUTHOR_NAME='Учебный набор',GIT_AUTHOR_EMAIL='course-fixture@example.invalid',GIT_COMMITTER_NAME='Учебный набор',GIT_COMMITTER_EMAIL='course-fixture@example.invalid',GIT_AUTHOR_DATE='2026-10-16T00:00:00Z',GIT_COMMITTER_DATE='2026-10-16T00:00:00Z',LC_ALL='C.UTF-8',TZ='UTC')
    return env


def git(repo,*args,input=None):
    run=subprocess.run(['git','--no-optional-locks',*args],cwd=repo,env=git_env(),input=input,capture_output=True,timeout=15)
    if run.returncode:raise ValueError('Git seed: '+run.stderr.decode('utf-8',errors='replace'))
    return run.stdout


def put(repo,files):
    for name,text in files.items():
        p=target(repo,name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(text.encode('utf-8'))


def commit(repo,files,message):
    put(repo,files);git(repo,'add','--all');git(repo,'-c','commit.gpgsign=false','commit','-qm',message)
    return git(repo,'rev-parse','HEAD').decode().strip()


def initialize(repo,template):
    repo.mkdir();git(repo,'init','-q','--initial-branch=main','--object-format=sha1','--template='+str(template))
    git(repo,'config','--local','core.filemode','false');git(repo,'config','--local','core.autocrlf','false');git(repo,'config','--local','core.logAllRefUpdates','false')


def normalize(repo):
    entries=git(repo,'ls-files','--stage','-z');(repo/'.git/index').unlink();git(repo,'update-index','-z','--index-info',input=entries)
    for name in ['COMMIT_EDITMSG','ORIG_HEAD','description']:
        (repo/'.git'/name).unlink(missing_ok=True)
    shutil.rmtree(repo/'.git/logs',ignore_errors=True)
    return {'refs':git(repo,'show-ref').decode().splitlines(),'head':git(repo,'symbolic-ref','HEAD').decode().strip(),'status':git(repo,'status','--porcelain=v1').decode()}


def generate(seed):
    outputs={};states={}
    with tempfile.TemporaryDirectory(prefix='git-course-seed-') as temporary:
        parent=Path(temporary);template=parent/'template';template.mkdir()
        for archive,spec in seed.items():
            base=parent/spec['root'];base.mkdir();selection=base/'selection';initialize(selection,template)
            plan=spec['selection'];a=commit(selection,plan['A'],'Исходный набор');git(selection,'tag','units-reference',a);b=commit(selection,plan['B'],'Обновить исходные измерения');git(selection,'tag','start',b)
            put(selection,plan['index']);git(selection,'add','--all');put(selection,plan['worktree']);selection_state=normalize(selection)
            integration=base/'integration';initialize(integration,template);plan=spec['integration'];a=commit(integration,plan['A'],'Исходный отчёт');git(integration,'tag','base',a);m=commit(integration,plan['main'],'Требовать проверку отчёта');git(integration,'tag','start',m);git(integration,'switch','-qc',plan['sideName'],a);f=commit(integration,plan['side'],'Изменить представление отчёта');git(integration,'switch','-q','main');integration_state=normalize(integration)
            states[archive]={'root':spec['root'],'selection':selection_state,'integration':integration_state}
            entries={p.relative_to(parent).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file()};outputs[archive]=packed(entries)
    outputs['tasks/projects/version-control/initial-state.json']=(json.dumps(states,ensure_ascii=False,indent=2)+'\n').encode()
    return outputs


def build(root,write=False):
    root=Path(root).resolve(strict=True);seed=json.loads(target(root,'tasks/projects/version-control/seed.json').read_text());outputs=generate(seed)
    manifest=target(root,'tasks/projects/version-control/materials-hashes.json');previous=json.loads(manifest.read_text()) if manifest.exists() else {};planned=[];hashes={}
    for name,data in outputs.items():
        if name not in ['practice/materials/version-control-demo.zip','tasks/materials/version-control-start.zip','tasks/projects/version-control/initial-state.json']:raise ValueError('Не объявлено назначение Git набора')
        p=target(root,name);expected=hashlib.sha256(data).hexdigest();actual=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
        if actual is not None and actual!=expected and actual!=previous.get(name):raise ValueError('Локальная правка сохранена: '+name)
        planned.append((p,data,actual,expected));hashes[name]=expected
    if set(previous)-set(hashes):raise ValueError('Уменьшение состава требует отдельной проверки')
    if not write:
        if previous!=hashes or any(a!=e for _,_,a,e in planned):raise ValueError('Git материалы отсутствуют или устарели')
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
