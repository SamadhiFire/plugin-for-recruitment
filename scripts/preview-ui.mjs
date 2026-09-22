import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// Local UI fixture: synthetic data only; never connects to Chrome or the resume API.
const root = new URL("../extension/", import.meta.url);
const fixture = `
const mode = new URLSearchParams(location.search).get("state") || "idle";
const tab = { id: 1, url: "https://careers.example.test/apply" };
const pending = [
  ["education", 0, "领域方向"], ["education", 1, "实验室"], ["education", 1, "领域方向"],
  ["education", 2, "实验室"], ["education", 2, "导师"], ["experience", 0, "其他信息"]
].map(([section, recordIndex, label], i) => ({ fieldId: "p"+i, section, recordIndex, label, key:"other", value: "", needsConfirmation:true, reason:"模型请求超时，简历资料中也没有可确认的对应内容。可以补充后填入，或留空跳过。" }));
const prepared = Array.from({length:19}, (_, i) => ({fieldId:"r"+i, section:"project", recordIndex:Math.floor(i/7), label:["项目名称","项目角色","开始时间","结束时间","描述","链接","补充说明"][i%7], key:i%7===4?"description":"name", value:i%7===4?"1. 从用户需求出发完成产品设计。\\n2. 通过测试改进功能体验。":["示例项目","产品设计","2025-05","2025-09","项目描述","https://example.test/","已完成"][i%7], selected:true, needsConfirmation:false, verified:true}));
window.chrome = {tabs:{query:async()=>[tab],onActivated:{addListener(){}},onUpdated:{addListener(){}},sendMessage:async(_id,message)=>message.type==="RECRUITMENT_APPLY_AGENT_PLAN"?{ok:true,results:message.items.map(item=>({fieldId:item.fieldId,ok:true}))}:{ok:true,page:{host:"careers.example.test",url:tab.url,fields:[],repeaters:[]}}},permissions:{contains:async()=>true,request:async()=>true},scripting:{executeScript:async()=>{}}};
window.fetch=async(url,options={})=>{
 const path=new URL(url).pathname;
 let result={};
 if(path==="/api/profiles")result={profiles:[{id:"aigc",label:"AI产品—AIGC向",status:"ready"},{id:"general",label:"AI产品—通用",status:"ready"},{id:"sales",label:"科技销售",status:"draft"}]};
 if(path==="/api/profile")result={profile:{meta:{version:1}},profileMeta:{label:"AI产品—AIGC向",status:"ready"},model:"qwen3.8-max"};
 if(path==="/api/config")result={hasApiKey:true,model:"qwen3.8-max"};
 if(path==="/api/align-form")result={targets:{}};
 if(path==="/api/auto-plan"){
  if(mode==="loading")await new Promise(()=>{});
  result={agentVersion:2,profile:{id:"aigc"},plan:[...pending,...prepared],report:{locallyVerified:55},warnings:["模型请求超时；已通过本地校验的内容可以填入。"]};
 }
 return {ok:true,json:async()=>result};
};
window.addEventListener("load",async()=>{
 await new Promise(r=>setTimeout(r,60));
 const select=document.getElementById("profileDirection");
 select.value="aigc"; await select.onchange();
 if(mode!=="idle")await document.getElementById("buildPlan").onclick();
});
`;
const gallery = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>简历助手 · 界面预览</title><style>
*{box-sizing:border-box}body{margin:0;background:#eaeaec;color:#252528;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;padding:26px}
header{max-width:1130px;margin:0 auto 20px;display:flex;justify-content:space-between;align-items:baseline}h1{font-size:21px;font-weight:600;margin:0}header p{color:#73737b;font-size:12px}
main{display:flex;gap:22px;justify-content:center;align-items:start}.sample{width:360px}.sample>p{font-size:11px;color:#777781;letter-spacing:1px;margin:0 0 10px}iframe{width:100%;height:790px;border:1px solid #dcdce0;border-radius:15px;background:#f5f5f7;box-shadow:0 8px 28px #00000008}
</style><header><h1>简历助手</h1><p>浅色界面 / 合成数据预览</p></header><main>
${[["idle","01 · 准备"],["loading","02 · 分析中"],["review","03 · 待填入"]].map(([state,label])=>`<section class="sample"><p>${label}</p><iframe title="${label}" src="/sidepanel/sidepanel.html?state=${state}"></iframe></section>`).join("")}
</main></html>`;
createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,"http://127.0.0.1");
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");res.end(gallery);return;}
 if(url.pathname==="/fixture.js"){res.setHeader("Content-Type","text/javascript; charset=utf-8");res.end(fixture);return;}
 const allowed=["/sidepanel/sidepanel.html","/sidepanel/sidepanel.css","/sidepanel/sidepanel.js","/assets/logo.svg"];
 if(!allowed.includes(url.pathname)){res.writeHead(404);res.end();return;}
 let body=await readFile(new URL(url.pathname.slice(1),root),"utf8");
 if(url.pathname.endsWith(".html"))body=body.replace('<script src="sidepanel.js">','<script src="/fixture.js"></script><script src="sidepanel.js">');
 res.setHeader("Content-Type",url.pathname.endsWith(".css")?"text/css":url.pathname.endsWith(".js")?"text/javascript":url.pathname.endsWith(".svg")?"image/svg+xml":"text/html; charset=utf-8");res.end(body);
 }catch{res.writeHead(500);res.end("Preview unavailable");}
}).listen(8791,"127.0.0.1",()=>console.log("UI preview: http://127.0.0.1:8791"));
