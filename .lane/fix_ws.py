import os, glob, json
DST="/home/hatch/workspace/bdv-wt-affiliates"
# map package name -> dir in DST
pkgmap={}
for pj in glob.glob(DST+"/artifacts/*/package.json")+glob.glob(DST+"/lib/*/package.json")+glob.glob(DST+"/lib/integrations/*/package.json")+glob.glob(DST+"/scripts/package.json"):
    try: name=json.load(open(pj)).get("name")
    except: continue
    if name: pkgmap[name]=os.path.dirname(pj)
fixed=0
for wsdir in glob.glob(DST+"/**/node_modules/@workspace", recursive=True):
    if "/node_modules/" in wsdir[len(DST):].split("/node_modules/")[1] if "/node_modules/" in wsdir[len(DST):] else False: continue
    for sub in os.listdir(wsdir):
        link=os.path.join(wsdir,sub)
        name="@workspace/"+sub
        if name in pkgmap:
            if os.path.islink(link): os.unlink(link)
            os.symlink(pkgmap[name], link); fixed+=1
print("fixed",fixed)
