#!/usr/bin/env python3
"""Доставить идентичные публичные наборы внутрь границ самостоятельных книг."""
import argparse
import json
import sys
from pathlib import Path
from build_materials import target,atomic_write
from system_support import read_json, json_object, json_strings


def build(root: str | Path) -> list[str]:
    root=Path(root).resolve(strict=True)
    mapping={name: json_strings(names) for name, names in json_object(read_json(target(root,'tools/public-materials.json'))).items()}
    planned: list[tuple[Path, bytes]] = [];destinations: set[str] = set()
    for source,names in mapping.items():
        if not source.startswith('practice/materials/') or not source.endswith('.zip'):
            raise ValueError('Не объявлен публичный источник ZIP')
        data=target(root,source).read_bytes()
        for name in names:
            if not name.startswith(('theory/materials/','handbook/materials/')) or not name.endswith('.zip'):
                raise ValueError('Не объявлено публичное назначение ZIP')
            if name in destinations:raise ValueError('Повторное назначение')
            destinations.add(name)
            planned.append((target(root,name),data))
    for path,data in planned:atomic_write(path,data)
    return sorted(destinations)


class Options(argparse.Namespace):
    root: Path


def main() -> None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    a=p.parse_args(namespace=Options())
    print(json.dumps(build(a.root),ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except (ValueError,OSError) as error:print(error,file=sys.stderr);raise SystemExit(1)
