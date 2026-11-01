#!/usr/bin/env python3
"""Проверить production pins и штатную authenticated release assembly."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
REPO='Afonenko-Course-Tools/prairielearn-platform'
ASSETS=('runtime-image.json','published-runtime-profiles.json','published-toolchain-lock.json')

def require(ok,message):
    if not ok:raise ValueError(message)

def git(root,*args):
    return subprocess.check_output(['git','-c','core.hooksPath=/dev/null',*args],cwd=root,stderr=subprocess.PIPE)

def pins(root):
    providers=json.loads((root/'providers.json').read_text())['providers']
    require(not any(p.get('candidate') for p in providers.values()),'Production требует опубликованных provider pins, без local candidate')
    data=json.loads((root/'CI/toolchain.json').read_text());p=data['platform'];publication=data['imagePublication']
    require(p['repository']==REPO,'Неизвестный Platform repository')
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',p['version']) and p['tag']=='v'+p['version'],'Нужен фактический version tag')
    for key in ('commit','sourceTree','tagObject'):require(re.fullmatch(r'[a-f0-9]{40}',p[key]),'Нужен точный Git '+key)
    for role,name in [('java','java25-grader'),('fish','fish-git-grader'),('community','prairielearn-community-gateway'),('workspace','sp-git-workspace')]:
        require(re.fullmatch(r'ghcr\.io/afonenko-course-tools/'+name+r'@sha256:[a-f0-9]{64}',p[role+'Image']),'Нужен immutable image '+role)
    for role in ('java','fish'):require(re.fullmatch(r'sha256:[a-f0-9]{64}',p[role+'ImageConfig']),'Нужен наблюдённый config ID: '+role)
    require(publication['buildSource']==p['commit'],'Publisher source отличается от source pin')
    require(isinstance(publication['run'],int) and publication['run']>0,'Нужен actual publisher run')
    release=publication['release'];base='https://github.com/'+REPO+'/releases/'
    require(isinstance(release['id'],int) and release['id']>0 and release['url']==base+'tag/'+p['tag'] and isinstance(release['immutable'],bool),'Нужны фактические release identity/status')
    assets=publication['assets'];require(set(assets)==set(ASSETS),'Нужны ровно три опубликованных asset pins')
    for name,x in assets.items():
        require(set(x)=={'url','sha256','bytes'} and x['url']==base+'download/'+p['tag']+'/'+name and re.fullmatch(r'[a-f0-9]{64}',x['sha256']) and isinstance(x['bytes'],int) and x['bytes']>0,'Неверный asset pin: '+name)
    for key,name in [('receiptSha256','runtime-image.json'),('runtimeProfilesSha256','published-runtime-profiles.json'),('toolchainLockSha256','published-toolchain-lock.json')]:
        require(publication[key]==assets[name]['sha256'],'Asset pin не совпадает: '+key)
    require(re.fullmatch(r'[a-f0-9]{64}',publication['runnerSourceHash']),'Нужен exact runner hash')
    return data

def assembly(data,root,registry):
    p=data['platform'];publication=data['imagePublication'];root=Path(root).absolute();registry=Path(registry).absolute()
    require(registry.name=='published-runtime-profiles.json','Требуется published registry из внешнего asset directory')
    require(git(root,'rev-parse','HEAD').decode().strip()==p['commit'] and git(root,'rev-parse','HEAD^{tree}').decode().strip()==p['sourceTree'],'Platform commit/tree не совпадает')
    require(git(root,'cat-file','-t',p['tag']).decode().strip()=='tag' and git(root,'rev-parse',p['tag']).decode().strip()==p['tagObject'],'Annotated tag object не совпадает')
    # Не исполнять изменённый Python до штатной полной проверки Context.
    for name in ('release_assembly.py','publish-receipt.py','prepare_native_toolchain.py','prepare_native_jdk.py'):
        relative='tools/'+name;f=root/relative
        require(not f.is_symlink() and f.read_bytes()==git(root,'show','HEAD:'+relative),'Изменён trusted assembly module: '+name)
    for name,x in publication['assets'].items():
        f=registry.parent/name;require(not f.is_symlink() and f.is_file(),'Нужен обычный asset: '+name);raw=f.read_bytes()
        require(len(raw)==x['bytes'] and hashlib.sha256(raw).hexdigest()==x['sha256'],'Asset bytes отличаются: '+name)
    spec=importlib.util.spec_from_file_location('course_release_assembly',root/'tools/release_assembly.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    context=module.for_build(root,registry)
    require(context is not None,'Отсутствует release assembly context')
    expected={'schema':'pl-platform-release-assets-v1','repository':'https://github.com/'+REPO,'sourceCommit':p['commit'],'sourceTree':p['sourceTree'],'version':p['version'],'tag':p['tag'],'assets':{n:x['sha256'] for n,x in publication['assets'].items()}}
    require(context.images['releaseAssembly']==expected,'External descriptor отличается от course pins')
    for role,key in [('java','javaGrader'),('fish','fishGrader'),('community','communityGateway'),('workspace','spGitWorkspace')]:require(context.images[key]['image']==p[role+'Image'],'Image отличается от course pins: '+role)
    for role,key in [('java','javaGrader'),('fish','fishGrader')]:require(context.images[key]['localImageId']==p[role+'ImageConfig'],'Наблюдённый config отличается: '+role)
    require(context.registry['profiles']['java25-junit-v1']['runnerSha256']==publication['runnerSourceHash'],'Runner отличается от course pins')
    context.recheck()

# OCI config identity и Docker local ID имеют разные domains; публичный CLI не меняется.
def _manifest_config(p,role,raw):
    require(len(raw)<=2097152 and 'sha256:'+hashlib.sha256(raw).hexdigest()==p[role+'Image'].split('@')[1],'OCI manifest bytes отличаются')
    manifest=json.loads(raw);require(manifest.get('schemaVersion')==2 and manifest.get('mediaType') in ('application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json'),'Нужен pinned single-image manifest')
    config=manifest['config'];require(config['digest']==p[role+'ImageConfig'] and type(config['size']) is int and 0<config['size']<=8388608 and config['mediaType'] in ('application/vnd.docker.container.image.v1+json','application/vnd.oci.image.config.v1+json'),'OCI config descriptor отличается')
    return config

def _verify_image_metadata(p,role,manifest_raw,config_raw,observed):
    descriptor=_manifest_config(p,role,manifest_raw)
    require(len(config_raw)==descriptor['size'] and 'sha256:'+hashlib.sha256(config_raw).hexdigest()==descriptor['digest'],'OCI config bytes отличаются')
    config=json.loads(config_raw);source='https://github.com/'+p['repository'];labels=config['config']['Labels']
    require(config['os']=='linux' and config['architecture']=='amd64' and labels['org.opencontainers.image.source']==source and labels['org.opencontainers.image.revision']==p['commit'],'OCI platform/source/revision отличаются')
    require(isinstance(observed,dict) and set(observed)=={'Id','RepoDigests','Descriptor','Os','Architecture','RootFS','Source','Revision'},'Нужна закрытая Docker metadata projection')
    manifest_digest=p[role+'Image'].split('@')[1]
    require(observed['Id'] in (descriptor['digest'],manifest_digest),'Docker ID вне authenticated config/manifest domains')
    require(isinstance(observed['RepoDigests'],list) and len(observed['RepoDigests'])<=64 and p[role+'Image'] in observed['RepoDigests'],'Docker RepoDigests не связывает exact image')
    local_descriptor=observed['Descriptor']
    require(local_descriptor is None or isinstance(local_descriptor,dict) and local_descriptor.get('digest')==manifest_digest and local_descriptor.get('size')==len(manifest_raw) and local_descriptor.get('mediaType')==json.loads(manifest_raw)['mediaType'],'Docker descriptor отличается')
    require(observed['Os']==config['os'] and observed['Architecture']==config['architecture'] and observed['Source']==source and observed['Revision']==p['commit'],'Docker platform/source/revision отличаются')
    require(observed['RootFS']=={'Type':config['rootfs']['type'],'Layers':config['rootfs']['diff_ids']},'Docker rootfs отличается от authenticated config')
    return descriptor['digest']

class _HttpsMetadataRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        require(urllib.parse.urlsplit(newurl).scheme=='https','OCI metadata redirect требует HTTPS')
        redirected=super().redirect_request(req,fp,code,msg,headers,newurl)
        if urllib.parse.urlsplit(newurl).netloc!='ghcr.io':redirected.remove_header('Authorization')
        return redirected

def _read_metadata(url,limit,token=None):
    require(url.startswith('https://ghcr.io/'),'Нужен GHCR metadata endpoint')
    headers={'Accept':'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'}
    if token:headers['Authorization']='Bearer '+token
    opener=urllib.request.build_opener(_HttpsMetadataRedirect())
    with opener.open(urllib.request.Request(url,headers=headers),timeout=30) as response:
        require(response.status==200,'OCI metadata HTTP refusal');raw=response.read(limit+1)
    require(len(raw)<=limit,'OCI metadata bytes превышают лимит')
    return raw

def _published_image_config(p,role,observed):
    image=p[role+'Image'];match=re.fullmatch(r'ghcr\.io/(afonenko-course-tools/(?:java25-grader|fish-git-grader))@(sha256:[a-f0-9]{64})',image)
    require(match is not None and role in ('java','fish'),'Нужен exact published Java/fish image')
    repo,digest=match.groups();payload=json.loads(_read_metadata('https://ghcr.io/token?service=ghcr.io&scope=repository:'+repo+':pull',65536));token=payload.get('token') or payload.get('access_token')
    require(isinstance(token,str) and re.fullmatch(r'[A-Za-z0-9._~+/=-]+',token),'Неверный anonymous pull token')
    manifest=_read_metadata('https://ghcr.io/v2/'+repo+'/manifests/'+digest,2097152,token)
    descriptor=_manifest_config(p,role,manifest)
    config=_read_metadata('https://ghcr.io/v2/'+repo+'/blobs/'+descriptor['digest'],descriptor['size'],token)
    return _verify_image_metadata(p,role,manifest,config,observed)

def main():
    try:
        data=pins(ROOT);platform=os.environ.get('PL_PLATFORM_ROOT');registry=os.environ.get('PL_RUNTIME_REGISTRY')
        require(bool(platform)==bool(registry),'Platform root и published registry задаются вместе')
        if platform:assembly(data,platform,registry)
        print('Проверены production pins'+(' и authenticated release assembly' if platform else '')+'; это не grading qualification')
        return 0
    except (ValueError,KeyError,TypeError,OSError,subprocess.CalledProcessError) as error:
        print('Production pins отклонены: '+str(error));return 2
if __name__=='__main__':raise SystemExit(main())
