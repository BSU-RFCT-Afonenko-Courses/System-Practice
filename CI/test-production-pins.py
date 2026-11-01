"""Чистые decoder/context-binding mutants; синтетический Context не authority."""
from pathlib import Path
import copy,importlib.util,importlib.machinery,json,tempfile,types,unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pin_validator',ROOT/'CI/check-production-pins.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
class Pins(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='production-pins-unit-');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.data=json.loads((ROOT/'CI/toolchain.json').read_text())
  # Единственная цель fixture providers — дойти до Platform role checks, не
  # изображать фактическую опубликованную supply-chain qualification.
  (self.root/'providers.json').write_text(json.dumps({'providers':{'inert-fixture':{}}}))
 def decode(self,data):
  (self.root/'CI').mkdir(exist_ok=True);(self.root/'CI/toolchain.json').write_text(json.dumps(data));return v.pins(self.root)
 def test_four_role_format_guards_and_existing_three_are_not_weakened(self):
  self.decode(self.data)
  for role in ['java','fish','community','workspace']:
   for mutation in ['missing','malformed','wrong-role']:
    with self.subTest(role=role,mutation=mutation):
     data=copy.deepcopy(self.data);key=role+'Image'
     if mutation=='missing':data['platform'].pop(key)
     elif mutation=='malformed':data['platform'][key]='ghcr.io/afonenko-course-tools/unknown:latest'
     else:data['platform'][key]=self.data['platform']['fishImage'if role!='fish'else'javaImage']
     with self.assertRaises((ValueError,KeyError)):self.decode(data)
 def test_assembly_reads_and_compares_each_actual_context_role(self):
  p=self.data['platform'];pub=self.data['imagePublication'];platform=self.root/'platform';(platform/'tools').mkdir(parents=True);assets=self.root/'assets';assets.mkdir()
  blobs={}
  for name in ['release_assembly.py','publish-receipt.py','prepare_native_toolchain.py','prepare_native_jdk.py']:
   blobs['tools/'+name]=b'# inert loader boundary fixture\n';(platform/'tools'/name).write_bytes(blobs['tools/'+name])
  # Asset bytes/shape остаются настоящим входом проверяемой assembly функции.
  import hashlib
  for name,row in pub['assets'].items():
   raw=(name+' inert unit').encode();(assets/name).write_bytes(raw);row.update(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
  for field,name in [('receiptSha256','runtime-image.json'),('runtimeProfilesSha256','published-runtime-profiles.json'),('toolchainLockSha256','published-toolchain-lock.json')]:pub[field]=pub['assets'][name]['sha256']
  self.decode(self.data)
  expected={'schema':'pl-platform-release-assets-v1','repository':'https://github.com/'+p['repository'],'sourceCommit':p['commit'],'sourceTree':p['sourceTree'],'version':p['version'],'tag':p['tag'],'assets':{n:x['sha256']for n,x in pub['assets'].items()}}
  images={'releaseAssembly':expected,'javaGrader':{'image':p['javaImage'],'localImageId':p['javaImageConfig']},'fishGrader':{'image':p['fishImage'],'localImageId':p['fishImageConfig']},'communityGateway':{'image':p['communityImage']},'spGitWorkspace':{'image':p['workspaceImage']}}
  context=types.SimpleNamespace(images=images,registry={'profiles':{'java25-junit-v1':{'runnerSha256':pub['runnerSourceHash']}}},recheck=lambda:None)
  class Loader:
   def create_module(self,spec):return None
   def exec_module(self,module):module.for_build=lambda *args:context
  def git(root,*args):
   if args==('rev-parse','HEAD'):return(p['commit']+'\n').encode()
   if args==('rev-parse','HEAD^{tree}'):return(p['sourceTree']+'\n').encode()
   if args==('cat-file','-t',p['tag']):return b'tag\n'
   if args==('rev-parse',p['tag']):return(p['tagObject']+'\n').encode()
   if args[0]=='show':return blobs[args[1].removeprefix('HEAD:')]
   raise AssertionError(args)
  # Только внешний загрузчик Context изолирован. Проверяем реальную assembly
  # функцию целиком; удаление сравнения любой role превращает mutant в false PASS.
  with patch.object(v,'git',git),patch.object(v.importlib.util,'spec_from_file_location',return_value=importlib.machinery.ModuleSpec('inert_context',Loader())):
   v.assembly(self.data,platform,assets/'published-runtime-profiles.json')
   for key in ['javaGrader','fishGrader','communityGateway','spGitWorkspace']:
    before=images[key]
    for mutation in ['missing','mismatch']:
     with self.subTest(key=key,mutation=mutation):
      if mutation=='missing':images.pop(key)
      else:images[key]={**before,'image':before['image'].split('@')[0]+'@sha256:'+'0'*64}
      try:
       with self.assertRaises((ValueError,KeyError)):v.assembly(self.data,platform,assets/'published-runtime-profiles.json')
      finally:images[key]=before
if __name__=='__main__':unittest.main(verbosity=2)
