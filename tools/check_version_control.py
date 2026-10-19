#!/usr/bin/env python3
"""Установить факты Git-сдачи; объяснение истории оценивается отдельно."""
import argparse
import configparser
from decimal import Decimal
import re
from urllib.parse import urlsplit
import json
import os
from pathlib import Path
import resource
import subprocess
import tempfile
from system_support import ArchiveError,ArchiveLimit,read_zip,read_tar_gz

ROOT=Path(__file__).resolve().parents[1]
ATTR=b'* text=auto eol=lf\n'
ORIGINAL_README=b'# \xd0\x98\xd0\xb7\xd0\xbc\xd0\xb5\xd1\x80\xd0\xb5\xd0\xbd\xd0\xb8\xd1\x8f \xd0\xb7\xd0\xb0\xd0\xb4\xd0\xb5\xd1\x80\xd0\xb6\xd0\xba\xd0\xb8\n\nmeasurements.tsv \xd1\x85\xd1\x80\xd0\xb0\xd0\xbd\xd0\xb8\xd1\x82 \xd0\xb7\xd0\xb0\xd0\xb4\xd0\xb5\xd1\x80\xd0\xb6\xd0\xba\xd0\xb8 \xd0\xb4\xd0\xb2\xd1\x83\xd1\x85 \xd0\xb4\xd0\xb0\xd1\x82\xd1\x87\xd0\xb8\xd0\xba\xd0\xbe\xd0\xb2 \xd0\xb2 \xd0\xbc\xd0\xb8\xd0\xbb\xd0\xbb\xd0\xb8\xd1\x81\xd0\xb5\xd0\xba\xd1\x83\xd0\xbd\xd0\xb4\xd0\xb0\xd1\x85.\n\xd0\x92 \xd0\xbe\xd1\x82\xd1\x87\xd1\x91\xd1\x82 \xd0\xb2\xd0\xba\xd0\xbb\xd1\x8e\xd1\x87\xd0\xb0\xd1\x8e\xd1\x82\xd1\x81\xd1\x8f \xd0\xb8\xd0\xb7\xd0\xbc\xd0\xb5\xd1\x80\xd0\xb5\xd0\xbd\xd0\xb8\xd1\x8f \xd0\xbd\xd0\xb5 \xd0\xb2\xd1\x8b\xd1\x88\xd0\xb5 \xd0\xbf\xd0\xbe\xd1\x80\xd0\xbe\xd0\xb3\xd0\xb0 \xd0\xb8\xd0\xb7 criteria.txt.\n'
MEASUREMENTS=b'sensor\tlatency_ms\nnorth\t18\nsouth\t28\n'

class GitDataError(ValueError):pass

class ToolLimit(GitDataError):pass

def limits():
    # Проверка работает на локальном Linux преподавателя и не исполняет программы студента.
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
        # При упакованных refs отдельных файлов ссылок нет; Git по-прежнему нужен каталог.
        (self.gitdir/'objects').mkdir();(self.gitdir/'refs').mkdir()
        # Копируем данные; config, hooks, attributes, исполняемые helpers и журналы не используются.
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
            except (OSError,subprocess.TimeoutExpired) as e:raise ToolLimit(f'Git не завершил безопасное чтение; требуется ручная проверка: {e}') from e
            out.seek(0);data=out.read(1024*1024+1)
            if len(data)>1024*1024 or p.returncode < 0:
                raise ToolLimit('Git исчерпал лимит вывода/ресурсов; требуется ручная проверка')
            if p.returncode:
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
    def index_modes_match_tree(self,oid):
        """Сравнить режимы Git; права рабочего файла из ZIP здесь не используются."""
        def modes(raw):
            return {name:meta.split()[0] for meta,name in
                    (entry.split(b'\t',1) for entry in raw.split(b'\0') if entry)}
        return modes(self.git('ls-files','--stage','-z'))==modes(self.git('ls-tree','-rz',oid))
    def commits(self,oid):return set(self.git('rev-list',oid).decode().split())

def encoded(mapping):return {name:text.encode() for name,text in mapping.items()}
def normalized_work(files):
    result={}
    for name,data in files.items():
        text=data.decode('utf-8')
        if text.startswith('\ufeff') or '\r' in text.replace('\r\n',''):raise GitDataError('Рабочие файлы должны быть UTF-8 без BOM, LF/CRLF')
        result[name]=text.replace('\r\n','\n').encode()
    return result

def _normalized_files(files):
    """Нормализовать окончания строк; дополнительные двоичные файлы сохраняются побайтно."""
    result = {}
    for name, data in files.items():
        try: data.decode('utf-8')
        except UnicodeDecodeError: result[name] = data
        else: result[name] = data.replace(b'\r\n', b'\n')
    return result


