#!/usr/bin/env python3
"""Установить факты Git-сдачи; объяснение истории оценивается отдельно."""
import argparse
import json
import os
from pathlib import Path
import resource
import subprocess
import tempfile
from system_support import ArchiveError,read_zip

ROOT=Path(__file__).resolve().parents[1]
INITIAL=ROOT/'tasks/projects/version-control/initial-state.json'
ATTR=b'* text=auto eol=lf\n'

class GitDataError(ValueError):pass

def limits():
    # The checker runs on the local Linux instructor host. Student programs are never run.
    resource.setrlimit(resource.RLIMIT_CPU,(4,4))
    resource.setrlimit(resource.RLIMIT_FSIZE,(2*1024*1024,2*1024*1024))
    resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))

class Repository:
    def __init__(self,files,name,temporary):
        prefix=f'versioning/{name}/';self.files={n[len(prefix):]:v for n,v in files.items() if n.startswith(prefix)}
        if '.git' in self.files or '.git/HEAD' not in self.files:raise GitDataError(f'{name}: нужен полный обычный .git')
        dangerous=['.git/objects/info/alternates','.git/objects/info/http-alternates','.git/info/grafts','.git/shallow','.git/commondir','.git/gitdir']
        if any(n in self.files for n in dangerous) or any(n.startswith('.git/refs/replace/') for n in self.files):raise GitDataError(f'{name}: внешняя или подменённая история не поддерживается')
        self.work={n:v for n,v in self.files.items() if not n.startswith('.git/')}
        self.gitdir=temporary/name;self.gitdir.mkdir()
        # Packed refs leave no loose ref files, but Git still requires this directory.
        (self.gitdir/'objects').mkdir();(self.gitdir/'refs').mkdir()
        # Copy data only. Config, hooks, attributes, executable helpers and logs are never used.
        for n,v in self.files.items():
            if n in ['.git/HEAD','.git/index','.git/packed-refs'] or n.startswith(('.git/objects/','.git/refs/heads/','.git/refs/tags/')):
                p=self.gitdir/n.removeprefix('.git/');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(v)
        (self.gitdir/'config').write_text('[core]\n repositoryformatversion = 0\n bare = true\n hooksPath = /dev/null\n fsmonitor = false\n')
        self.env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
        self.env.update(GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_COUNT='0',GIT_NO_REPLACE_OBJECTS='1',GIT_OPTIONAL_LOCKS='0',GIT_TERMINAL_PROMPT='0',GIT_ALLOW_PROTOCOL='')
        if any(n in self.files for n in ['.git/MERGE_HEAD','.git/CHERRY_PICK_HEAD','.git/REVERT_HEAD']) or any(n.startswith(('.git/rebase-merge/','.git/rebase-apply/')) for n in self.files):raise GitDataError(f'{name}: незавершённая операция Git')
    def git(self,*args):
        with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
            try:
                p=subprocess.run(['git','--no-pager','--git-dir='+str(self.gitdir),*args],env=self.env,stdout=out,stderr=err,timeout=6,preexec_fn=limits)
            except (OSError,subprocess.TimeoutExpired) as e:raise GitDataError(f'Git не завершил чтение данных: {e}') from e
            out.seek(0);data=out.read(1024*1024+1)
            if p.returncode or len(data)>1024*1024:
                err.seek(0);detail=err.read(4096).decode('utf-8',errors='replace').strip()
                raise GitDataError('Не удалось безопасно прочитать Git object/index/ref; требуется разбор преподавателем: '+detail)
            return data
    def ref(self,name):return self.git('rev-parse','--verify',name).decode().strip()
    def parents(self,oid):return self.git('rev-list','--parents','-n','1',oid).decode().split()[1:]
    def tree(self,oid):
        result={}
        for entry in self.git('ls-tree','-rz',oid).split(b'\0'):
            if not entry:continue
            meta,name=entry.split(b'\t',1);mode,kind,blob=meta.split()
            if kind!=b'blob' or mode not in [b'100644',b'100755']:raise GitDataError('Нужны обычные предметные файлы')
            result[name.decode('utf-8')]=self.git('cat-file','blob',blob.decode())
        return result
    def index(self):
        result={}
        for entry in self.git('ls-files','--stage','-z').split(b'\0'):
            if not entry:continue
            meta,name=entry.split(b'\t',1);mode,blob,stage=meta.split()
            if stage!=b'0' or mode not in [b'100644',b'100755']:raise GitDataError('Индекс содержит конфликт или необычный тип файла')
            result[name.decode('utf-8')]=self.git('cat-file','blob',blob.decode())
        return result
    def commits(self,oid):return set(self.git('rev-list',oid).decode().split())

