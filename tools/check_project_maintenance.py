#!/usr/bin/env python3
"""Наблюдать файлы и отношения истории сопровождения; приёмы принимает преподаватель."""
import argparse
import configparser
import hashlib
import json
import posixpath
import re
import tempfile
from pathlib import Path, PurePosixPath
from system_support import ArchiveError, ArchiveLimit, read_zip
from check_version_control import Repository, GitDataError, ToolLimit, ATTR, normalized_work, _read_submission, _remotes, _config_value

ROOT=Path(__file__).resolve().parents[1]
INITIAL=ROOT/'tasks/projects/project-maintenance/initial-state.json'
PREFIX='maintenance/'
INSTRUCTIONS='Проверьте входные данные.\nСохраните признак качества.\n'.encode()


def repository(files,folder,name,temporary,bare=False):
    start=PREFIX+folder+'/'
    converted={'versioning/'+name+'/'+('.git/' if bare else '')+n[len(start):]:v for n,v in files.items() if n.startswith(start)}
    return Repository(converted,name,temporary)


def text_files(files):
    """Проверить опубликованную область обычных UTF-8 документов."""
    result=normalized_work(files)
    if any(not data.endswith(b'\n') or b'\0' in data for data in result.values()):
        raise GitDataError('Документы должны быть текстом UTF-8 без BOM с завершающим LF/CRLF')
    return result


def portable_origin(value):
    if not value or value.startswith(('/', '\\')) or ':' in value:return False
    return posixpath.normpath('maintenance/work/'+value.replace('\\','/'))=='maintenance/shared.git'


def bare_config(repo):
    parser=configparser.RawConfigParser(strict=False,allow_no_value=True,default_section='')
    raw=repo.files.get('.git/config',b'').decode('utf-8')
    # Git объединяет core/CORE по порядку; секция DEFAULT не задаёт наследования.
    raw=re.sub(r'(?im)^[ \t]*\[[ \t]*core[ \t]*\]', '[core]', raw)
    parser.read_string(raw)
    return _config_value(parser.get('core','bare',raw=True,fallback='')).lower() in ('true','yes','on','1')


