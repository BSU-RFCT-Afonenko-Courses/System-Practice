#!/usr/bin/env python3
"""Доставить идентичные публичные наборы внутрь границ самостоятельных книг."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from build_materials import target,atomic_write


def build(root,write=False):
    root=Path(root).resolve(strict=True)
    mapping=json.loads(target(root,'tools/public-materials.json').read_text())
    manifest=target(root,'tools/public-materials-hashes.json')
    previous=json.loads(manifest.read_text()) if manifest.exists() else {}
    planned=[];hashes={}
    for source,names in mapping.items():
        if not source.startswith('practice/materials/') or not source.endswith('.zip'):
            raise ValueError('Не объявлен публичный источник ZIP')
        data=target(root,source).read_bytes();expected=hashlib.sha256(data).hexdigest()
        for name in names:
            if not name.startswith(('theory/materials/','handbook/materials/')) or not name.endswith('.zip'):
                raise ValueError('Не объявлено публичное назначение ZIP')
            if name in hashes:raise ValueError('Повторное назначение')
            path=target(root,name);actual=hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
            if actual is not None and actual!=expected and actual!=previous.get(name):
                raise ValueError('Локальная правка сохранена: '+name)
            hashes[name]=expected;planned.append((path,data,actual,expected))
    if set(previous)-set(hashes):raise ValueError('Удаление публичных копий требует отдельной проверки')
    if not write:
        if previous!=hashes or any(a!=e for _,_,a,e in planned):raise ValueError('Публичные копии отсутствуют или устарели')
    else:
        for path,data,actual,expected in planned:
            if actual!=expected:atomic_write(path,data)
        text=(json.dumps(hashes,ensure_ascii=False,indent=2)+'\n').encode()
        if not manifest.exists() or manifest.read_bytes()!=text:atomic_write(manifest,text)
    return hashes


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);g=p.add_mutually_exclusive_group(required=True);g.add_argument('--write',action='store_true');g.add_argument('--check',action='store_true');a=p.parse_args();print(json.dumps(build(a.root,a.write),ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError) as error:print(error,file=sys.stderr);raise SystemExit(1)
