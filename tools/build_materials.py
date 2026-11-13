#!/usr/bin/env python3
"""Упаковка объявленных учебных данных в ZIP."""

from collections.abc import Mapping
import argparse
import io
import json
import os
import re
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
import zipfile
from system_support import safe_archive_name, read_json, json_object, json_texts


def target(root: Path, relative: str) -> Path:
    safe_archive_name(relative)
    current = root
    parts = PurePosixPath(relative).parts
    for index, component in enumerate(parts):
        current = current / component
        if current.is_symlink() or (
            current.exists() and index < len(parts) - 1 and not current.is_dir()
        ):
            raise ValueError(f"Небезопасный путь: {relative}")
    if current.exists() and not current.is_file():
        raise ValueError(f"Ожидался обычный файл: {relative}")
    return current


def packed(entries: Mapping[str, object]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, text in sorted(entries.items()):
            safe_archive_name(name)
            if name.endswith("/") or not isinstance(text, (str, bytes)):
                raise ValueError(
                    "Материалы задают обычные файлы как UTF-8 текст или точные байты"
                )
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 16, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(
                info, text.encode("utf-8") if isinstance(text, str) else text
            )
    return output.getvalue()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix="." + path.name + ".", delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def read_materials(path: Path) -> dict[str, dict[str, str]]:
    return {
        name: json_texts(entries)
        for name, entries in json_object(read_json(path)).items()
    }


def build(root: str | Path, project: str = "work-environment") -> list[str]:
    root = Path(root).resolve(strict=True)
    if not re.fullmatch(r"[a-z][a-z0-9-]*", project):
        raise ValueError("Недопустимое имя проекта материалов")
    directory = f"tasks/projects/{project}"
    data: dict[str, dict[str, str | bytes]] = {
        name: dict[str, str | bytes](entries)
        for name, entries in read_materials(
            target(root, directory + "/materials.json")
        ).items()
    }
    if project == "work-environment":
        for archive, prefix in [
            ("practice/materials/work-environment-demo.zip", "lab"),
            ("tasks/materials/work-environment-start.zip", "survey"),
        ]:
            for script in ["count.fish", "count.ps1"]:
                member = prefix + "/tools/" + script
                if member in data[archive]:
                    raise ValueError("Повторный источник общего счётчика: " + member)
                data[archive][member] = target(
                    root, "tasks/common/work-environment/" + script
                ).read_bytes()
    planned: list[tuple[str, Path, bytes]] = []
    for name, entries in data.items():
        if not name.startswith(
            ("practice/materials/", "tasks/materials/")
        ) or not name.endswith(".zip"):
            raise ValueError(f"Не объявлен каталог публикации материала: {name}")
        planned.append((name, target(root, name), packed(entries)))
    if not planned:
        raise ValueError("Не объявлены материалы")
    for _, path, content in planned:
        atomic_write(path, content)
    return [name for name, _, _ in planned]


class Options(argparse.Namespace):
    root: Path
    project: str


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[1]
    )
    parser.add_argument("--project", default="work-environment")
    args = parser.parse_args(namespace=Options())
    print(
        json.dumps(build(args.root, project=args.project), ensure_ascii=False, indent=2)
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as problem:
        print(problem, file=sys.stderr)
        raise SystemExit(1)
