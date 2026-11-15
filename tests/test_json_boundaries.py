"""Неверные формы авторских JSON останавливают подготовку до записи выдачи."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from build_materials import build as build_materials
from build_git_materials import build as build_git
from build_maintenance_materials import build as build_maintenance
from materialize_public_materials import build as publish


class JsonBoundaryTests(unittest.TestCase):
    def test_material_entries_must_be_an_object_of_text(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "tasks/projects/data-processing/materials.json"
            source.parent.mkdir(parents=True)
            source.write_text(
                json.dumps({"tasks/materials/data-processing-start.zip": []})
            )
            with self.assertRaises(ValueError):
                build_materials(root, project="data-processing")
            self.assertFalse((root / "tasks/materials").exists())

    def test_git_seed_files_must_be_an_object_of_text(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "tasks/projects/version-control/seed.json"
            source.parent.mkdir(parents=True)
            source.write_text(
                json.dumps(
                    {
                        "practice/materials/version-control-demo.zip": {
                            "root": "latency-demo",
                            "files": [],
                        },
                        "tasks/materials/version-control-start.zip": {
                            "root": "versioning",
                            "files": {},
                        },
                    }
                )
            )
            with self.assertRaises(ValueError):
                build_git(root)
            self.assertFalse((root / "practice/materials").exists())

    def test_maintenance_manifest_must_be_an_object(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "tasks/projects/project-maintenance/seed.json"
            source.parent.mkdir(parents=True)
            source.write_text(json.dumps(3))
            with self.assertRaises(ValueError):
                build_maintenance(root)
            self.assertFalse((root / "practice/materials").exists())

    def test_public_mapping_must_be_an_object(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "tools/public-materials.json"
            source.parent.mkdir(parents=True)
            source.write_text(json.dumps([]))
            with self.assertRaises(ValueError):
                publish(root)
            self.assertFalse((root / "theory/materials").exists())


if __name__ == "__main__":
    unittest.main()
