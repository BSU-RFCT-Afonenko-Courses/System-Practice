"""Обычные материалы и два предоставленных исходных Git-репозитория."""

from pathlib import Path
import configparser
import shutil
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from build_git_materials import build, git
from build_materials import target
from system_support import read_json, json_object, json_texts
from git_fixture import README, MEASUREMENTS

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = {
    "github-ssh": ("version-control-github-ssh-start.zip", "versioning/project"),
    "restore-selected-state": (
        "version-control-restore-selected-state-start.zip",
        "work",
    ),
}
OUTPUTS = {
    "practice/materials/version-control-demo.zip",
    "tasks/materials/version-control-start.zip",
    "tasks/projects/version-control/initial-state.json",
    *("tasks/materials/" + name for name, _ in MATERIALS.values()),
}


class GitMaterials(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix="git material files ")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        p = self.root / "tasks/projects/version-control/seed.json"
        p.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "tasks/projects/version-control/seed.json", p)
        for project in MATERIALS:
            source = ROOT / "tasks/projects/version-control" / project
            destination = self.root / "tasks/projects/version-control" / project
            shutil.copytree(
                source,
                destination,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )

    def test_starter_contains_only_three_ordinary_project_files(self) -> None:
        build(self.root)
        with zipfile.ZipFile(
            self.root / "tasks/materials/version-control-start.zip"
        ) as z:
            self.assertEqual(
                {
                    "versioning/project/README.md": README.encode(),
                    "versioning/project/criteria.txt": b"latency_limit = 25 ms\n",
                    "versioning/project/measurements.tsv": MEASUREMENTS,
                },
                {n: z.read(n) for n in z.namelist()},
            )
        with zipfile.ZipFile(
            self.root / "practice/materials/version-control-demo.zip"
        ) as z:
            self.assertEqual(
                {
                    "latency-demo/README.md": README.encode(),
                    "latency-demo/criteria.txt": b"latency_limit = 10 ms\n",
                    "latency-demo/measurements.tsv": b"sensor\tlatency_ms\nnorth\t8\nsouth\t18\n",
                },
                {n: z.read(n) for n in z.namelist()},
            )

    def project(self, name: str) -> Path:
        return self.root / "tasks/projects/version-control" / name

    def preserve_outputs(self) -> dict[str, bytes]:
        before: dict[str, bytes] = {}
        for name in sorted(OUTPUTS):
            path = target(self.root, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            before[name] = ("Прежний результат: " + name).encode()
            path.write_bytes(before[name])
        return before

    def assert_refused_before_public_write(self, before: dict[str, bytes]) -> None:
        with self.assertRaises((ValueError, OSError)):
            build(self.root)
        self.assertEqual(
            before, {name: target(self.root, name).read_bytes() for name in before}
        )

    def wrap_recipe(self, project: str, mutation: str) -> None:
        recipe = self.project(project) / "seed_recipe.py"
        source = recipe.read_text()
        self.assertEqual(source.count("def generate("), 1)
        source = source.replace("def generate(", "def _canonical_generate(", 1)
        recipe.write_text(
            source + "\n\ndef generate(destination: Path, empty_template: Path):\n"
            "    identity = _canonical_generate(destination, empty_template)\n"
            + mutation
            + "\n    return identity\n"
        )

    def test_prepared_git_materials_include_canonical_roots_and_initial_repositories(
        self,
    ) -> None:
        actual = set(build(self.root))
        # Различающий RED на реальном старом builder, до чтения отсутствующих ZIP/Git.
        self.assertEqual(
            OUTPUTS, actual, "Не созданы оба предоставленных Git-материала"
        )
        for project, (name, prefix) in MATERIALS.items():
            with self.subTest(project=project):
                with zipfile.ZipFile(self.root / "tasks/materials" / name) as archive:
                    names = archive.namelist()
                    self.assertEqual(len(names), len(set(names)))
                    self.assertIn("README.md", names)
                    self.assertEqual(
                        archive.read("README.md"),
                        (self.project(project) / "student/README.md").read_bytes(),
                    )
                    self.assertTrue(
                        all(
                            item == "README.md" or item.startswith(prefix + "/")
                            for item in names
                        )
                    )
                    self.assertTrue(
                        all(
                            not item.endswith(".zip")
                            and ".pl-seed" not in Path(item).parts
                            for item in names
                        )
                    )
                    for required in ["HEAD", "config", "index"]:
                        self.assertIn(prefix + "/.git/" + required, names)
                    self.assertTrue(
                        any(
                            item.startswith(prefix + "/.git/objects/") for item in names
                        )
                    )
                    extracted = self.root / ("readback-" + project)
                    extracted.mkdir()
                    for item in names:
                        path = target(extracted, item)
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(archive.read(item))
                repo = extracted / prefix
                head = git(repo, "rev-parse", "HEAD").decode().strip()
                self.assertRegex(head, r"^[0-9a-f]{40}$")
                self.assertEqual(
                    git(repo, "symbolic-ref", "HEAD"), b"refs/heads/main\n"
                )
                self.assertEqual(
                    git(repo, "show-ref").decode().strip(), head + " refs/heads/main"
                )
                self.assertEqual(git(repo, "status", "--porcelain=v1"), b"")
                config = configparser.ConfigParser()
                config.read_string((repo / ".git/config").read_text())
                self.assertEqual(config.sections(), ["core"])
                self.assertEqual(
                    dict(config["core"]),
                    {
                        "repositoryformatversion": "0",
                        "filemode": "false",
                        "bare": "false",
                        "logallrefupdates": "false",
                        "autocrlf": "false",
                    },
                )
                self.assertFalse(
                    any(
                        "/.git/hooks/" in item
                        or item.endswith("/.git/objects/info/alternates")
                        for item in names
                    )
                )
                expected_count = b"2\n" if project == "github-ssh" else b"1\n"
                self.assertEqual(
                    git(repo, "rev-list", "--all", "--count"), expected_count
                )
                graph = git(repo, "rev-list", "--parents", "HEAD").decode().splitlines()
                files = (
                    git(repo, "ls-tree", "-r", "--name-only", "HEAD")
                    .decode()
                    .splitlines()
                )
                if project == "github-ssh":
                    self.assertEqual(len(graph), 2)
                    parent = graph[1]
                    self.assertRegex(parent, r"^[0-9a-f]{40}$")
                    self.assertNotEqual(parent, head)
                    self.assertEqual(graph[0], head + " " + parent)
                    self.assertEqual(files, ["README.md", "catalog.tsv"])
                    states = json_object(read_json(self.project(project) / "seed.json"))
                    for filename, text in json_texts(states["S0"]).items():
                        self.assertEqual(
                            git(repo, "show", parent + ":" + filename), text.encode()
                        )
                    initial_files = {
                        **json_texts(states["S0"]),
                        **json_texts(states["S1"]),
                    }
                    for filename, text in initial_files.items():
                        self.assertEqual((repo / filename).read_bytes(), text.encode())
                else:
                    self.assertEqual(graph, [head])
                    self.assertEqual(files, ["README.md", "notes.txt"])
                    for filename in files:
                        self.assertEqual(
                            (repo / filename).read_bytes(),
                            (
                                self.project(project) / "student/work" / filename
                            ).read_bytes(),
                        )
                stored = set(
                    git(
                        repo,
                        "cat-file",
                        "--batch-all-objects",
                        "--batch-check=%(objectname)",
                    ).splitlines()
                )
                reachable = set(
                    git(
                        repo, "rev-list", "--objects", "--no-object-names", "HEAD"
                    ).splitlines()
                )
                self.assertEqual(stored, reachable)
                git(repo, "fsck", "--strict", "--full", "--no-reflogs")

    def test_source_paths_are_checked_before_public_outputs_change(self) -> None:
        for relative in [
            "github-ssh/seed_recipe.py",
            "github-ssh/seed.json",
            "github-ssh/student/README.md",
            "restore-selected-state/seed_recipe.py",
            "restore-selected-state/student/README.md",
            "restore-selected-state/student/work/README.md",
            "restore-selected-state/student/work/notes.txt",
        ]:
            with self.subTest(source=relative):
                source = self.root / "tasks/projects/version-control" / relative
                content = source.read_bytes()
                before = self.preserve_outputs()
                source.unlink()
                try:
                    self.assert_refused_before_public_write(before)
                finally:
                    source.write_bytes(content)

    def test_symlink_source_is_refused_before_public_write(self) -> None:
        source = self.project("github-ssh") / "student/README.md"
        content = source.read_bytes()
        outside = self.root / "unselected-readme.md"
        outside.write_bytes(content)
        source.unlink()
        source.symlink_to(outside)
        self.assert_refused_before_public_write(self.preserve_outputs())
        self.assertEqual(outside.read_bytes(), content)

    def test_destination_alias_is_refused_before_any_public_write(self) -> None:
        before = self.preserve_outputs()
        source = (
            self.root
            / "tasks/materials/version-control-restore-selected-state-start.zip"
        )
        outside = self.root / "unselected-result.zip"
        outside.write_bytes("Не менять".encode())
        source.unlink()
        source.symlink_to(outside)
        with self.assertRaises((ValueError, OSError)):
            build(self.root)
        self.assertEqual(outside.read_bytes(), "Не менять".encode())
        self.assertEqual(
            {
                name: content
                for name, content in before.items()
                if name != str(source.relative_to(self.root))
            },
            {
                name: target(self.root, name).read_bytes()
                for name in before
                if name != str(source.relative_to(self.root))
            },
        )

    def test_both_entrypoints_are_checked_before_any_public_write(self) -> None:
        recipe = self.project("restore-selected-state") / "seed_recipe.py"
        original = recipe.read_text()
        for source in ["not_generate = 1\n", "generate = 1\n"]:
            with self.subTest(source=source):
                recipe.write_text(source)
                self.assert_refused_before_public_write(self.preserve_outputs())
        recipe.write_text(original)

    def test_returned_identity_is_closed_and_exact_before_public_write(self) -> None:
        mutations = [
            "    identity.pop('S0')",
            "    identity['extra'] = 'not-declared'",
            "    identity['S1'] = 'not-a-sha'",
            "    identity['S1'] = identity['S0']",
            "    identity['head'] = 'refs/heads/other'",
            "    identity['refs'] = []",
            "    identity['status'] = ' M README.md'",
        ]
        recipe = self.project("github-ssh") / "seed_recipe.py"
        original = recipe.read_text()
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                recipe.write_text(original)
                self.wrap_recipe("github-ssh", mutation)
                self.assert_refused_before_public_write(self.preserve_outputs())
        recipe.write_text(original)
        recipe = self.project("restore-selected-state") / "seed_recipe.py"
        original = recipe.read_text()
        for mutation in ["    identity.pop('A')", "    identity['A'] = 'not-a-sha'"]:
            with self.subTest(project="restore-selected-state", mutation=mutation):
                recipe.write_text(original)
                self.wrap_recipe("restore-selected-state", mutation)
                self.assert_refused_before_public_write(self.preserve_outputs())
        recipe.write_text(original)

    def test_unsafe_generated_entries_are_refused_before_public_write(self) -> None:
        mutations = [
            "    (destination / 'alias').symlink_to(Path(__file__))",
            "    __import__('os').mkfifo(destination / 'fifo')",
            "    (destination.parent / 'foreign-root.txt').write_text('Посторонний root')",
        ]
        recipe = self.project("github-ssh") / "seed_recipe.py"
        original = recipe.read_text()
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                recipe.write_text(original)
                self.wrap_recipe("github-ssh", mutation)
                self.assert_refused_before_public_write(self.preserve_outputs())
        recipe.write_text(original)

    def test_second_recipe_failure_leaves_all_public_outputs_unchanged(self) -> None:
        recipe = self.project("restore-selected-state") / "seed_recipe.py"
        recipe.write_text(
            "def generate(destination, empty_template):\n"
            '    raise ValueError("Сбой второго recipe")\n'
        )
        self.assert_refused_before_public_write(self.preserve_outputs())


if __name__ == "__main__":
    unittest.main()