def check_archive(path,initial_path=INITIAL):
    errors=[];facts={}
    manual=['Наблюдения fetch/push, фактической остановки merge на конфликте и сохранения рабочей копии.',
            'Проверка/применение входного патча средствами Git и создание git archive; итоговые файлы приёмов не доказывают.',
            'Смысл CHANGELOG, сообщений/аннотации, дополнительных документов, инструкции и разрешения конфликта.',
            'Сопоставление собственных ID P/R и выбранной ветки с explanation; ОС/оболочка и перенос восстановленной сдачи.']
    try:
        archive=_read_submission(path);files=archive.files
        allowed=(PREFIX+'work/',PREFIX+'shared.git/',PREFIX+'incoming/')
        extras={PREFIX+n for n in ['release.patch','report-2.0.zip','explanation.md']}
        if any(not n.startswith(allowed) and n not in extras for n in files):raise GitDataError('Нужен корень maintenance с work, shared.git, incoming и файлами выпуска')
        if any(n not in ('maintenance','maintenance/work','maintenance/shared.git','maintenance/incoming') and not (n+'/').startswith(allowed) for n in archive.directories):
            raise GitDataError('В полной сдаче найден посторонний каталог')
        if not files.get(PREFIX+'explanation.md',b'').decode('utf-8-sig').strip():raise GitDataError('Нужно непустое explanation.md UTF-8')
        initial=json.loads(Path(initial_path).read_text())['tasks/materials/project-maintenance-start.zip']
        a,m,f=(initial[k] for k in ['A','M','F'])
        incoming={n:v for n,v in files.items() if n.startswith(PREFIX+'incoming/')}
        if set(incoming)!={PREFIX+'incoming/review.patch'} or hashlib.sha256(incoming[PREFIX+'incoming/review.patch']).hexdigest()!=initial['patch']['sha256']:
            raise GitDataError('Исходный incoming/review.patch должен сохраняться')
        with tempfile.TemporaryDirectory(prefix='maintenance-facts-') as temporary:
            temp=Path(temporary);work=repository(files,'work','work',temp);shared=repository(files,'shared.git','shared',temp,bare=True)
            for repo in [work,shared]:
                if repo.git('symbolic-ref','HEAD').strip()!=b'refs/heads/main':raise GitDataError('HEAD должен выбирать main')
                if repo.ref('refs/tags/base')!=a:raise GitDataError('Изменён исходный base')
            if work.ref('refs/tags/start')!=m or shared.ref('refs/tags/incoming')!=f:raise GitDataError('Изменены start/incoming')
            if '.git/index' not in work.files:raise GitDataError('У work отсутствует .git/index')
            if not bare_config(shared):raise GitDataError('shared.git должен сохранять core.bare=true')
            origin=_remotes(work).get('origin')
            if not portable_origin(origin):raise GitDataError('origin должен переносимо указывать на соседний shared.git')
            r=work.ref('refs/heads/main');tree=work.tree(r);text=text_files(tree)
            if work.index()!=tree or not work.index_modes_match_tree(r) or text_files(work.work)!=text:
                raise GitDataError('Индекс и рабочие файлы должны совпадать с main без незавершённой работы')
            if any(line.startswith((b'<<<<<<< ',b'>>>>>>> ')) for data in text.values() for line in data.splitlines()):
                raise GitDataError('В итоговых документах остались маркеры конфликта')
            wanted={'.gitattributes':ATTR,'report.ini':b'format=csv\ncolumns=code,value,quality\ndecimal=dot\n','instructions.txt':INSTRUCTIONS,'VERSION':b'2.0\n'}
            for name,data in wanted.items():
                if text.get(name)!=data:raise GitDataError('Итоговый '+name+' отличается от договора')
            if tree['.gitattributes']!=ATTR:raise GitDataError('Исходная .gitattributes должна сохраняться')
            changelog=text.get('CHANGELOG.md',b'').decode('utf-8')
            if not any(line.lstrip().startswith('#') and line.lstrip('# ').strip()=='2.0' for line in changelog.splitlines()):
                raise GitDataError('CHANGELOG.md нужен заголовок версии 2.0; содержание принимает преподаватель')
            ancestors=work.commits(r)
            if len(ancestors)>256:raise ToolLimit('Средство не завершило автоматическую проверку истории свыше локального предела 256 коммитов; нарушение договора не установлено, нужна ручная проверка')
            parents={oid:work.parents(oid) for oid in ancestors}
            expected={**work.tree(a),'instructions.txt':INSTRUCTIONS};modes=work.tree_modes(a)
            branches=work.git('for-each-ref','--format=%(objectname) %(refname)','refs/heads/').decode().splitlines()
            matches={oid:[line.split(' ',1)[1] for line in branches if line.split(' ',1)[0]==oid and line.split(' ',1)[1]!='refs/heads/main']
                     for oid in ancestors if parents[oid]==[a] and work.tree(oid)==expected and work.tree_modes(oid)==modes}
            matches={oid:names for oid,names in matches.items() if names}
            if not matches:raise GitDataError('Не найден обычный P непосредственно от A с точным патчем, режимами A и сохранённой отдельной веткой')
            p=next(iter(matches))
            if not {a,m,f,p}<=ancestors:raise GitDataError('main должен сохранять A, M, F и P как предков')
            if not any(len(pp)>=2 for pp in parents.values()):raise GitDataError('Нужно объединение исходных линий коммитами merge')
            if work.git('cat-file','-t','refs/tags/v2.0').strip()!=b'tag':raise GitDataError('v2.0 должен быть аннотированный тег')
            if work.ref('refs/tags/v2.0^{commit}')!=r:raise GitDataError('v2.0 должен обозначать итоговый main')
            tag=work.ref('refs/tags/v2.0');tag_body=work.git('cat-file','tag',tag)
            if not tag_body.partition(b'\n\n')[2].strip():raise GitDataError('Нужна непустая аннотация v2.0')
            if shared.ref('refs/heads/main')!=r or shared.ref('refs/tags/v2.0')!=tag:raise GitDataError('shared.git должен получить итоговый main и тот же объект v2.0')
            # Объекты читаются с проверкой хешей и связности, без конфигурации сдачи.
            for repo in [work,shared]:repo.git('fsck','--full','--no-reflogs','--no-dangling','--no-progress',r,tag,a,m,f,p)
            if (shared.git('cat-file','-t',tag).strip()!=b'tag' or shared.ref('refs/tags/v2.0^{commit}')!=r
                    or shared.git('cat-file','tag',tag)!=tag_body or shared.tree(r)!=tree):
                raise GitDataError('shared.git должен содержать те же объекты тега и дерева main')
            release=files.get(PREFIX+'report-2.0.zip')
            if release is None:raise GitDataError('Отсутствует report-2.0.zip')
            release_path=temp/'release.zip';release_path.write_bytes(release);release_archive=read_zip(release_path)
            expected_release={'report-2.0/'+n:v for n,v in tree.items()}
            directories={parent.as_posix() for name in expected_release for parent in PurePosixPath(name).parents if parent.as_posix()!='.'}
            if release_archive.directories-directories:raise GitDataError('report-2.0.zip содержит посторонний каталог, в том числе .git')
            if release_archive.files!=expected_release:raise GitDataError('report-2.0.zip должен содержать все пути и байты main под report-2.0/')
            patch=files.get(PREFIX+'release.patch')
            if not patch:raise GitDataError('Нужен непустой release.patch от start к выпуску')
            patch_path=temp/'release.patch';patch_path.write_bytes(patch)
            # Применяем изменения только к частному индексу, без рабочего дерева сдачи.
            work.git('read-tree',m)
            try:
                work.git('apply','--cached','--check','--binary','--unidiff-zero',str(patch_path))
                work.git('apply','--cached','--binary','--unidiff-zero',str(patch_path))
            except ToolLimit:raise
            except GitDataError as problem:raise GitDataError('release.patch не применяется к start: '+str(problem)) from problem
            if work.index()!=tree or not work.index_modes_match_tree(r):raise GitDataError('release.patch на start не воспроизводит дерево main')
            facts.update(main=r,patchCommit=p,patchBranches=matches[p],annotatedTag=tag,sharedMain=r,releaseFiles=sorted(tree),patchReproducesMain=True,origin=origin)
    except (ArchiveLimit,ToolLimit) as problem:
        return {'automated':'manual','toolLimited':True,'errors':[],'diagnostics':[str(problem)],'facts':facts,'manualRequired':manual}
    except (ArchiveError,GitDataError,UnicodeError,ValueError,OSError,KeyError,configparser.Error) as problem:errors.append(str(problem))
    return {'automated':'fail' if errors else 'pass','errors':errors,'facts':facts,'manualRequired':manual}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args()
    result=check_archive(args.archive);text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:args.output.write_text(text)
    print(text,end='');return 2 if result.get('toolLimited') else result['automated']!='pass'
if __name__=='__main__':raise SystemExit(main())