def _config_value(value):
    if value is None: return ''
    result = []; quoted = False; escaped = False
    escapes = {'n': '\n', 't': '\t', 'b': '\b', '\\': '\\', '"': '"'}
    for character in value:
        if escaped:
            if character not in escapes: raise GitDataError('Неизвестная escape-последовательность в remote URL')
            result.append(escapes[character]); escaped = False
        elif character == '\\': escaped = True
        elif character == '"': quoted = not quoted
        elif not quoted and character in '#;': break
        else: result.append(character)
    if quoted or escaped: raise GitDataError('Незавершённая строка remote URL в .git/config')
    return ''.join(result).rstrip()


def _remotes(repo):
    # Читаем данные: ConfigParser не обрабатывает Git include/includeIf и не вызывает helpers.
    parser = configparser.RawConfigParser(strict=False, allow_no_value=True)
    try: parser.read_string(repo.files.get('.git/config', b'').decode('utf-8'))
    except (configparser.Error, UnicodeError) as error:
        raise GitDataError('Не удалось прочитать адреса remote из .git/config') from error
    result = {}
    for section in parser.sections():
        match = re.fullmatch(r'remote\s+"([^"]+)"', section, re.I)
        if match and parser.has_option(section, 'url'):
            result[match.group(1)] = _config_value(parser.get(section, 'url', raw=True))
    return result


def _ssh_address(value):
    if not value: return False
    if re.match(r'^[A-Za-z]:[/\\]', value): return False
    if '://' in value:
        parsed = urlsplit(value)
        return bool(parsed.scheme == 'ssh' and parsed.hostname and parsed.path.strip('/'))
    # В форме SCP допустим SSH Host alias; направление проверяется отдельным наблюдением.
    return bool(re.fullmatch(r'(?:[^/@:\s]+@)?[^/\\:\s]+:[^\s]+', value))


def _read_submission(path):
    with Path(path).open('rb') as stream: magic = stream.read(4)
    if magic.startswith(b'PK'): return read_zip(path)
    if magic.startswith(b'\x1f\x8b'): return read_tar_gz(path)
    raise ArchiveError('Нужен ZIP или tar.gz с полным каталогом versioning')


def _history(repo, head):
    commits = repo.commits(head)
    if len(commits) > 256:
        raise ToolLimit('Средство не завершило автоматическую проверку: история превышает локальный предел 256 коммитов. Нужна ручная проверка; нарушение учебного договора не установлено.')
    trees = {oid: _normalized_files(repo.tree(oid)) for oid in commits}
    parents = {oid: repo.parents(oid) for oid in commits}
    ancestry = {}
    def ancestors(oid):
        if oid not in ancestry: ancestry[oid] = repo.commits(oid)
        return ancestry[oid]
    def state(oid, value, unit):
        tree = trees[oid]
        raw = tree.get('criteria.txt', b'')
        match = re.fullmatch(rb'latency_limit\s*=\s*([0-9]+(?:\.[0-9]+)?)\s+(ms|s)\s*\n?', raw)
        return bool(match and Decimal(match[1].decode()) == Decimal(value)
                    and match[2].decode() == unit
                    and tree.get('measurements.tsv') == MEASUREMENTS
                    and tree.get('README.md', b'').decode('utf-8').strip())
    roots = [oid for oid in commits if not parents[oid] and state(oid, '25', 'ms')
             and trees[oid]['README.md'] == ORIGINAL_README]
    branches = repo.git('for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads/').decode().splitlines()
    for a in roots:
        b_states = [oid for oid in commits if state(oid, '30', 'ms') and a in ancestors(oid)]
        f_states = [oid for oid in commits if state(oid, '0.025', 's') and a in ancestors(oid)
                    and trees[oid]['README.md'] != ORIGINAL_README]
        for b in b_states:
            for f in f_states:
                if b in ancestors(f) or f in ancestors(b): continue
                for d in commits:
                    pp = parents[d]
                    if len(pp) != 2 or not state(d, '0.030', 's'): continue
                    if not ((b in ancestors(pp[0]) and f in ancestors(pp[1]))
                            or (f in ancestors(pp[0]) and b in ancestors(pp[1]))): continue
                    saved = [line.split(' ', 1)[1] for line in branches
                             if line.split(' ', 1)[1] != 'refs/heads/main'
                             and line.split(' ', 1)[0] in commits
                             and f in ancestors(line.split(' ', 1)[0])]
                    if saved: return {'A': a, 'B': b, 'F': f, 'D': d, 'workingBranches': saved}
    raise GitDataError('Не найдены исходный A, расходящиеся B/F, двухродительский D и сохранённая рабочая ветка')


