import json
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from materialize_public_materials import build

class PublicMaterialTests(unittest.TestCase):
 def test_identical_copies_stable_check_and_local_edit_preserved(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'tools').mkdir();(root/'practice/materials').mkdir(parents=True)
   (root/'practice/materials/demo.zip').write_bytes(b'published archive bytes')
   mapping={'practice/materials/demo.zip':['theory/materials/demo.zip','handbook/materials/demo.zip']}
   (root/'tools/public-materials.json').write_text(json.dumps(mapping));build(root,True)
   target=root/'theory/materials/demo.zip';stamp=target.stat().st_mtime_ns
   build(root);build(root,True);self.assertEqual(stamp,target.stat().st_mtime_ns)
   self.assertEqual(target.read_bytes(),(root/'handbook/materials/demo.zip').read_bytes())
   target.write_bytes(b'local user edit')
   with self.assertRaisesRegex(ValueError,'Локальная правка'):build(root,True)
   self.assertEqual(target.read_bytes(),b'local user edit')
 def test_rejects_undeclared_target_before_any_write(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'tools').mkdir();(root/'practice/materials').mkdir(parents=True);(root/'practice/materials/demo.zip').write_bytes(b'zip')
   (root/'tools/public-materials.json').write_text(json.dumps({'practice/materials/demo.zip':['theory/materials/ok.zip','theory/materials/../../escape.zip']}))
   with self.assertRaises(ValueError):build(root,True)
   self.assertFalse((root/'theory/materials/ok.zip').exists())
if __name__=='__main__':unittest.main()