def encoded(mapping):return {name:text.encode() for name,text in mapping.items()}
def normalized_work(files):
    result={}
    for name,data in files.items():
        text=data.decode('utf-8')
        if text.startswith('\ufeff') or '\r' in text.replace('\r\n',''):raise GitDataError('Рабочие файлы должны быть UTF-8 без BOM, LF/CRLF')
        result[name]=text.replace('\r\n','\n').encode()
    return result

def check_archive(path):
    errors=[];facts={}
    manual=['Объяснение выбора снимка и сохранённой незавершённой работы, получение protocol из истории средствами Git.',
            'Собственные команды, осмысленные сообщения, чтение графа и точки ответвления; совпадение файлов не доказывает самостоятельное применение приёма.',
            'ОС, оболочка, Git version и процессы проверяются в подходящей среде.']
    try:
        archive=read_zip(path);files=archive.files
        allowed=('versioning/selection/','versioning/integration/')
        if any(n!='versioning/explanation.md' and not n.startswith(allowed) for n in files):raise GitDataError('Нужен один корень versioning с selection, integration и explanation.md')
        if not files.get('versioning/explanation.md',b'').decode('utf-8-sig').strip():raise GitDataError('Нужно непустое пояснение UTF-8')
        initial=json.loads(INITIAL.read_text())['tasks/materials/version-control-start.zip']
        with tempfile.TemporaryDirectory(prefix='git-data-check-') as temp:
            for name in ['selection','integration']:
                repo=Repository(files,name,Path(temp));refs={line.split()[1]:line.split()[0] for line in initial[name]['refs']}
                for ref,oid in refs.items():
                    if ref.startswith('refs/tags/') or ref=='refs/heads/csv-output':
                        if repo.ref(ref)!=oid:raise GitDataError(f'{name}: изменена исходная точка {ref}')
                    repo.git('cat-file','-e',oid+'^{commit}')
                if repo.git('symbolic-ref','HEAD').strip()!=b'refs/heads/main':raise GitDataError(f'{name}: HEAD должен быть на main')
                head=repo.ref('refs/heads/main');tree=repo.tree(head);index=repo.index();work=normalized_work(repo.work)
                if index!=tree:raise GitDataError(f'{name}: индекс не совпадает с итоговым коммитом')
                if name=='selection':
                    base=refs['refs/tags/start']
                    if repo.parents(head)!=[base]:raise GitDataError('selection: нужен ровно один обычный потомок start')
                    wanted=encoded({'.gitattributes':ATTR.decode(),'measurements.ini':'site=river\nsamples=10\nwindow=long\n','guide.txt':'window=long\n','notes.txt':'draft=none\n','protocol.txt':'unit=ms\n'})
                    if tree!=wanted:raise GitDataError('selection: снимок отличается от требуемого')
                    expected_work={**wanted,'measurements.ini':b'site=river\nsamples=12\nwindow=long\n','notes.txt':b'draft=trial\n'}
                    if work!=expected_work:raise GitDataError('selection: незавершённая работа потеряна или изменена')
                    facts['selectionCommit']=head
                else:
                    m=refs['refs/tags/start'];f=refs['refs/heads/csv-output'];a=refs['refs/tags/base']
                    ancestors=repo.commits(head)
                    if not {a,m,f}<=ancestors:raise GitDataError('integration: исходные линии не включены как предки main')
                    new=ancestors-{a,m,f};ordinary=[oid for oid in new if len(repo.parents(oid))==1]
                    if len(ordinary)!=1:raise GitDataError('integration: нужен один обычный содержательный коммит C')
                    c=ordinary[0]
                    if repo.parents(c)!=[f]:raise GitDataError('integration: C должен продолжать csv-output')
                    if repo.tree(c)!={**repo.tree(f),'checks.txt':b'order=units,code\n'}:raise GitDataError('integration: C должен добавлять только checks.txt')
                    if not any(len(repo.parents(oid))>=2 for oid in new):raise GitDataError('integration: нужен коммит слияния')
                    if any(len(repo.parents(oid))<2 for oid in new-{c}):raise GitDataError('integration: лишние обычные коммиты')
                    validation=repo.ref('refs/heads/validation')
                    if validation not in ancestors or c not in repo.commits(validation):raise GitDataError('integration: validation не сохраняет C в итоговой истории')
                    wanted=encoded({'.gitattributes':ATTR.decode(),'report.ini':'format=csv\ncolumns=code,units\n','guide.txt':'review=required\n','checks.txt':'order=units,code\n'})
                    if tree!=wanted or work!=wanted:raise GitDataError('integration: итоговые файлы или чистота дерева не совпали')
                    facts.update(integrationCommit=head,validationCommit=c)
    except (ArchiveError,GitDataError,UnicodeError,ValueError,OSError) as e:errors.append(str(e))
    return {'automated':'fail' if errors else 'pass','errors':errors,'facts':facts,'manualRequired':manual}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args()
    result=check_archive(args.archive);text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:args.output.write_text(text)
    print(text,end='');return result['automated']!='pass'
if __name__=='__main__':raise SystemExit(main())
