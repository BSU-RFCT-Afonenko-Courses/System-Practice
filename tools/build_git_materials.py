#!/usr/bin/env python3
"""Предоставленные исходные файлы и начальные Git-репозитории курса."""

from collections.abc import Mapping
from typing import Protocol, TypedDict, runtime_checkable
import argparse
import json
import os
import shutil
import subprocess
import sys
import importlib.util
import re
import stat
import tempfile
from pathlib import Path
from build_materials import target, packed, atomic_write
from system_support import (
    read_json,
    json_object,
    json_string,
    json_strings,
    json_texts,
    safe_archive_name,
)


class GitState(TypedDict):
    refs: list[str]
    head: str
    status: str


class FileSeed(TypedDict):
    root: str
    files: dict[str, str]


def git_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(
        GIT_CONFIG_GLOBAL="/dev/null",
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_COUNT="0",
        GIT_OPTIONAL_LOCKS="0",
        GIT_INDEX_VERSION="2",
        GIT_AUTHOR_NAME="Учебный набор",
        GIT_AUTHOR_EMAIL="course-fixture@example.invalid",
        GIT_COMMITTER_NAME="Учебный набор",
        GIT_COMMITTER_EMAIL="course-fixture@example.invalid",
        GIT_AUTHOR_DATE="2026-10-16T00:00:00Z",
        GIT_COMMITTER_DATE="2026-10-16T00:00:00Z",
        LC_ALL="C.UTF-8",
        TZ="UTC",
    )
    return env


def git(repo: Path, *args: str, input: bytes | None = None) -> bytes:
    run = subprocess.run(
        ["git", "--no-optional-locks", *args],
        cwd=repo,
        env=git_env(),
        input=input,
        capture_output=True,
        timeout=15,
    )
    if run.returncode:
        raise ValueError("Git seed: " + run.stderr.decode("utf-8", errors="replace"))
    return run.stdout


def put(repo: Path, files: Mapping[str, str]) -> None:
    for name, text in files.items():
        p = target(repo, name)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))


def commit(repo: Path, files: Mapping[str, str], message: str) -> str:
    put(repo, files)
    git(repo, "add", "--all")
    git(repo, "-c", "commit.gpgsign=false", "commit", "-qm", message)
    return git(repo, "rev-parse", "HEAD").decode().strip()


def initialize(repo: Path, template: Path) -> None:
    repo.mkdir()
    git(
        repo,
        "init",
        "-q",
        "--initial-branch=main",
        "--object-format=sha1",
        "--template=" + str(template),
    )
    git(repo, "config", "--local", "core.filemode", "false")
    git(repo, "config", "--local", "core.autocrlf", "false")
    git(repo, "config", "--local", "core.logAllRefUpdates", "false")


def normalize(repo: Path) -> GitState:
    entries = git(repo, "ls-files", "--stage", "-z")
    (repo / ".git/index").unlink()
    git(repo, "update-index", "-z", "--index-info", input=entries)
    for name in ["COMMIT_EDITMSG", "ORIG_HEAD", "description"]:
        (repo / ".git" / name).unlink(missing_ok=True)
    shutil.rmtree(repo / ".git/logs", ignore_errors=True)
    return {
        "refs": git(repo, "show-ref").decode().splitlines(),
        "head": git(repo, "symbolic-ref", "HEAD").decode().strip(),
        "status": git(repo, "status", "--porcelain=v1").decode(),
    }


def read_seed(path: Path) -> dict[str, FileSeed]:
    result: dict[str, FileSeed] = {}
    for name, value in json_object(read_json(path)).items():
        spec = json_object(value)
        result[name] = {
            "root": json_string(spec["root"]),
            "files": json_texts(spec["files"]),
        }
    return result


