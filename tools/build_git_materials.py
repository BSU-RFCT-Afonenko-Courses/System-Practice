#!/usr/bin/env python3
"""Воспроизводимые исходные файлы проекта; вспомогательные операции Git сохранены для сопровождения."""
import argparse,json,os,shutil,subprocess,sys,tempfile
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
    outputs = {}; states = {}
    expected_roots = {'practice/materials/version-control-demo.zip': 'latency-demo',
                      'tasks/materials/version-control-start.zip': 'versioning'}
    if set(seed) != set(expected_roots): raise ValueError('Нужны демонстрационный и стартовый архивы')
    for archive, spec in seed.items():
        if spec['root'] != expected_roots[archive]: raise ValueError('Неожиданный корень материала')
        entries = {spec['root'] + '/' + name: text for name, text in spec['files'].items()}
        outputs[archive] = packed(entries)
        states[archive] = {'root': spec['root'], 'files': sorted(entries), 'preparedHistory': False}
    outputs['tasks/projects/version-control/initial-state.json'] = (json.dumps(states, ensure_ascii=False, indent=2) + '\n').encode()
    return outputs


def build(root):
    root=Path(root).resolve(strict=True);seed=json.loads(target(root,'tasks/projects/version-control/seed.json').read_text());outputs=generate(seed)
    planned=[]
    for name,data in outputs.items():
        if name not in {'practice/materials/version-control-demo.zip', 'tasks/materials/version-control-start.zip', 'tasks/projects/version-control/initial-state.json'}:raise ValueError('Не объявлено назначение набора')
        planned.append((target(root,name),data))
    for path,data in planned:atomic_write(path,data)
    return list(outputs)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    a=p.parse_args()
    print(json.dumps(build(a.root),ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except (ValueError,OSError,subprocess.SubprocessError) as e:print(e,file=sys.stderr);raise SystemExit(1)
