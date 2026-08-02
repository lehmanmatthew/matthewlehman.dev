const fs=require('fs'),http=require('http');
const get=p=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9222,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)))}).on('error',rej)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){this.p.get(m.id)(m.result);this.p.delete(m.id)}})}
send(m,p={}){const id=++this.id;return new Promise(r=>{this.p.set(id,r);this.ws.send(JSON.stringify({id,method:m,params:p}))})}}
const SP='C:/Users/sours/AppData/Local/Temp/claude/C--Users-sours/58e1c8cb-4c3f-425b-887d-382339241c16/scratchpad/';
(async()=>{
const l=await get('/json/list');const ws=new WebSocket(l.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));const c=new CDP(ws);
await c.send('Runtime.enable');await c.send('Page.enable');
const ev=async e=>(await c.send('Runtime.evaluate',{expression:e,returnByValue:true})).result.value;
for(const v of [[1440,900,false],[820,1180,true],[390,844,true]]){
  await c.send('Emulation.setDeviceMetricsOverride',{width:v[0],height:v[1],deviceScaleFactor:1,mobile:v[2]});
  await c.send('Emulation.setTouchEmulationEnabled',{enabled:v[2],maxTouchPoints:v[2]?5:0});
  await c.send('Page.navigate',{url:'http://localhost:8899/index.html'});await sleep(2400);
  console.log(v[0]+'px:', await ev(`(()=>{const n=document.querySelector('.nav__links');const cs=getComputedStyle(n);
    const items=[...n.querySelectorAll('a')].map(a=>a.textContent.trim());
    const inner=document.querySelector('.nav__inner');
    return JSON.stringify({items,navVisible:cs.display!=='none',
      navOverflow:n.scrollWidth-n.clientWidth,
      innerOverflow:inner.scrollWidth-inner.clientWidth,
      mobileItems:[...document.querySelectorAll('.nav__mobile a')].map(a=>a.textContent.trim()),
      bodyOverflow:document.documentElement.scrollWidth-innerWidth})})()`));
}
// Click "Links" on desktop and confirm it actually navigates
await c.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await c.send('Page.navigate',{url:'http://localhost:8899/index.html'});await sleep(2400);
const box=JSON.parse(await ev(`(()=>{const a=[...document.querySelectorAll('.nav__links a')].find(x=>x.textContent.trim()==='Links');const r=a.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),href:a.getAttribute('href')})})()`));
console.log('\nLinks item:',box);
await c.send('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x,y:box.y,button:'left',clickCount:1});
await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x,y:box.y,button:'left',clickCount:1});
await sleep(2200);
console.log('after click ->', await ev(`JSON.stringify({path:location.pathname,title:document.title,rows:document.querySelectorAll('a.link').length})`));
const s=await c.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync(SP+'nav-after-click.png',Buffer.from(s.data,'base64'));
ws.close();process.exit(0)})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
