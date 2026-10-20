#!/usr/bin/env python3
"""Проверить vendor closure или воспроизвести release + отдельный local patch."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, io, json, os, re, shutil, subprocess, sys, tarfile, tempfile

def sha(data): return hashlib.sha256(data).hexdigest()
def safe(root, relative):
    path=PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts: raise ValueError(f'Недопустимый путь: {relative}')
    current=root
    for part in path.parts:
        current=current/part
        if current.is_symlink(): raise ValueError(f'Символическая ссылка: {relative}')
    return current

def inventory(root):
    if not root.exists(): return {}
    result={}
    for p in sorted(root.rglob('*')):
        if p.is_symlink(): raise ValueError(f'Символическая ссылка: {p}')
        if p.is_dir(): continue
        if not p.is_file(): raise ValueError(f'Ожидался обычный файл: {p}')
        data=p.read_bytes(); result[p.relative_to(root).as_posix()]={'sha256':sha(data),'size':len(data),'mode':420}
    return result

def tree_hash(files): return sha(json.dumps(files,sort_keys=True,separators=(',',':')).encode())
def git(repo,*args): return subprocess.check_output(['git',*args],cwd=repo,stderr=subprocess.PIPE)
def valid_provider(provider):
    tag=provider['tag']; version=provider['version']; commit=provider['commit']
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+',tag) or tag!='v'+version or not re.fullmatch(r'[a-f0-9]{40}',commit):
        raise ValueError('Нужны точные опубликованные tag/version/commit')
    if provider['sourceZip']!=f"https://github.com/{provider['repository']}/archive/refs/tags/{tag}.zip":
        raise ValueError('sourceZip не соответствует published tag')
    if 'candidate' in provider:
        c=provider['candidate']
        if c['status']!='local-unpublished' or c['baseCommit']!=commit or not re.fullmatch(r'[a-f0-9]{40}',c['commit']):
            raise ValueError('Неверное происхождение local candidate')

def staged(root, provider, sources, temporary):
    valid_provider(provider); repo=safe(sources,provider['checkout']); commit=provider['commit']
    if git(repo,'rev-parse',provider['tag']+'^{commit}').decode().strip()!=commit: raise ValueError('Published tag отличается от commit')
    # Непушенный candidate commit не запрашивается: источник — release + tracked patch.
    data=git(repo,'archive','--format=tar',commit,'_extensions')
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for entry in archive:
            path=safe(temporary,entry.name)
            if entry.isdir(): path.mkdir(parents=True,exist_ok=True)
            elif entry.isfile():
                path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(archive.extractfile(entry).read());path.chmod(0o644)
            else: raise ValueError(f'Необычный файл Git archive: {entry.name}')
    if 'candidate' in provider:
        c=provider['candidate']; patch=safe(root,c['patch'])
        if sha(patch.read_bytes())!=c['patchSha256']: raise ValueError('Изменился hash candidate patch')
        subprocess.run(['git','init','-q',str(temporary)],check=True,capture_output=True)
        for options in [['--check'],[]]:
            subprocess.run(['git','apply',*options,str(patch)],cwd=temporary,check=True,capture_output=True)
    result={}
    for package,scopes in provider['packages'].items():
        path=safe(temporary,'_extensions/'+package); files=inventory(path)
        descriptor=(path/'_extension.yml').read_text()
        if not re.search(r'^version:\s*[\"\']?'+re.escape(provider['version'])+r'[\"\']?\s*$',descriptor,re.M):
            raise ValueError(f'Version descriptor отличается: {package}')
        if 'candidate' in provider and tree_hash(files)!=provider['candidate']['packageHashes'][package]:
            raise ValueError(f'Candidate bytes отличаются: {package}')
        result[package]=(path,files)
    return result

def current_expected(root,info,scope,namespace,package):
    files=json.loads(json.dumps(info['files']))
    # Только документированные прежние поправки дополняют старый release inventory.
    local=root/'docs/local-extension-patches.json'
    if not info.get('candidate') and local.exists():
        prefix=(PurePosixPath(scope)/'_extensions'/namespace/package).as_posix()+'/'
        for p in json.loads(local.read_text()).get('patches',[]):
            if p['path'].startswith(prefix):
                name=p['path'][len(prefix):]
                if name in files and files[name]['sha256']==p['base_sha256']:
                    files[name]['sha256']=p['local_sha256']; files[name].pop('size',None)
    return files

def matches(actual,expected):
    return set(actual)==set(expected) and all(all(actual[n].get(k)==v for k,v in row.items() if k!='mode') for n,row in expected.items())
def atomic_text(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        temp=Path(f.name);f.write(text.encode())
    try: os.replace(temp,path)
    finally:
        if temp.exists():temp.unlink()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--course-root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--providers-root',type=Path)
    mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--write',action='store_true');mode.add_argument('--check',action='store_true');a=p.parse_args()
    root=a.course_root.resolve(strict=True); manifest=json.loads((root/'providers.json').read_text()); namespace=manifest['namespace']
    if not re.fullmatch(r'[A-Za-z0-9_-]+',namespace):raise ValueError('Неверный namespace provider')
    installed=root/'installed-packages.json'; previous=json.loads(installed.read_text()) if installed.exists() else {'schema':'course-template-packages-v1','packages':{}}
    for v in manifest['providers'].values():valid_provider(v)
    names=[n for v in manifest['providers'].values() for n in v['packages']]
    if len(set(names))!=len(names):raise ValueError('Повторный package')
    if a.check:
        if set(previous['packages'])!=set(names):raise ValueError('Состав installed packages отличается')
        for key,v in manifest['providers'].items():
            if 'candidate' in v and sha(safe(root,v['candidate']['patch']).read_bytes())!=v['candidate']['patchSha256']:raise ValueError('Изменился patch')
            for package,scopes in v['packages'].items():
                info=previous['packages'][package]
                if any(info.get(k)!=v[k] for k in ['repository','commit','tag','version','sourceZip']) or info.get('provider')!=key or info.get('candidate')!=v.get('candidate') or info['scopes']!=scopes:raise ValueError(f'Provenance отличается: {package}')
                if 'candidate' in v and tree_hash(info['files'])!=v['candidate']['packageHashes'][package]:raise ValueError(f'Candidate lock отличается: {package}')
                for scope in scopes:
                    actual=inventory(safe(root,(PurePosixPath(scope)/'_extensions'/namespace/package).as_posix()))
                    if not matches(actual,info['files']):raise ValueError(f'Изменены vendor files: {scope}/{package}')
        print(f'PASS: {len(names)} packages, точные scopes/provenance/bytes');return 0
    if a.providers_root is None:raise ValueError('--write требует --providers-root с release checkouts')
    sources=a.providers_root.resolve(strict=True); planned=[];provenance={'schema':'course-template-packages-v1','packages':{}}
    with tempfile.TemporaryDirectory(prefix='course-providers-') as temporary:
        for key,v in manifest['providers'].items():
            stage=Path(temporary)/key;stage.mkdir();built=staged(root,v,sources,stage)
            for package,(source,files) in built.items():
                scopes=v['packages'][package]
                for scope in scopes:
                    target=safe(root,(PurePosixPath(scope)/'_extensions'/namespace/package).as_posix()); actual=inventory(target);old=previous['packages'].get(package)
                    expected=current_expected(root,old,scope,namespace,package) if old and scope in old['scopes'] else {}
                    if not matches(actual,expected) and not matches(actual,files):raise ValueError(f'Локальные изменения сохранены, запись остановлена: {scope}/{package}')
                    planned.append((source,target,actual,files))
                info={k:v[k] for k in ['repository','commit','tag','version','sourceZip']};info.update(provider=key,scopes=scopes,files=files,extensionTree=git(safe(sources,v['checkout']),'rev-parse',v['commit']+':_extensions/'+package).decode().strip())
                if 'candidate' in v:info['candidate']=v['candidate']
                provenance['packages'][package]=info
        # Проверены все packages и scopes до первой записи; повторный вызов не пишет bytes.
        for source,target,before,files in planned:
            if matches(before,files):continue
            if inventory(target)!=before:raise ValueError('Target изменился после preflight')
            target.parent.mkdir(parents=True,exist_ok=True)
            if target.exists():shutil.rmtree(target)
            shutil.copytree(source,target)
            for f in target.rglob('*'):
                if f.is_file():f.chmod(0o644)
            if inventory(target)!=files:raise ValueError('Ошибка materialization')
        output=json.dumps(provenance,indent=2,ensure_ascii=False)+'\n'
        if not installed.exists() or installed.read_text()!=output:atomic_text(installed,output)
    print(f'PASS: материализовано {len(planned)} package scopes');return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as e:
        print(f'Поставка остановлена: {e}',file=sys.stderr);raise SystemExit(2)