def generate(seed: Mapping[str, FileSeed]) -> dict[str, bytes]:
    outputs: dict[str, bytes] = {}
    states: dict[str, object] = {}
    expected_roots = {
        "practice/materials/version-control-demo.zip": "latency-demo",
        "tasks/materials/version-control-start.zip": "versioning",
    }
    if set(seed) != set(expected_roots):
        raise ValueError("Нужны демонстрационный и стартовый архивы")
    for archive, spec in seed.items():
        if spec["root"] != expected_roots[archive]:
            raise ValueError("Неожиданный корень материала")
        entries = {
            spec["root"] + "/" + name: text for name, text in spec["files"].items()
        }
        outputs[archive] = packed(entries)
        states[archive] = {
            "root": spec["root"],
            "files": sorted(entries),
            "preparedHistory": False,
        }
    outputs["tasks/projects/version-control/initial-state.json"] = (
        json.dumps(states, ensure_ascii=False, indent=2) + "\n"
    ).encode()
    return outputs


@runtime_checkable
class _SeedRecipe(Protocol):
    def __call__(self, destination: Path, empty_template: Path) -> object: ...


def _provided_materials(root: Path) -> dict[str, bytes]:
    """Два предоставленных исходных репозитория; предыдущая выдача не читается."""
    base = "tasks/projects/version-control/"
    required = [
        "github-ssh/seed_recipe.py",
        "github-ssh/seed.json",
        "github-ssh/student/README.md",
        "restore-selected-state/seed_recipe.py",
        "restore-selected-state/student/README.md",
        "restore-selected-state/student/work/README.md",
        "restore-selected-state/student/work/notes.txt",
    ]
    inputs = {name: target(root, base + name) for name in required}
    if any(not path.is_file() for path in inputs.values()):
        raise ValueError("Отсутствует обычный источник предоставленного Git-материала")
    seed = json_object(read_json(inputs["github-ssh/seed.json"]))
    if set(seed) != {"S0", "S1"}:
        raise ValueError("Нужны исходные состояния S0 и S1")
    github = {**json_texts(seed["S0"]), **json_texts(seed["S1"])}
    for name in github:
        safe_archive_name(name)
        if ".git" in Path(name).parts:
            raise ValueError("История не задаётся исходными текстовыми файлами")
    expected = {
        "github-ssh": {name: text.encode("utf-8") for name, text in github.items()},
        "restore-selected-state": {
            name: inputs["restore-selected-state/student/work/" + name].read_bytes()
            for name in ["README.md", "notes.txt"]
        },
    }
    recipes: list[tuple[str, str, str, bytes, _SeedRecipe]] = []
    for project, prefix, archive in [
        ("github-ssh", "versioning/project", "version-control-github-ssh-start.zip"),
        (
            "restore-selected-state",
            "work",
            "version-control-restore-selected-state-start.zip",
        ),
    ]:
        readme = inputs[project + "/student/README.md"].read_bytes()
        source = inputs[project + "/seed_recipe.py"]
        spec = importlib.util.spec_from_file_location(
            "_sp_git_seed_" + project.replace("-", "_"), source
        )
        if spec is None or spec.loader is None:
            raise ValueError("Не удалось прочитать recipe: " + project)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        entry: object = getattr(module, "generate", None)
        if not isinstance(entry, _SeedRecipe):
            raise ValueError(
                "Recipe должен предоставлять callable generate: " + project
            )
        recipes.append((project, prefix, archive, readme, entry))
    outputs: dict[str, bytes] = {}
    for project, prefix, archive, readme, entry in recipes:
        with tempfile.TemporaryDirectory(prefix="sp-public-git-material-") as temporary:
            stage = Path(temporary)
            repository, template = stage / "repository", stage / "empty-template"
            template.mkdir()
            try:
                identity = json_object(entry(repository, template))
            except (TypeError, KeyError) as problem:
                raise ValueError("Неверный договор recipe: " + project) from problem
            keys = {"S0", "S1"} if project == "github-ssh" else {"A"}
            if set(identity) != keys | {"head", "refs", "status"}:
                raise ValueError("Неожиданные поля identity: " + project)
            identifiers = {key: json_string(identity[key]) for key in keys}
            if any(
                not re.fullmatch(r"[a-f0-9]{40}", value)
                for value in identifiers.values()
            ):
                raise ValueError("Identity требует SHA1 исходных коммитов: " + project)
            initial = identifiers["S1" if project == "github-ssh" else "A"]
            if (
                project == "github-ssh"
                and identifiers["S0"] == initial
                or json_string(identity["head"]) != "refs/heads/main"
                or json_strings(identity["refs"]) != [initial + " refs/heads/main"]
                or json_string(identity["status"]) != ""
            ):
                raise ValueError("Нужна точная чистая исходная main: " + project)
            if (
                set(path.name for path in stage.iterdir())
                != {"repository", "empty-template"}
                or not stat.S_ISDIR(repository.lstat().st_mode)
                or not stat.S_ISDIR(template.lstat().st_mode)
                or any(template.iterdir())
            ):
                raise ValueError("Посторонний либо небезопасный root Git stage")
            files: dict[str, bytes] = {}

            def collect(
                directory: Path, repository: Path, files: dict[str, bytes]
            ) -> None:
                for path in sorted(directory.iterdir()):
                    mode = path.lstat().st_mode
                    name = safe_archive_name(path.relative_to(repository).as_posix())
                    if stat.S_ISDIR(mode):
                        collect(path, repository, files)
                    elif stat.S_ISREG(mode):
                        if name in files:
                            raise ValueError("Повторный файл Git stage: " + name)
                        files[name] = path.read_bytes()
                    else:
                        raise ValueError(
                            "Symlink или специальный файл Git stage: " + name
                        )

            collect(repository, repository, files)
            ordinary = {
                name: data
                for name, data in files.items()
                if not name.startswith(".git/")
            }
            if ordinary != expected[project]:
                raise ValueError(
                    "Recipe изменяет предоставленные исходные файлы: " + project
                )
            if (
                files.get(".git/HEAD") != b"ref: refs/heads/main\n"
                or files.get(".git/refs/heads/main") != (initial + "\n").encode()
                or not files.get(".git/config")
                or not files.get(".git/index")
                or not any(name.startswith(".git/objects/") for name in files)
            ):
                raise ValueError(
                    "Нужен полный обычный исходный репозиторий: " + project
                )
            entries = {"README.md": readme}
            entries.update({prefix + "/" + name: data for name, data in files.items()})
            outputs["tasks/materials/" + archive] = packed(entries)
    return outputs


