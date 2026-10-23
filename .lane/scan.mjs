// AST inventory of hall-scene.ts builders: construction counts per method.
import ts from "/home/hatch/workspace/bow-down-visuals/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js";
import fs from "node:fs";
const file = process.argv[2];
const src = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
const interesting = new Set(["Mesh","InstancedMesh","Points","Sprite","Line","LineLoop","Group"]);
function triNote(node){ // geometry expr text for Mesh/InstancedMesh first arg
  const a = node.arguments?.[0];
  return a ? a.getText().slice(0,90) : "";
}
function walk(node, method, out){
  if (ts.isNewExpression(node) && node.expression.getText().startsWith("THREE.")){
    const kind = node.expression.getText().slice(6);
    if (interesting.has(kind)){
      const rec = out.get(method) ?? {Mesh:0,InstancedMesh:[],Points:0,Sprite:0,Line:0,Group:0,geos:{}};
      if (kind==="InstancedMesh") rec.InstancedMesh.push(node.arguments?.[2]?.getText() ?? "?");
      else rec[kind]=(rec[kind]??0)+1;
      out.set(method, rec);
    }
    if (kind.endsWith("Geometry")){
      const rec = out.get(method) ?? {Mesh:0,InstancedMesh:[],Points:0,Sprite:0,Line:0,Group:0,geos:{}};
      const key = kind+"("+ (node.arguments??[]).map(a=>a.getText()).join(",") +")";
      rec.geos[key]=(rec.geos[key]??0)+1;
      out.set(method, rec);
    }
  }
  node.forEachChild(c=>walk(c, method, out));
}
const out = new Map();
function topWalk(node){
  if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name){
    walk(node, node.name.getText(), out); return;
  }
  node.forEachChild(topWalk);
}
topWalk(sf);
// module-level helpers outside class:
console.log("method | Mesh | InstancedMesh(countArgs) | Points | Sprite | Line | Group");
for (const [m, r] of [...out.entries()].sort()){
  const tot = r.Mesh + r.InstancedMesh.length + r.Points + r.Sprite + r.Line;
  if (tot===0 && Object.keys(r.geos).length===0) continue;
  console.log(`${m} | ${r.Mesh} | ${r.InstancedMesh.length} [${r.InstancedMesh.join("; ")}] | ${r.Points} | ${r.Sprite} | ${r.Line} | ${r.Group}`);
}
console.error("---- geometry constructions (all methods merged) ----");
const geos = {};
for (const [,r] of out) for (const [k,v] of Object.entries(r.geos)) geos[k]=(geos[k]??0)+v;
for (const [k,v] of Object.entries(geos).sort((a,b)=>b[1]-a[1])) console.error(v, k);
