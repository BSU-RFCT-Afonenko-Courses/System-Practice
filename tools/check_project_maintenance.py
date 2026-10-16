#!/usr/bin/env python3
"""Проверить наблюдаемые факты проекта; приёмы и объяснение принимает преподаватель."""
import argparse,json,tempfile
from pathlib import Path
from system_support import ArchiveError,read_zip
from check_version_control import Repository,GitDataError,ATTR,normalized_work

ROOT=Path(__file__).resolve().parents[1]
INITIAL=ROOT/'tasks/projects/project-maintenance/initial-state.json'
PREFIX='maintenance/'


def repository(files,folder,name,temporary,bare=False):
    start=PREFIX+folder+'/'
    converted={'versioning/'+name+'/'+('.git/' if bare else '')+n[len(start):]:v for n,v in files.items() if n.startswith(start)}
    return Repository(converted,name,temporary)


def check_archive(path,initial_path=INITIAL):
    errors=[];facts={}
    manual=['Наблюдения fetch/push и сохранение рабочей копии; итоговая история не доказывает применение команд.',
            'Содержательное разрешение конфликта, проверка и применение входного патча средствами Git; пояснение отдельной линии review-note.',
            'Осмысленные сообщения коммитов, CHANGELOG и аннотация тега; соответствие объяснения действительной работе.',
            'Создание Git-архива и проверка состава выпуска; фактическое средство не заменяет короткий разбор преподавателем.']
    try:
        files=read_zip(path).files
        allowed=(PREFIX+'work/',PREFIX+'shared.git/',PREFIX+'incoming/')
        extras={PREFIX+n for n in ['release.patch','report-2.0.zip','explanation.md']}
        if any(not n.startswith(allowed) and n not in extras for n in files):raise GitDataError('Нужен корень maintenance с work, shared.git, incoming и файлами выпуска')
        if not files.get(PREFIX+'explanation.md',b'').decode('utf-8-sig').strip():raise GitDataError('Нужно непустое explanation.md UTF-8')
        initial=json.loads(Path(initial_path).read_text())['tasks/materials/project-maintenance-start.zip']
        a,m,f=(initial[k] for k in ['A','M','F'])
        import hashlib
        incoming={n:v for n,v in files.items() if n.startswith(PREFIX+'incoming/')}
        if set(incoming)!={PREFIX+'incoming/review.patch'} or hashlib.sha256(incoming[PREFIX+'incoming/review.patch']).hexdigest()!=initial['patch']['sha256']:
            raise GitDataError('Исходный incoming/review.patch должен сохраняться')
        with tempfile.TemporaryDirectory(prefix='maintenance-facts-') as temporary:
            temp=Path(temporary);work=repository(files,'work','work',temp);shared=repository(files,'shared.git','shared',temp,bare=True)
            for repo in [work,shared]:
                if repo.git('symbolic-ref','HEAD').strip()!=b'refs/heads/main':raise GitDataError('HEAD должен выбирать main')
                if repo.ref('refs/tags/base')!=a:raise GitDataError('Изменён исходный base')
            if work.ref('refs/tags/start')!=m or shared.ref('refs/tags/incoming')!=f:raise GitDataError('Изменены start/incoming')
            r=work.ref('refs/heads/main');tree=work.tree(r)
            if work.index()!=tree or normalized_work(work.work)!=tree:raise GitDataError('Индекс и рабочие файлы должны совпадать с main без незавершённой работы')
            wanted={'.gitattributes':ATTR,'report.ini':b'format=csv\ncolumns=code,value,quality\ndecimal=dot\n','instructions.txt':b'Check the input.\nKeep the quality flag.\n','VERSION':b'2.0\n'}
            if set(tree)!=set(wanted)|{'CHANGELOG.md'}:raise GitDataError('В main нужны ровно пять опубликованных файлов выпуска')
            for name,data in wanted.items():
                if tree[name]!=data:raise GitDataError('Итоговый '+name+' отличается от договора')
            changelog=tree['CHANGELOG.md'].decode('utf-8')
            if not changelog.strip() or not any(line.lstrip().startswith('#') and line.lstrip('# ').strip()=='2.0' for line in changelog.splitlines()):raise GitDataError('CHANGELOG.md нужен заголовок версии 2.0; содержание принимает преподаватель')
            p=work.ref('refs/heads/review-note')
            if work.parents(p)!=[a] or work.tree(p)!={**work.tree(a),'instructions.txt':wanted['instructions.txt']}:
                raise GitDataError('review-note должен выбирать обычный P от A с изменением только instructions.txt по патчу')
            ancestors=work.commits(r)
            if not {a,m,f,p}<=ancestors:raise GitDataError('main должен сохранять A, M, F и P как предков')
            new=ancestors-{a,m,f}
            if not any(len(work.parents(oid))>=2 for oid in new):raise GitDataError('Нужно объединение исходных линий коммитами слияния')
            for oid in new:
                snapshot=work.tree(oid)
                if snapshot.get('.gitattributes')!=ATTR or set(snapshot)-set(tree):raise GitDataError('Новый коммит меняет .gitattributes или добавляет посторонний путь')
            if work.git('cat-file','-t','refs/tags/v2.0').strip()!=b'tag':raise GitDataError('v2.0 должен быть аннотированный тег')
            if work.ref('refs/tags/v2.0^{commit}')!=r:raise GitDataError('v2.0 должен обозначать итоговый main')
            tag=work.ref('refs/tags/v2.0');tag_body=work.git('cat-file','tag',tag)
            if not tag_body.partition(b'\n\n')[2].strip():raise GitDataError('Нужна непустая аннотация v2.0')
            if shared.ref('refs/heads/main')!=r or shared.ref('refs/tags/v2.0')!=tag:raise GitDataError('shared.git должен получить итоговый main и тот же объект v2.0')
            if shared.tree(r)!=tree:raise GitDataError('shared.git содержит иное дерево выпуска')
            release=files.get(PREFIX+'report-2.0.zip')
            if release is None:raise GitDataError('Отсутствует report-2.0.zip')
            release_path=temp/'release.zip';release_path.write_bytes(release)
            release_archive=read_zip(release_path);release_files=release_archive.files
            if release_archive.directories-{'report-2.0'}:raise GitDataError('report-2.0.zip содержит посторонний каталог, в том числе .git')
            if release_files!={'report-2.0/'+n:v for n,v in tree.items()}:raise GitDataError('report-2.0.zip должен содержать ровно пути и байты пяти файлов main под report-2.0/')
            patch=files.get(PREFIX+'release.patch')
            if not patch:raise GitDataError('Нужен непустой release.patch от start к выпуску')
            # The submitted config/hooks/working tree never participate. Apply changes only to a private index.
            patch_path=temp/'release.patch';patch_path.write_bytes(patch)
            work.git('read-tree',m)
            try:
                work.git('apply','--cached','--check','--binary',str(patch_path))
                work.git('apply','--cached','--binary',str(patch_path))
            except GitDataError as problem:raise GitDataError('release.patch не применяется к start: '+str(problem)) from problem
            if work.index()!=tree:raise GitDataError('release.patch на start не воспроизводит дерево main')
            facts.update(main=r,patchCommit=p,annotatedTag=tag,sharedMain=r,releaseFiles=sorted(tree),patchReproducesMain=True)
    except (ArchiveError,GitDataError,UnicodeError,ValueError,OSError,KeyError) as problem:errors.append(str(problem))
    return {'automated':'fail' if errors else 'pass','errors':errors,'facts':facts,'manualRequired':manual}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive',type=Path);p.add_argument('--output',type=Path);a=p.parse_args();r=check_archive(a.archive);text=json.dumps(r,ensure_ascii=False,indent=2)+'\n'
    if a.output:a.output.write_text(text)
    print(text,end='');return r['automated']!='pass'
if __name__=='__main__':raise SystemExit(main())
