"""Собственные истории Git для технических тестов с локальным транспортом."""
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import zipfile

README = '# Измерения задержки\n\nmeasurements.tsv хранит задержки двух датчиков в миллисекундах.\nВ отчёт включаются измерения не выше порога из criteria.txt.\n'
MEASUREMENTS = b'sensor\tlatency_ms\nnorth\t18\nsouth\t28\n'


def run(repo, *args, ok=True):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1',
               GIT_AUTHOR_NAME='Fixture learner', GIT_AUTHOR_EMAIL='learner@example.invalid',
               GIT_COMMITTER_NAME='Fixture learner', GIT_COMMITTER_EMAIL='learner@example.invalid',
               GIT_AUTHOR_DATE='2031-02-03T04:05:06Z', GIT_COMMITTER_DATE='2031-02-03T04:05:06Z')
    p = subprocess.run(['git', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
                        *args], cwd=repo, env=env, capture_output=True, timeout=15)
    if ok and p.returncode:
        raise RuntimeError(p.stderr.decode(errors='replace'))
    return p


def commit(repo, message):
    run(repo, 'add', '--all'); run(repo, 'commit', '-qm', message)
    return run(repo, 'rev-parse', 'HEAD').stdout.decode().strip()


def sync(base):
    project = base / 'project'; verification = base / 'verification'
    if verification.exists(): shutil.rmtree(verification)
    run(base, 'clone', '--no-local', str(project), str(verification))
    run(project, 'remote', 'remove', 'course', ok=False)
    run(project, 'remote', 'add', 'course', 'git@fixture-github:owner/latency.git')
    run(verification, 'remote', 'set-url', 'origin', 'ssh://git@github.com/owner/latency.git')


def solution(root, reverse=False, extras=False, threshold='0.030', branch='seconds-unit'):
    base = root / 'versioning'; project = base / 'project'; project.mkdir(parents=True)
    template = root / 'template'; template.mkdir()
    run(project, 'init', '-q', '-b', 'main', '--template=' + str(template))
    (project / 'README.md').write_text(README)
    (project / 'measurements.tsv').write_bytes(MEASUREMENTS)
    (project / 'criteria.txt').write_text('latency_limit = 25 ms\n')
    a = commit(project, 'Сохранить исходные измерения')
    common = a
    if extras:
        (project / 'notes.txt').write_text('Проверка единиц измерения.\n')
        common = commit(project, 'Добавить заметки перед ветвлением')
    (project / 'criteria.txt').write_text('latency_limit = 30 ms\n')
    b = commit(project, 'Допустить измерение south')
    if extras:
        (project / 'main-note.txt').write_text('Порог включает 28 ms.\n')
        commit(project, 'Объяснить выбор порога')
    run(project, 'switch', '-c', branch, common)
    (project / 'criteria.txt').write_text('latency_limit = 0.025 s\n')
    (project / 'README.md').write_text(README + 'Порог выражен в секундах; измерения остаются в ms.\n')
    f = commit(project, 'Перевести единицу порога в секунды')
    if extras:
        (project / 'unit-note.txt').write_text('1000 ms = 1 s\n')
        commit(project, 'Записать соотношение единиц')
    if reverse:
        merge = run(project, 'merge', '--no-edit', 'main', ok=False)
    else:
        run(project, 'switch', 'main')
        merge = run(project, 'merge', '--no-edit', branch, ok=False)
    assert merge.returncode == 1, merge.stderr
    assert (project / '.git/MERGE_HEAD').is_file()
    assert run(project, 'ls-files', '-u').stdout
    (project / 'criteria.txt').write_text(f'latency_limit = {threshold} s\n')
    d = commit(project, 'Согласовать порог 30 ms в секундах')
    if reverse:
        run(project, 'switch', 'main'); run(project, 'merge', '--ff-only', branch)
    if extras:
        (project / 'reference.bin').write_bytes(b'\x89PNG\x00\xff\x01')
        commit(project, 'Добавить дополнительный справочный файл')
    sync(base)
    (base / 'explanation.md').write_text(f'A={a}\nB={b}\nF={f}\nD={d}\nЛокальный fixture; смысл и реальный SSH проверяются человеком.\n')
    return base, {'A': a, 'B': b, 'F': f, 'D': d, 'branch': branch}


def package(base, output):
    if output.name.endswith('.tar.gz'):
        with tarfile.open(output, 'w:gz') as archive: archive.add(base, arcname='versioning')
    else:
        with zipfile.ZipFile(output, 'w') as archive:
            for path in base.rglob('*'):
                if path.is_file(): archive.write(path, path.relative_to(base.parent))
    return output
