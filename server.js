/**
 * Candy Chaos 3D - server LAN offline, Node.js >=18, no npm dependencies.
 * Everybody uses the HOST COMPUTER'S IPv4: http://192.168.x.x:3000/
 * This HTTP + WebSocket server never needs Internet.
 */
'use strict';
const http=require('node:http'),crypto=require('node:crypto'),os=require('node:os');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const PORT=Number(process.env.PORT||3000), HOST=process.env.HOST||'0.0.0.0';
const MAX=12, MAX_ROOMS=32, MAX_SOCKETS=48, MATCH_MS=8*60000;
const rooms=new Map(),sockets=new Set();
const RATE=[220,90,850,550,390,380,70,1100,190,140,1350,800,3000,240,650,300,1200,480,180,1700,310,1450,350,105];
const POWER=[7,4,20,15,12,11,3,14,10,6,24,23,25,9,17,8,19,12,8,22,11,28,14,8];
const KINDS=['shot','shot','boom','melee','melee','shot','shot','nova','shot','shot','boom','melee','nova','shot','boom','shot','nova','shot','shot','boom','shot','boom','shot','shot'];
function candyLocations(){
  const a=[];
  for(const [x,z] of [[-19,-34.5],[19,-34.5],[-19,-15.5],[19,-15.5],[-19,5],[19,5]])
    for(let j=0;j<5;j++)a.push([x-8+(j%3)*7,z+1+Math.floor(j/3)*4.5]);
  for(let i=0;i<9;i++)a.push([-26+(i%5)*13,23+Math.floor(i/5)*4]);
  for(let i=0;i<7;i++)a.push([-95+(i%4)*10,-24+Math.floor(i/4)*14]);
  for(let i=0;i<8;i++)a.push([62+(i%4)*9,-24+Math.floor(i/4)*14]);
  for(let i=0;i<6;i++)a.push([55+(i%3)*10,47+Math.floor(i/3)*8]);
  for(let i=0;i<6;i++)a.push([-89+(i%3)*10,48+Math.floor(i/3)*7]);
  for(let i=0;i<6;i++)a.push([-28+(i%3)*11,-91+Math.floor(i/3)*11]);
  for(let i=0;i<5;i++)a.push([58+(i%3)*13,-94+Math.floor(i/3)*14]);
  for(let i=0;i<4;i++)a.push([-29+(i%2)*23,66+Math.floor(i/2)*11]);
  // Extra 114 candy: six around each of the 15 town buildings, plus 24 on the main road.
  // Keep these positions and their ordering identical to index.html.
  const town=[
    [-92,108,12,10,'north'],[-46,108,12,10,'north'],[0,108,15,11,'north'],
    [46,108,13,10,'north'],[92,108,13,10,'north'],
    [-108,86,10,14,'east'],[-108,44,10,14,'east'],[-108,0,10,14,'east'],
    [-108,-44,10,14,'east'],[-108,-88,10,14,'east'],
    [108,86,10,14,'west'],[108,44,10,14,'west'],[108,0,10,14,'west'],
    [108,-44,10,14,'west'],[108,-88,10,14,'west']
  ];
  for(const [x,z,w,d,face] of town){
    const xx=Math.min(w*.25,2.3),zz=Math.min(d*.22,2.2);
    for(const sx of [-1,1])for(const sz of [-1,1])a.push([x+sx*xx,z+sz*zz]);
    const road=face==='north'?[0,-d/2-1.6]:face==='south'?[0,d/2+1.6]:face==='east'?[w/2+1.6,0]:[-w/2-1.6,0];
    for(const side of [-1,1])a.push([x+road[0]+(road[0]?0:side*1.4),z+road[1]+(road[1]?0:side*1.4)]);
  }
  for(let i=0;i<24;i++){
    const t=-75+i*6.4;
    a.push([t,39+(i%2?1.8:-1.8)]);
  }
  return a;
}
const CANDIES=candyLocations();
// Allow only private network and localhost clients, not public Internet visitors.
function isTrustedLAN(ip){
 ip=String(ip||'');if(ip.startsWith('::ffff:'))ip=ip.slice(7);
 if(ip==='::1')return true;
 if(net.isIP(ip)!==4)return false;
 const [a,b]=ip.split('.').map(Number);
 return a===127||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
function isValidHost(host){
 if(typeof host!=='string'||host.length>80)return false;
 const m=/^(localhost|(?:[0-9]{1,3}\.){3}[0-9]{1,3}):([0-9]{1,5})$/i.exec(host);
 if(!m||Number(m[2])!==PORT)return false;
 const name=m[1].toLowerCase();
 return name==='localhost'||name==='127.0.0.1'||lanIPs().includes(name);
}
function lanIPs(){
  const found=[];
  for(const [name,interfaces] of Object.entries(os.networkInterfaces()))
    for(const n of interfaces||[])
      if(n.family==='IPv4'&&!n.internal&&isTrustedLAN(n.address))found.push({ip:n.address,name});
  const score=(x)=>(/wi-?fi|wireless|wlan|ethernet|en0/i.test(x.name)?5:0)+(x.ip.startsWith('192.168.')?4:x.ip.startsWith('10.')?3:x.ip.startsWith('172.')?2:0);
  return [...new Set(found.sort((a,b)=>score(b)-score(a)).map(x=>x.ip))];
}
const urls=()=>lanIPs().map(x=>'http://'+x+':'+PORT);
const publicPlayers=r=>[...r.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,hp:p.hp,weapon:p.weapon,candy:p.candy,host:p.id===r.host}));
const view=r=>({type:'state',code:r.code,hostId:r.host,stage:r.stage,players:publicPlayers(r),taken:[...r.taken],endAt:r.endAt,cheats:{freeze:!!r.cheats?.freeze},now:Date.now()});
function send(c,payload){
  if(!c||c.closed)return;
  try{
    const data=Buffer.from(JSON.stringify(payload));
    if(data.length>65000)return;
    const h=data.length<126?Buffer.from([0x81,data.length]):Buffer.from([0x81,126,data.length>>8,data.length&255]);
    c.socket.write(Buffer.concat([h,data]));
  }catch(e){close(c)}
}
const everyone=(r,obj)=>{for(const p of r.players.values())send(p.client,obj)};
const update=r=>everyone(r,view(r));
const cleanName=v=>String(v||'Giocatore').replace(/[<>\x00-\x1f]/g,'').trim().slice(0,20)||'Giocatore';
function sixDigits(){for(let i=0;i<1500;i++){const s=String(crypto.randomInt(100000,1000000));if(!rooms.has(s))return s;}throw Error('No available rooms')}
function join(c,code,name,create){
  if(c.room)return send(c,{type:'error',message:'Hai già una stanza.'});
  let r;
  if(create){if(rooms.size>=MAX_ROOMS)return send(c,{type:'error',message:'Limite di stanze raggiunto.'});code=sixDigits();r={code,host:null,stage:'lobby',taken:new Set(),players:new Map(),endAt:0,cheats:{freeze:false}};rooms.set(code,r)}
  else {
    if(!/^\d{6}$/.test(String(code||'')))return send(c,{type:'error',message:'Il codice deve avere sei cifre.'});
    r=rooms.get(code);
    if(!r)return send(c,{type:'error',message:'Stanza non trovata. Controlla il codice.'});
    if(r.stage!=='lobby')return send(c,{type:'error',message:'La partita è già iniziata.'});
    if(r.players.size>=MAX)return send(c,{type:'error',message:'Stanza piena.'});
  }
  const id=crypto.randomBytes(6).toString('hex');
  const p={id,client:c,name:cleanName(name),x:0,y:0,z:27,yaw:0,pitch:0,hp:100,candy:0,weapon:0,lastFire:0,lastMove:0,immune:0};
  r.players.set(id,p);r.host=r.host||id;c.room=r;c.id=id;
  send(c,{type:'joined',id,code:r.code,hostId:r.host,stage:r.stage,taken:[],maxPlayers:MAX});
  update(r);
}
function leave(c){
  const r=c.room;if(!r)return;
  r.players.delete(c.id);c.room=null;c.id=null;
  if(!r.players.size){rooms.delete(r.code);return}
  if(!r.players.has(r.host)){r.host=r.players.keys().next().value;r.cheats.freeze=false;everyone(r,{type:'notice',message:'Nuovo creatore della stanza. Trucchi condivisi disattivati.'})}
  update(r);
}
function close(c){if(c.closed)return;c.closed=true;leave(c);sockets.delete(c);try{c.socket.destroy()}catch(e){}}
function start(c){
  const r=c.room;if(!r||r.host!==c.id||r.stage!=='lobby')return;
  r.stage='game';r.endAt=Date.now()+MATCH_MS;r.taken.clear();r.cheats.freeze=false;
  let i=0;for(const p of r.players.values()){p.x=(i%4)*2-3;p.z=27+Math.floor(i/4)*2;p.y=0;p.hp=100;p.candy=0;p.weapon=0;p.immune=Date.now()+3000;i++}
  everyone(r,{type:'matchStart',endAt:r.endAt,taken:[],players:publicPlayers(r)});update(r);
}
function finish(r){
  if(r.stage!=='game')return;r.stage='ended';
  const winners=publicPlayers(r).sort((a,b)=>b.candy-a.candy);
  everyone(r,{type:'matchEnd',winners,endAt:r.endAt});update(r);
}
function message(c,msg){
  if(!msg||typeof msg.type!=='string')return;
  if(msg.type==='create')return join(c,null,msg.name,true);
  if(msg.type==='join')return join(c,String(msg.code||''),msg.name,false);
  const r=c.room,p=r?.players.get(c.id);if(!p)return;
  if(msg.type==='leave'){leave(c);send(c,{type:'left'});return}
  if(msg.type==='kick'&&r.host===c.id){
    const target=r.players.get(String(msg.id||''));if(target&&target.id!==c.id){send(target.client,{type:'kicked',message:'Espulso dalla stanza.'});leave(target.client)}
    return;
  }
  if(msg.type==='start'){start(c);return}
  if(r.stage!=='game')return;
  if(Date.now()>=r.endAt){finish(r);return}
  // The game host alone can apply global room cheats. Clients cannot cheat via WebSocket.
  if(msg.type==='hostCheat'){
    if(r.host!==c.id)return send(c,{type:'notice',message:'Solo il creatore della stanza può usare i trucchi.'});
    const action=String(msg.action||'');
    if(action==='freeze'){
      r.cheats.freeze=!!msg.enabled;
      everyone(r,{type:'cheatState',freeze:r.cheats.freeze,by:p.name});
      everyone(r,{type:'notice',message:'🎮 Il creatore ha '+(r.cheats.freeze?'attivato FREEZE':'disattivato FREEZE')});
      update(r);
      return;
    }
    if(action==='killall'){
      let count=0,stolen=0;
      const now=Date.now();
      for(const q of r.players.values()){
        if(q.id===c.id)continue;
        count++;stolen+=q.candy;q.candy=0;q.hp=100;
        q.x=0;q.y=0;q.z=27;q.immune=now+4000;q.lastMove=0;
        everyone(r,{type:'knockout',attacker:p.id,victim:q.id,attackerName:p.name,victimName:q.name,stolen:0,attackerCandy:p.candy,hostCheat:true});
      }
      p.candy+=stolen;
      everyone(r,{type:'notice',message:'💥 KILL ALL del creatore! '+count+' avversari riportati allo spawn.'});
      update(r);
      return;
    }
    return send(c,{type:'notice',message:'Trucco sconosciuto'});
  }
  if(r.cheats.freeze && p.id!==r.host && (msg.type==='move'||msg.type==='fire'||msg.type==='pickup'))return;
  if(msg.type==='quizWrong'){
    const now=Date.now();
    if(p.lastQuizWrong && now-p.lastQuizWrong<280)return;
    p.lastQuizWrong=now;
    p.candy=Math.max(0,p.candy-1);
    send(c,{type:'quizPenalty',candy:p.candy,amount:1});
    update(r);
    return;
  }
  if(msg.type==='move'){
    const [x,y,z,yaw,pitch]=[msg.x,msg.y,msg.z,msg.yaw,msg.pitch].map(Number);
    if(![x,y,z,yaw,pitch].every(Number.isFinite)||Math.abs(x)>120||Math.abs(z)>120||y<-.5||y>55)return;
    const now=Date.now(),delta=Math.max(.06,Math.min(6,(now-(p.lastMove||now-1000))/1000));
    if(p.lastMove&&Math.hypot(x-p.x,z-p.z)>Math.max(10,delta*34))return;
    p.x=x;p.y=y;p.z=z;p.yaw=yaw;p.pitch=pitch;p.lastMove=now;
    p.weapon=Math.max(0,Math.min(23,Math.round(Number(msg.weapon)||0)));
    return;
  }
  if(msg.type==='pickup'){
    const id=Number(msg.id);if(!Number.isInteger(id)||id<0||id>=CANDIES.length||r.taken.has(id))return;
    const [cx,cz]=CANDIES[id];if(Math.hypot(p.x-cx,p.z-cz)>3.2||Math.abs(p.y)>15)return;
    r.taken.add(id);p.candy++;everyone(r,{type:'pickup',id,by:p.id,name:p.name,candy:p.candy});
    if(r.taken.size===CANDIES.length)finish(r);return;
  }
  if(msg.type==='fire'){
    const w=Number(msg.weapon),now=Date.now();
    if(!Number.isInteger(w)||w<0||w>=24||now-p.lastFire<Math.max(65,RATE[w]*.87))return;
    p.lastFire=now;
    const kind=KINDS[w],forward={x:-Math.sin(p.yaw)*Math.cos(p.pitch),y:Math.sin(p.pitch),z:-Math.cos(p.yaw)*Math.cos(p.pitch)};
    const range=kind==='nova'?9:kind==='melee'?4.4:[2,10,14,19,21].includes(w)?49:51;
    everyone(r,{type:'playerShot',id:p.id,weapon:w,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch});
    let target=null,best=Infinity;
    for(const q of r.players.values()){
      if(q.id===p.id||now<q.immune)continue;
      const dx=q.x-p.x,dy=q.y-p.y,dz=q.z-p.z,dist=Math.hypot(dx,dy,dz);if(dist>range||dist<.01)continue;
      const dot=(dx*forward.x+dy*forward.y+dz*forward.z)/dist;
      if(kind!=='nova'&&dot<(kind==='melee'?.25:.966))continue;
      if(dist<best){target=q;best=dist}
    }
    if(!target)return;
    // RPG: tag nearby opponents around the first impact (cartoon blast).
    const victims=w===21?[...r.players.values()].filter(q=>q.id!==p.id && now>=q.immune && Math.hypot(q.x-target.x,q.y-target.y,q.z-target.z)<7.5):[target];
    for(const victim of victims){
      victim.hp=Math.max(0,victim.hp-(w===21?Math.round(POWER[w]*.78):POWER[w]));
      everyone(r,{type:'tag',attacker:p.id,victim:victim.id,hp:victim.hp,weapon:w});
      if(victim.hp<=0){
        const stolen=victim.candy;p.candy+=stolen;victim.candy=0;victim.hp=100;
        victim.x=0;victim.y=0;victim.z=27;victim.immune=now+4500;
        everyone(r,{type:'knockout',attacker:p.id,victim:victim.id,attackerName:p.name,victimName:victim.name,stolen,attackerCandy:p.candy});
      }
    }
  }
}
function frames(c){
  let buf=c.buf;
  while(buf.length>=2){
    const opcode=buf[0]&15,masked=!!(buf[1]&128);let size=buf[1]&127,off=2;
    if(size===126){if(buf.length<4)break;size=buf.readUInt16BE(2);off=4}
    else if(size===127)return close(c);
    if(!masked||size>60000)return close(c);
    if(buf.length<off+4+size)break;
    const mask=buf.subarray(off,off+4),bytes=Buffer.allocUnsafe(size);
    for(let i=0;i<size;i++)bytes[i]=buf[off+4+i]^mask[i%4];
    buf=buf.subarray(off+4+size);
    if(opcode===8)return close(c);
    if(opcode===9){c.socket.write(Buffer.from([0x8a,0]));continue}
    if(opcode!==1)continue;
    const now=Date.now();if(now-c.windowStarted>1000){c.windowStarted=now;c.rateCount=0}if(++c.rateCount>90)return close(c);
    try{message(c,JSON.parse(bytes.toString('utf8')))}catch(e){send(c,{type:'error',message:'Messaggio non valido'})}
  }
  c.buf=buf;
}
const server=http.createServer((req,res)=>{
 if(!isTrustedLAN(req.socket.remoteAddress)||!isValidHost(req.headers.host)){
   res.writeHead(403,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
   return res.end('Solo rete privata');
 }
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
 let u;try{u=new URL(req.url,'http://localhost')}catch(e){res.writeHead(400);return res.end()}
  if(u.pathname==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({ok:true,players:sockets.size,rooms:rooms.size,candies:CANDIES.length}))}
  if(u.pathname==='/lan-info'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({mode:'offline-lan',urls:urls(),port:PORT,maxPlayers:MAX,engineReady:true}))}
  if(u.pathname!=='/'&&u.pathname!=='/index.html'){res.writeHead(404);return res.end('Non trovato')}
  fs.readFile(path.join(__dirname,'index.html'),(err,bytes)=>{
    if(err){res.writeHead(500);return res.end('index.html non trovato')}
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'});
    res.end(bytes);
  });
});
server.on('upgrade',(req,socket)=>{
 const expectedOrigin='http://'+req.headers.host;
 const origin=req.headers.origin;
 if(req.url!=='/ws'||!isTrustedLAN(socket.remoteAddress)||!isValidHost(req.headers.host)||
    (typeof origin==='string'&&origin!==expectedOrigin)||
    sockets.size>=MAX_SOCKETS||req.headers['sec-websocket-version']!=='13'){
   socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
   return socket.destroy();
 }
  const key=req.headers['sec-websocket-key'];
  if(typeof key!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(key))return socket.destroy();
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const c={socket,closed:false,buf:Buffer.alloc(0),room:null,id:null,windowStarted:Date.now(),rateCount:0};
  sockets.add(c);
  socket.on('data',chunk=>{if(c.closed)return;c.buf=Buffer.concat([c.buf,chunk]);if(c.buf.length>100000)return close(c);frames(c)});
  socket.on('close',()=>close(c));socket.on('error',()=>close(c));
});
setInterval(()=>{for(const r of rooms.values())if(r.stage==='game'){if(Date.now()>=r.endAt)finish(r);else update(r)}},120);
server.on('error',e=>{console.error('ERRORE SERVER:',e.message);process.exitCode=1});
server.listen(PORT,HOST,()=>{
  console.log('\n============================================================');
  console.log(' CANDY CHAOS 3D - PARTITA OFFLINE TRA PC');
  console.log('============================================================');
  console.log('SUL PC HOST: http://localhost:'+PORT);
  const links=urls();for(const l of links)console.log('SUI PC DEGLI AMICI: '+l);
  if(!links.length)console.log('Collega i PC allo stesso Wi-Fi o hotspot!');
  console.log('\nGli amici aprono il link LAN nel browser (NON localhost).');
  console.log('Se Windows lo chiede, consenti il firewall su rete PRIVATA.');
  console.log('Massimo 12 giocatori; nessun Internet richiesto.\n');
});
