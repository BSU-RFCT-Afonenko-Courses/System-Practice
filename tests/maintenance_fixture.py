"""Только преподавательские варианты истории; не включаются в учебную публикацию."""
import os,subprocess,zipfile
from pathlib import Path
from build_materials import packed
from build_maintenance_materials import build


def run(repo,*args,ok=True):
    env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_AUTHOR_NAME='Иной автор',GIT_AUTHOR_EMAIL='other@example.invalid',GIT_COMMITTER_NAME='Иной автор',GIT_COMMITTER_EMAIL='other@example.invalid',GIT_AUTHOR_DATE='2030-01-02T03:04:05Z',GIT_COMMITTER_DATE='2030-01-02T03:04:05Z')
    p=subprocess.run(['git','--no-optional-locks',*args],cwd=repo,env=env,capture_output=True,timeout=10)
    if ok and p.returncode:raise RuntimeError(p.stderr.decode(errors='replace'))
    return p


def solution(root,order='remote-first',bad_parent=False):
    build(root,write=True)
    with zipfile.ZipFile(root/'tasks/materials/project-maintenance-start.zip') as z:z.extractall(root/'attempt') # Owned fixture only.
    base=root/'attempt/maintenance';w=base/'work'
    run(w,'remote','add','origin','../shared.git');run(w,'fetch','origin')
    run(w,'switch','-c','review-note','start' if bad_parent else 'base')
    run(w,'apply','--check','../incoming/review.patch');run(w,'apply','../incoming/review.patch');run(w,'add','instructions.txt');run(w,'commit','-qm','Добавить правило проверки')
    run(w,'switch','main')
    if order=='patch-first':run(w,'merge','--no-edit','review-note')
    merged=run(w,'merge','--no-edit','origin/main',ok=False)
    if merged.returncode!=1:raise RuntimeError('Expected actual merge conflict')
    (w/'report.ini').write_bytes(b'format=csv\ncolumns=code,value,quality\ndecimal=dot\n')
    run(w,'add','report.ini');run(w,'commit','-qm','Объединить описание CSV и quality')
    if order=='remote-first':run(w,'merge','--no-edit','review-note')
    (w/'VERSION').write_bytes(b'2.0\n');(w/'CHANGELOG.md').write_bytes('# 2.0\n\nCSV сохраняет value и quality; инструкция требует проверки флага.\n'.encode())
    run(w,'add','VERSION','CHANGELOG.md');run(w,'commit','-qm','Подготовить выпуск 2.0')
    finish(base)
    (base/'explanation.md').write_text('Наблюдение fetch, конфликт columns, отдельный патч от base и отправка выпуска. Ручной разбор обязателен.\n')
    return base


def finish(base,lightweight=False):
    w=base/'work';run(w,'tag','-d','v2.0',ok=False)
    run(w,'tag',*(['v2.0'] if lightweight else ['-a','v2.0','-m','Выпуск CSV с quality и проверкой']))
    run(w,'push','origin','main');run(w,'push','--force','origin','refs/tags/v2.0') # Own disposable fixture only; learner contract forbids force.
    run(w,'diff','--binary','--output=../release.patch','start','v2.0')
    run(w,'archive','--format=zip','--prefix=report-2.0/','--output=../report-2.0.zip','v2.0')


def package(base,output):
    output.write_bytes(packed({p.relative_to(base.parent).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file()}));return output
