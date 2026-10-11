'use strict';
// Server authoritative / commands for Candy Chaos 3D LAN. Never trust client "admin" flags.
const ADMIN_COMMANDS=[
 ['/help','Mostra i 15 comandi'],
 ['/pistola op','Ottieni la pistola OP'],
 ['/kill <nome|all>','Manda un giocatore allo spawn'],
 ['/freeze','Blocca i giocatori (tranne admin)'],
 ['/unfreeze','Sblocca i giocatori'],
 ['/kick <nome>','Espelli un giocatore'],
 ['/heal <nome|me|all>','Ripristina la salute'],
 ['/god <on|off>','Invincibilità amministratore'],
 ['/speed <1-4>','Velocità amministratore'],
 ['/fly <on|off>','Volo amministratore'],
 ['/tp <nome>','Teletrasportati da un giocatore'],
 ['/bring <nome>','Porta un giocatore da te'],
 ['/give <nome> <0-100>','Regala caramelle'],
 ['/clear','Cancella la chat a tutti'],
 ['/say <messaggio>','Annuncio dell’amministratore']
];
const ALLOWED_CHEATS=new Set(['fly','aimbot','freeze','instantKO','god','speed','superJump','stamina','noclip','invis','megaDamage','rapidFire','hugeBlast','candyMagnet','regen','shield','lowGravity','superDash','bigShots','radar','disco']);
function publicCheats(r){const x={};for(const name of ALLOWED_CHEATS)x[name]=!!r.cheats?.[name];return x}
function cleanChat(text){return String(text||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,180)}
function findPlayer(room,s){
 const key=String(s||'').trim().toLocaleLowerCase('it');
 if(!key)return null;
 if(key==='me'||key==='io')return null;
 return [...room.players.values()].find(p=>p.id===s||p.name.toLocaleLowerCase('it')===key)
   ||[...room.players.values()].find(p=>p.name.toLocaleLowerCase('it').startsWith(key))||null;
}
function processCommand(c,raw,api){
 const {send,everyone,update,leave}=api,r=c.room,p=r?.players.get(c.id);
 if(!p)return false;
 const report=(msg)=>send(c,{type:'chat',system:true,name:'SERVER',text:String(msg)});
 if(r.host!==c.id){report('⛔ Solo il creatore della stanza può usare /comandi.');return false;}
 const text=String(raw||'').trim().slice(0,200);
 const match=/^\/([a-zA-Z]+)(?:\s+(.*))?$/i.exec(text);
 if(!match){report('Scrivi / per vedere tutti i comandi disponibili.');return false}
 const cmd=match[1].toLowerCase(),arg=(match[2]||'').trim();
 const knock=(target)=>{
   target.hp=100;target.x=0;target.y=0;target.z=27;target.immune=Date.now()+4000;target.lastMove=0;
   target.opGun=target.opGun&&target.id===r.host;
   everyone(r,{type:'adminTeleport',id:target.id,x:0,y:0,z:27,reason:'kill'});
 };
 const move=(target,destination)=>{
   target.x=Math.max(-115,Math.min(115,destination.x));
   target.y=Math.max(0,Math.min(53,destination.y));
   target.z=Math.max(-115,Math.min(115,destination.z));
   target.lastMove=0;
   send(target.client,{type:'adminTeleport',id:target.id,x:target.x,y:target.y,z:target.z,reason:'tp'});
 };
 let changed=true;
 if(cmd==='help'){send(c,{type:'adminHelp',commands:ADMIN_COMMANDS});return true}
 else if(cmd==='pistola'&&arg.toLowerCase()==='op'){
   p.opGun=true;p.weapon=24;p.lastFire=0;send(c,{type:'opGun',enabled:true});
   everyone(r,{type:'chat',system:true,name:'SERVER',text:'🔫 '+p.name+' ha ricevuto la PISTOLA OP!'});
 }
 else if(cmd==='kill'){
   const victims=arg.toLowerCase()==='all'?[...r.players.values()].filter(q=>q.id!==p.id):[findPlayer(r,arg)].filter(q=>q&&q.id!==p.id);
   if(!victims.length){report('Uso: /kill nome oppure /kill all. Non puoi eliminare te stesso.');return false}
   for(const target of victims)knock(target);
   everyone(r,{type:'chat',system:true,name:'ADMIN',text:'💥 '+p.name+' ha mandato '+victims.length+' giocatori allo spawn.'});
 }
 else if(cmd==='freeze'||cmd==='unfreeze'){
   r.cheats.freeze=cmd==='freeze';
   everyone(r,{type:'cheatState',freeze:r.cheats.freeze,by:p.name});
   everyone(r,{type:'chat',system:true,name:'ADMIN',text:'🧊 '+(r.cheats.freeze?'Freeze attivato':'Freeze disattivato')});
 }
 else if(cmd==='kick'){
   const target=findPlayer(r,arg);
   if(!target||target.id===p.id){report('Uso: /kick nome (non puoi espellere te stesso).');return false}
   send(target.client,{type:'kicked',message:'Espulso dalla stanza da '+p.name});leave(target.client);
   everyone(r,{type:'chat',system:true,name:'ADMIN',text:'🚪 '+target.name+' è stato espulso.'});
 }
 else if(cmd==='heal'){
   const targets=arg.toLowerCase()==='all'?[...r.players.values()]:arg===''||['me','io'].includes(arg.toLowerCase())?[p]:[findPlayer(r,arg)].filter(Boolean);
   if(!targets.length){report('Uso: /heal nome, /heal me o /heal all');return false}
   for(const q of targets)q.hp=100;
   everyone(r,{type:'chat',system:true,name:'ADMIN',text:'❤️ Salute ripristinata per '+targets.length+' giocatori.'});
 }
 else if(cmd==='god'||cmd==='fly'){
   const val=arg.toLowerCase();
   if(val!=='on'&&val!=='off'){report('Uso: /'+cmd+' on oppure /'+cmd+' off');return false}
   r.cheats[cmd]=val==='on';
   report('✅ '+cmd.toUpperCase()+': '+val.toUpperCase());
 }
 else if(cmd==='speed'){
   const n=Number(arg);
   if(!Number.isFinite(n)||n<1||n>4){report('Uso: /speed numero da 1 a 4');return false}
   r.adminSpeed=n;
   r.cheats.speed=n>1;
   report('⚡ Velocità admin: '+n+'x');
 }
 else if(cmd==='tp'){
   const target=findPlayer(r,arg);if(!target){report('Uso: /tp nome');return false}
   move(p,{x:target.x+1.2,y:target.y,z:target.z});
   report('📍 Teletrasportato da '+target.name);
 }
 else if(cmd==='bring'){
   const target=findPlayer(r,arg);
   if(!target||target.id===p.id){report('Uso: /bring nome (un altro giocatore).');return false}
   move(target,{x:p.x+1.2,y:p.y,z:p.z});
   report('📍 '+target.name+' è stato portato da te.');
 }
 else if(cmd==='give'){
   const pieces=arg.split(/\s+/),n=Number(pieces.pop()),target=findPlayer(r,pieces.join(' '));
   if(!target||!Number.isInteger(n)||n<0||n>100){report('Uso: /give nome 20 (da 0 a 100).');return false}
   target.candy=Math.min(9999,target.candy+n);
   everyone(r,{type:'chat',system:true,name:'ADMIN',text:'🍬 '+target.name+' riceve '+n+' caramelle.'});
 }
 else if(cmd==='clear'){
   everyone(r,{type:'chatClear',by:p.name});
   everyone(r,{type:'chat',system:true,name:'SERVER',text:'Chat pulita dall’amministratore.'});
 }
 else if(cmd==='say'){
   const clean=cleanChat(arg);
   if(!clean){report('Uso: /say messaggio');return false}
   everyone(r,{type:'chat',system:true,name:'📢 ADMIN '+p.name,text:clean});
 }
 else{report('Comando inesistente. Premi / e leggi i 15 comandi disponibili.');return false}
 if(changed)update(r);
 return true;
}
module.exports={ADMIN_COMMANDS,ALLOWED_CHEATS,publicCheats,cleanChat,processCommand};