def check_archive(path):
    errors = []; facts = {}
    manual = ['Смысл README, сообщений и explanation.md; сопоставление собственных ID с найденными A/B/F/D.',
              'Наблюдение индекса, фактической остановки на конфликте и содержательного перевода единиц.',
              'Реальные GitHub/SSH: ключ сервера, аккаунт, код теста 1, push, серверный ID и SSH clone; локальные URL/файлы этого не доказывают.',
              'Выбор Windows OpenSSH/агента и оболочки; SSH Host aliases и override требуют внешнего наблюдения.']
    try:
        archive = _read_submission(path); files = archive.files
        allowed = ('versioning/project/', 'versioning/verification/')
        if any(n != 'versioning/explanation.md' and not n.startswith(allowed) for n in files):
            raise GitDataError('Нужен один корень versioning с project, verification и explanation.md')
        if any(n not in ('versioning', 'versioning/project', 'versioning/verification')
               and not n.startswith(allowed) for n in archive.directories):
            raise GitDataError('В архиве найден посторонний каталог вне project/verification')
        if not files.get('versioning/explanation.md', b'').decode('utf-8-sig').strip():
            raise GitDataError('Нужно непустое пояснение UTF-8; содержание проверяется человеком')
        with tempfile.TemporaryDirectory(prefix='git-data-check-') as temporary:
            repos = {}; final = {}
            for name in ['project', 'verification']:
                repo = Repository(files, name, Path(temporary)); repos[name] = repo
                if '.git/index' not in repo.files: raise GitDataError(f'{name}: отсутствует .git/index')
                if repo.git('symbolic-ref', 'HEAD').strip() != b'refs/heads/main':
                    raise GitDataError(f'{name}: HEAD должен выбирать main')
                head = repo.ref('refs/heads/main'); tree = _normalized_files(repo.tree(head))
                if (_normalized_files(repo.index()) != tree or not repo.index_modes_match_tree(head)
                        or _normalized_files(repo.work) != tree):
                    raise GitDataError(f'{name}: индекс и рабочие файлы должны совпадать с main')
                for data in tree.values():
                    if any(line.startswith((b'<<<<<<< ', b'>>>>>>> ')) for line in data.splitlines()):
                        raise GitDataError(f'{name}: в итоговых файлах остались маркеры конфликта')
                raw = tree.get('criteria.txt', b'')
                match = re.fullmatch(rb'latency_limit\s*=\s*(0\.0*30*)\s+s\s*\n?', raw)
                if not match or Decimal(match[1].decode()) != Decimal('0.030') or tree.get('measurements.tsv') != MEASUREMENTS:
                    raise GitDataError(f'{name}: итоговый порог должен быть 0.030 s, измерения сохраняются')
                if not tree.get('README.md', b'').decode('utf-8').strip():
                    raise GitDataError(f'{name}: нужен README.md; смысл пояснения единиц проверяется вручную')
                repo.git('fsck', '--full', '--no-reflogs', '--no-dangling', '--no-progress', head)
                final[name] = (head, tree); facts[name + 'Remotes'] = _remotes(repo)
            if final['project'] != final['verification']:
                raise GitDataError('project и verification должны иметь одинаковый main и снимок')
            if not any(_ssh_address(url) for url in facts['projectRemotes'].values()):
                raise GitDataError('У project нужен remote с SSH-адресом; реальный обмен проверяется отдельно')
            if not _ssh_address(facts['verificationRemotes'].get('origin')):
                raise GitDataError('У verification нужен origin с SSH-адресом')
            relations = _history(repos['project'], final['project'][0])
            if not set(relations[k] for k in ['A', 'B', 'F', 'D']) <= repos['verification'].commits(final['verification'][0]):
                raise GitDataError('verification не сохраняет требуемую историю')
            facts.update(relations, main=final['project'][0], externalSSH='manualRequired')
    except (ToolLimit, ArchiveLimit) as error:
        return {'automated': 'manual', 'toolLimited': True, 'errors': [], 'diagnostics': [str(error)],
                'facts': facts, 'manualRequired': manual}
    except (ArchiveError, GitDataError, UnicodeError, ValueError, OSError) as error:
        errors.append(str(error))
    return {'automated': 'fail' if errors else 'pass', 'errors': errors, 'facts': facts, 'manualRequired': manual}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args()
    result=check_archive(args.archive);text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:args.output.write_text(text)
    print(text,end='');return 2 if result.get('toolLimited') else result['automated']!='pass'
if __name__=='__main__':raise SystemExit(main())
