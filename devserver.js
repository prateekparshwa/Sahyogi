// Local test harness only (not deployed): serves /public and routes /api/* to the same handlers Vercel runs.
const http=require("http"),fs=require("fs"),path=require("path");
const H={chat:require("./api/chat.js"),tts:require("./api/tts.js"),stt:require("./api/stt.js")};
http.createServer(async(req,res)=>{
  const u=new URL(req.url,"http://x");
  if(u.pathname.startsWith("/api/")){
    const h=H[u.pathname.slice(5)];if(!h){res.statusCode=404;return res.end()}
    req.query=Object.fromEntries(u.searchParams);
    const cfg=(h.config&&h.config.api)||{};
    if(cfg.bodyParser!==false&&req.method==="POST"){const c=[];for await(const x of req)c.push(x);try{req.body=JSON.parse(Buffer.concat(c).toString()||"{}")}catch{req.body={}}}
    res.status=n=>{res.statusCode=n;return res};res.json=o=>{res.setHeader("content-type","application/json");res.end(JSON.stringify(o));return res};res.send=b=>{res.end(b);return res};
    return h(req,res);
  }
  const f=path.join(__dirname,"public",u.pathname==="/"?"index.html":u.pathname);
  fs.readFile(f,(e,d)=>{if(e){res.statusCode=404;return res.end("nf")}res.setHeader("content-type","text/html; charset=utf-8");res.end(d)});
}).listen(process.env.PORT||3000,()=>console.log("up"));
