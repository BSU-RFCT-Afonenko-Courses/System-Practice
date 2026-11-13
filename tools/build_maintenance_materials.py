#!/usr/bin/env python3
"""Воспроизводимая локальная Git-поставка сопровождения по авторскому договору."""

from collections.abc import Mapping
from typing import TypedDict
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from build_materials import target, packed, atomic_write
from system_support import read_json, json_object, json_string, json_strings, json_texts
from build_git_materials import git as seed_git, put, initialize, normalize


class HistoryNode(TypedDict):
    parents: list[str]
    files: dict[str, str]


class Patch(TypedDict):
    name: str
    path: str
    text: str


class MaintenanceSeed(TypedDict):
    root: str
    history: dict[str, HistoryNode]
    workHead: str
    workBranches: dict[str, str]
    workTags: dict[str, str]
    sharedHead: str
    sharedTags: dict[str, str]
    patchBase: str
    patch: Patch


DIRECTORY = "tasks/projects/project-maintenance"
ARCHIVES = {
    "practice/materials/project-maintenance-demo.zip",
    "tasks/materials/project-maintenance-start.zip",
}


def git(repo: Path, *args: str, input: bytes | None = None) -> bytes:
    """Хранить объекты набора без зависимости от алгоритма сжатия zlib Git."""
    return seed_git(repo, "-c", "core.looseCompression=0", *args, input=input)


def read_seed(path: Path) -> dict[str, MaintenanceSeed]:
    result: dict[str, MaintenanceSeed] = {}
    for name, value in json_object(read_json(path)).items():
        spec = json_object(value)
        history: dict[str, HistoryNode] = {}
        for label, raw_node in json_object(spec["history"]).items():
            node = json_object(raw_node)
            history[label] = {
                "parents": json_strings(node["parents"]),
                "files": json_texts(node["files"]),
            }
        patch = json_texts(spec["patch"])
        result[name] = {
            "root": json_string(spec["root"]),
            "history": history,
            "workHead": json_string(spec["workHead"]),
            "workBranches": json_texts(spec["workBranches"]),
            "workTags": json_texts(spec["workTags"]),
            "sharedHead": json_string(spec["sharedHead"]),
            "sharedTags": json_texts(spec["sharedTags"]),
            "patchBase": json_string(spec["patchBase"]),
            "patch": {
                "name": patch["name"],
                "path": patch["path"],
                "text": patch["text"],
            },
        }
    return result


def generate(seed: Mapping[str, MaintenanceSeed]) -> dict[str, bytes]:
    if set(seed) != ARCHIVES:
        raise ValueError("Нужны ровно демонстрационный и самостоятельный наборы")
    roots = {
        "practice/materials/project-maintenance-demo.zip": "maintenancelab",
        "tasks/materials/project-maintenance-start.zip": "maintenance",
    }
    if any(spec.get("root") != roots[name] for name, spec in seed.items()):
        raise ValueError(
            "Корень исходного набора не соответствует объявленной поставке"
        )
    outputs: dict[str, bytes] = {}
    states: dict[str, object] = {}
    with tempfile.TemporaryDirectory(prefix="maintenance-seed-") as temporary:
        parent = Path(temporary)
        template = parent / "template"
        template.mkdir()
        for archive, spec in seed.items():
            base = parent / spec["root"]
            base.mkdir()
            work = base / "work"
            initialize(work, template)
            ids: dict[str, str] = {}
            # Создаём объявленные снимки и родителей; личная конфигурация не участвует.
            for label, node in spec["history"].items():
                git(work, "read-tree", "--empty")
                for name, text in sorted(node["files"].items()):
                    target(work, name)
                    blob = (
                        git(work, "hash-object", "-w", "--stdin", input=text.encode())
                        .decode()
                        .strip()
                    )
                    git(
                        work,
                        "update-index",
                        "--add",
                        "--cacheinfo",
                        "100644",
                        blob,
                        name,
                    )
                tree = git(work, "write-tree").decode().strip()
                parents: list[str] = []
                for predecessor in node["parents"]:
                    parents += ["-p", ids[predecessor]]
                ids[label] = (
                    git(
                        work,
                        "commit-tree",
                        tree,
                        *parents,
                        "-m",
                        "Учебное состояние " + label,
                    )
                    .decode()
                    .strip()
                )
            git(work, "update-ref", "refs/heads/main", ids[spec["workHead"]])
            for name, label in spec["workBranches"].items():
                git(work, "update-ref", "refs/heads/" + name, ids[label])
            for name, label in spec["workTags"].items():
                git(work, "update-ref", "refs/tags/" + name, ids[label])
            git(work, "reset", "--hard", "main")
            shared = base / "shared.git"
            shared.mkdir()
            git(
                shared,
                "init",
                "-q",
                "--bare",
                "--initial-branch=main",
                "--object-format=sha1",
                "--template=" + str(template),
            )
            shutil.copytree(
                work / ".git/objects", shared / "objects", dirs_exist_ok=True
            )
            git(shared, "update-ref", "refs/heads/main", ids[spec["sharedHead"]])
            for name, label in spec["sharedTags"].items():
                git(shared, "update-ref", "refs/tags/" + name, ids[label])
            (shared / "description").unlink(missing_ok=True)
            git(work, "switch", "-q", "--detach", ids[spec["patchBase"]])
            patch_spec = spec["patch"]
            put(work, {patch_spec["path"]: patch_spec["text"]})
            patch = git(
                work, "diff", "--no-ext-diff", "--binary", "--", patch_spec["path"]
            )
            git(
                work, "restore", "--source=HEAD", "--worktree", "--", patch_spec["path"]
            )
            git(work, "switch", "-q", "main")
            # Поступившая линия доступна через соседний bare; лишних объектов work нет.
            git(work, "prune", "--expire=now")
            incoming = base / "incoming"
            incoming.mkdir()
            target(incoming, patch_spec["name"]).write_bytes(patch)
            state = normalize(work)
            states[archive] = {
                "root": spec["root"],
                "history": ids,
                **{k: ids[k] for k in ["A", "M", "F"] if k in ids},
                "work": state,
                "sharedRefs": git(shared, "show-ref").decode().splitlines(),
                "patch": {"name": patch_spec["name"]},
            }
            entries = {
                p.relative_to(parent).as_posix(): p.read_bytes()
                for p in base.rglob("*")
                if p.is_file()
            }
            outputs[archive] = packed(entries)
    outputs[DIRECTORY + "/initial-state.json"] = (
        json.dumps(states, ensure_ascii=False, indent=2) + "\n"
    ).encode()
    return outputs


def build(root: str | Path) -> list[str]:
    root = Path(root).resolve(strict=True)
    seed = read_seed(target(root, DIRECTORY + "/seed.json"))
    outputs = generate(seed)
    planned: list[tuple[Path, bytes]] = []
    for name, data in outputs.items():
        if name not in ARCHIVES | {DIRECTORY + "/initial-state.json"}:
            raise ValueError("Не объявлено назначение набора")
        planned.append((target(root, name), data))
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
        raise SystemExit(1)
