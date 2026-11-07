import json
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from materialize_public_materials import build

class PublicMaterialTests(unittest.TestCase):
 def test_copies_are_available_to_both_books(self) -> None:
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'tools').mkdir();(root/'practice/materials').mkdir(parents=True)
   (root/'practice/materials/demo.zip').write_bytes(b'published archive bytes')
   mapping={'practice/materials/demo.zip':['theory/materials/demo.zip','handbook/materials/demo.zip']}
   (root/'tools/public-materials.json').write_text(json.dumps(mapping));build(root)
   self.assertEqual(b'published archive bytes',(root/'theory/materials/demo.zip').read_bytes())
   self.assertEqual(b'published archive bytes',(root/'handbook/materials/demo.zip').read_bytes())
 def test_rejects_undeclared_target_before_any_write(self) -> None:
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'tools').mkdir();(root/'practice/materials').mkdir(parents=True);(root/'practice/materials/demo.zip').write_bytes(b'zip')
   (root/'tools/public-materials.json').write_text(json.dumps({'practice/materials/demo.zip':['theory/materials/ok.zip','theory/materials/../../escape.zip']}))
   with self.assertRaises(ValueError):build(root)
   self.assertFalse((root/'theory/materials/ok.zip').exists())
if __name__=='__main__':unittest.main()