def build(root: str | Path) -> list[str]:
    root = Path(root).resolve(strict=True)
    seed = read_seed(target(root, "tasks/projects/version-control/seed.json"))
    outputs = generate(seed)
    names = {
        "practice/materials/version-control-demo.zip",
        "tasks/materials/version-control-start.zip",
        "tasks/projects/version-control/initial-state.json",
        "tasks/materials/version-control-github-ssh-start.zip",
        "tasks/materials/version-control-restore-selected-state-start.zip",
    }
    if set(outputs) != names - {
        "tasks/materials/version-control-github-ssh-start.zip",
        "tasks/materials/version-control-restore-selected-state-start.zip",
    }:
        raise ValueError("Не объявлено назначение набора")
    destinations = {name: target(root, name) for name in names}
    outputs.update(_provided_materials(root))
    if set(outputs) != names:
        raise ValueError("Не подготовлены все объявленные Git-материалы")
    # Любой отказ входов/recipe/identity/состава происходит до первой публичной записи.
    planned = [(destinations[name], data) for name, data in outputs.items()]
    for path, data in planned:
        atomic_write(path, data)
    return list(outputs)


class Options(argparse.Namespace):
    root: Path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    a = p.parse_args(namespace=Options())
    print(json.dumps(build(a.root), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as e:
        print(e, file=sys.stderr)
        raise SystemExit(1) from None
