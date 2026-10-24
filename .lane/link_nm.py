import os, subprocess
SRC="/home/hatch/workspace/bow-down-visuals"
DST="/home/hatch/workspace/bdv-wt-affiliates"
out=subprocess.run(["find",SRC,"-name","node_modules","-type","d","-not","-path","*/node_modules/*","-not","-path","*/.git/*"],capture_output=True,text=True).stdout.splitlines()
count=0
for nm in out:
    rel=os.path.relpath(nm,SRC)
    target=os.path.join(DST,rel)
    os.makedirs(target,exist_ok=True)
    for entry in sorted(os.listdir(nm)):
        src_e=os.path.join(nm,entry); dst_e=os.path.join(target,entry)
        if os.path.lexists(dst_e): continue
        if entry=="@workspace":
            os.makedirs(dst_e,exist_ok=True)
            for sub in sorted(os.listdir(src_e)):
                real=os.path.realpath(os.path.join(src_e,sub))
                pkg_rel=os.path.relpath(real,SRC)
                dest_pkg=os.path.join(DST,pkg_rel) if not pkg_rel.startswith("..") else real
                os.symlink(dest_pkg, os.path.join(dst_e,sub)); count+=1
        else:
            os.symlink(src_e,dst_e); count+=1
print("dirs:",len(out),"links:",count)
