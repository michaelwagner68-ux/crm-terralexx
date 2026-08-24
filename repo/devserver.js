/* Kleiner Testserver: liefert die App aus und leitet /api an die Function. */
process.env.DATABASE_URL = "postgresql://postgres@localhost:5433/crmtest";
const http=require('http'),fs=require('fs'),path=require('path');
const src = fs.readFileSync(__dirname+"/netlify/functions/api.js","utf8")
  .replace("export default async (req) =>","const handler = async (req) =>")
  .replace("export const config","const config")
  .replace(/\/\* Für Tests aus Node heraus \*\/[\s\S]*$/,"") + "\nmodule.exports={handler};\n";
fs.writeFileSync(__dirname+"/.api.srv.js",src);
const {handler}=require("./.api.srv.js");
const APP = process.argv[2] || "/home/claude/terralexx-crm/dist/index.html";
http.createServer(async (req,res)=>{
  if(req.url.startsWith("/api")){
    const chunks=[]; for await (const c of req) chunks.push(c);
    const body=Buffer.concat(chunks);
    const r=await handler(new Request("http://localhost:8899"+req.url,{
      method:req.method, headers:req.headers,
      body:["GET","HEAD"].includes(req.method)?undefined:body}));
    res.writeHead(r.status,{"content-type":r.headers.get("content-type")||"application/json"});
    res.end(await r.text());
    return;
  }
  res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
  res.end(fs.readFileSync(APP));
}).listen(8899,()=>console.log("Testserver auf http://localhost:8899"));
