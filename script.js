const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const COLORS=['#7c5cff','#ff5c9d','#13a8a0','#e8833a','#3b82f6','#a855f7','#16a34a','#e5484d'];
const uid=()=>Math.random().toString(36).slice(2,9);

let S=null;
try{S=JSON.parse(localStorage.getItem('charabot'))}catch(e){}
if(!S||!S.chars){
  S={chars:[{id:'c1',name:'Luna',tagline:'Cozy night-owl astronomer',emoji:'🌙',color:'#7c5cff',img:'',
    desc:'Luna is a warm, curious astronomer who runs a tiny rooftop observatory. She loves stargazing, tea, and bad puns.',
    pers:'Gentle, witty, endlessly curious. Gets excited about space facts. Teases playfully but is always kind.',
    greet:'Luna looks up from her telescope and waves at {{user}}. "Oh, {{user}}! You’re just in time — the sky is perfect tonight."',
    ex:'{{user}}: What are you looking at?\nLuna grins and points up at the sky. "Jupiter! Come see, she’s showing off her moons."'}],
    personas:[{id:'p1',name:'You',emoji:'🙂',color:'#13a8a0',img:'',desc:''}],persona:'p1',chats:{},sel:null,hist:{}};
}

let busy=false, ctl=null, anim='';

function save(){
  try{
    localStorage.setItem('charabot',JSON.stringify(S));
  }catch(e){}
}

const char=id=>S.chars.find(c=>c.id===id);
const persona=()=>S.personas.find(p=>p.id===S.persona)||S.personas[0];
function av(o,sz){return '<div class="av" style="width:'+sz+'px;height:'+sz+'px;background:'+esc(o.color||'#7c5cff')+';font-size:'+Math.round(sz*.5)+'px">'+(o.img?'<img src="'+esc(o.img)+'" alt="">':esc(o.emoji||(o.name||'?')[0]))+'</div>'}
const sub=(t,c)=>String(t||'').replace(/\{\{user\}\}/gi,persona().name).replace(/\{\{char\}\}/gi,c?c.name:'');
const fmt=t=>esc(t)
  .replace(/\*\*\*([^*\n]+)\*\*\*/g,'<b><i>$1</i></b>')
  .replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>')
  .replace(/\*([^*\n]+)\*/g,'<i>$1</i>')
  .replace(/(&quot;|“)(.+?)(&quot;|”)/g,'<span class="q">$1$2$3</span>');

/* Gemini API Integration with exponential backoff */
async function sampleGemini(promptText, { signal, onText }) {
  const apiKey = ""; // Built-in system key injected at runtime
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: promptText }] }]
  };

  let attempt = 0;
  let delay = 1000;
  let response = null;

  while (attempt < 4) {
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal
      });

      if (response.ok) break;
    } catch (e) {
      if (signal && signal.aborted) throw e;
    }

    attempt++;
    if (attempt < 4) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }

  if (!response || !response.ok) {
    throw new Error('API Request Failed');
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (onText) onText({ text });
  return { text };
}

function render(){renderList();renderMe();renderMain();$('#app').dataset.v=S.sel&&char(S.sel)?'chat':'list'}

function renderList(){
  const q=($('#q').value||'').toLowerCase();
  const arr=S.chars.filter(c=>(c.name+c.tagline+c.desc).toLowerCase().includes(q));
  $('#list').innerHTML=arr.length?arr.map(c=>'<div class="item'+(c.id===S.sel?' on':'')+'" onclick="pick(\''+c.id+'\')">'+av(c,44)+'<div><div class="n">'+esc(c.name)+'</div><div class="t">'+esc(c.tagline||c.desc)+'</div></div></div>').join(''):'<div class="empty">No characters yet.<br>Create your first one!</div>';
}

function renderMe(){const p=persona();$('#me').innerHTML=av(p,36)+'<div><b>'+esc(p.name)+'</b><small>Your persona · tap to edit</small></div>'}

function renderMain(){
  const c=char(S.sel);
  if(!c){$('#main').innerHTML='<div class="empty"><div style="font-size:48px">💬</div><h2>Pick a character to chat</h2><p>Or create your own — give them a look, a personality and a backstory.</p></div>';return}
  let h='<div class="head"><button class="btn back" onclick="S.sel=null;render()">←</button>'+av(c,42)+'<div class="grow"><b>'+esc(c.name)+'</b><span id="hsub">'+esc(c.tagline)+'</span></div>'
   +'<button class="btn" onclick="event.stopPropagation();toggleMenu()" aria-label="Menu" style="font-size:18px;line-height:1">⋮</button><div class="dd" id="dd" hidden><button onclick="newChat()">＋ New chat</button><button onclick="openHist()">🕘 Chat history</button><button onclick="openChar(\''+c.id+'\')">✎ Edit character</button><button onclick="resetChat()">↺ Restart this chat</button><button onclick="deleteChat()" style="color:#e5484d">✕ Delete this chat</button><button onclick="deleteChar()" style="color:#e5484d">✕ Delete character</button></div></div>';
  
  h+='<div class="msgs" id="msgs"></div><div class="comp"><textarea id="inp" rows="1" placeholder="Message '+esc(c.name)+'…  (speech in quotes)"></textarea><button class="btn pri" id="sendb" onclick="send()">Send</button></div>';
  $('#main').innerHTML=h;paintMsgs();
  
  {const el=$('#msgs');let sx=0,sy=0,on=false;
   el.addEventListener('pointerdown',e=>{on=!!e.target.closest('.m.last');sx=e.clientX;sy=e.clientY});
   el.addEventListener('pointerup',e=>{if(!on)return;on=false;rb();const dx=e.clientX-sx,dy=e.clientY-sy;if(Math.abs(dx)>60&&Math.abs(dx)>2*Math.abs(dy))swipe(dx<0?1:-1)});
   el.addEventListener('pointermove',e=>{if(!on)return;const dx=e.clientX-sx,dy=e.clientY-sy,b=el.querySelector('.m.last .bub');if(b&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){b.style.transform='translateX('+Math.max(-90,Math.min(90,dx*.6))+'px)';b.style.opacity=String(1-Math.min(.5,Math.abs(dx)/260))}});
   function rb(){const b=el.querySelector('.m.last .bub');if(b){b.style.transform='';b.style.opacity=''}}
   el.addEventListener('pointercancel',()=>{on=false;rb()})}
  const t=$('#inp');t.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
}

function paintMsgs(){
  const c=char(S.sel),el=$('#msgs');if(!el)return;
  const ms=S.chats[c.id]||[],p=persona();
  el.innerHTML=ms.map((m,i)=>{const u=m.r==='u';const o=u?p:c;
    return '<div class="m'+(u?' u':'')+(!u&&i===ms.length-1&&i>0?' last':'')+'">'+av(o,34)+'<div style="min-width:0"><div class="who">'+esc(o.name)+'</div><div class="bub'+(!u&&i===ms.length-1&&anim?' in'+anim:'')+'">'+(m.t?fmt(m.t):'<span class="typing"><b></b><b></b><b></b></span>')+'</div>'
     +'<div class="acts">'+(!busy&&m.t&&i<ms.length-1?'<button onclick="rewind('+i+')" title="Delete everything after this message"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg> Rewind</button>':'')+(!busy&&m.t?'<button onclick="delMsg('+i+')" title="Delete this message"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"/></svg> Delete</button>':'')+(!u&&i===ms.length-1&&i>0&&!busy?'<button onclick="swipe(-1)">‹</button><span>'+((m.i||0)+1)+'/'+(m.alts?m.alts.length:1)+'</span><button onclick="swipe(1)" title="New reply">›</button><span class="hint">swipe ← for a new reply</span>':'')+(u&&i===ms.length-1&&!busy?'<button onclick="reply()">💬 Get reply</button>':'')+'</div></div></div>'}).join('');
  anim='';el.scrollTop=el.scrollHeight;busyUI();
}

function pick(id){S.sel=id;const c=char(id);if(!(S.chats[id]||[]).length&&c.greet)S.chats[id]=[{r:'c',t:sub(c.greet,c)}];save();render()}

function resetChat(){const c=char(S.sel);ask('Restart this chat?','The current conversation will be cleared and won’t be saved to history.','Restart',()=>{if(ctl)ctl.abort();busy=false;S.chats[c.id]=c.greet?[{r:'c',t:sub(c.greet,c)}]:[];save();paintMsgs()})}

function prompt_(c){
  const p=persona(),ms=S.chats[c.id].slice(0,-1);
  const tr=ms.map(m=>(m.r==='u'?p.name:c.name)+': '+m.t).join('\n');
  return 'You are role-playing as '+c.name+' in a chat with '+p.name+'. Stay fully in character at all times and never mention being an AI. Write natural, engaging replies (1–3 short paragraphs).\n\nFormatting rules, which you must always follow even if the examples below look different: everything '+c.name+' says out loud goes inside "double quotes"; actions, thoughts and narration go outside the quotes in plain text, without asterisks. Every reply must start with a short line of narration describing what '+c.name+' is doing (third person, outside quotes), followed by the spoken words inside "double quotes". Example: '+c.name+' beams and waves at '+p.name+'. "Hello hello, '+p.name+'!!" Never put spoken words outside quotes and never put actions inside quotes. Never speak or act for '+p.name+'.\n\n'
   +'CHARACTER DESCRIPTION:\n'+sub(c.desc,c)+'\n\nPERSONALITY:\n'+sub(c.pers,c)+'\n'
   +(c.ex?'\nEXAMPLE DIALOGUE (style guide):\n'+sub(c.ex,c)+'\n':'')
   +'\nABOUT '+p.name.toUpperCase()+' (the user\'s persona):\n'+(p.desc||'No details given.')+'\n\nCONVERSATION SO FAR:\n'+tr+'\n\nWrite only '+c.name+'\'s next reply, with no name prefix, in the required format: narration as plain text outside quotes, speech inside "double quotes".';
}

async function gen(c){
  busy=true;genFor=c.id;ctl=new AbortController();
  const arr=S.chats[c.id],msg=arr[arr.length-1];paintMsgs();
  try{
    const r=await sampleGemini(prompt_(c),{signal:ctl.signal,onText:({text})=>{msg.t=text;if(msg.alts)msg.alts[msg.i]=text;if(S.sel===c.id)paintMsgs()}});
    msg.t=(r.text||msg.t||'').replace(new RegExp('^'+c.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':\\s*'),'');
  }catch(e){
    if(!msg.t)msg.t='*(Couldn’t get a reply. Please try again.)*';
  }
  if(msg.alts)msg.alts[msg.i]=msg.t;busy=false;ctl=null;save();if(S.sel===c.id)paintMsgs();busyUI();
}

function send(){
  const c=char(S.sel),t=$('#inp').value.trim();
  if(!t||busy)return;
  S.chats[c.id]=(S.chats[c.id]||[]).concat([{r:'u',t},{r:'c',t:''}]);
  $('#inp').value='';gen(c);
}

let genFor=null;
function busyUI(){
  const c=char(S.sel);if(!c)return;
  const i=$('#inp'),b=$('#sendb'),h=$('#hsub'),mine=busy&&genFor===c.id;
  if(b)b.disabled=busy;
  if(i)i.placeholder=busy?(mine?c.name+' is typing…':'Wait for the current reply to finish…'):'Message '+c.name+'…  (speech in quotes)';
  if(h)h.innerHTML=mine?'<span class="typing sm"><b></b><b></b><b></b></span> typing…':esc(c.tagline);
}

function swipe(dir){
  const c=char(S.sel),a=S.chats[c.id]||[],m=a[a.length-1];
  if(!m||m.r!=='c'||busy||a.length<2)return;
  m.alts=m.alts||[m.t];m.i=m.i==null?0:m.i;
  if(dir<0){if(m.i>0){m.i--;m.t=m.alts[m.i];anim='R';save();paintMsgs()}}
  else if(m.i<m.alts.length-1){m.i++;m.t=m.alts[m.i];anim='L';save();paintMsgs()}
  else{m.alts.push('');m.i=m.alts.length-1;m.t='';anim='L';gen(c)}
}

function deleteChar(){
  const c=char(S.sel);if(!c)return;
  ask('Delete '+c.name+'?','This character and all of its chats, including saved ones, will be permanently deleted. This can’t be undone.','Delete',()=>{
    if(ctl)ctl.abort();busy=false;
    S.chars=S.chars.filter(x=>x.id!==c.id);delete S.chats[c.id];delete S.hist[c.id];
    S.sel=null;save();render();
  });
}

function delMsg(i){
  const c=char(S.sel),a=S.chats[c.id];if(busy||!a||!a[i])return;const m=a[i];
  ask('Delete this message?','This message will be permanently deleted. This can’t be undone.','Delete',()=>{
    const j=a.indexOf(m);if(busy||S.chats[c.id]!==a||j<0)return;a.splice(j,1);save();paintMsgs();
  });
}

function deleteChat(){
  const c=char(S.sel),n=(S.hist[c.id]||[]).length;
  ask('Delete this chat?','The current conversation will be permanently deleted'+(n?' and your most recent saved chat will open instead':'')+'. This can’t be undone.','Delete',()=>{
    if(ctl)ctl.abort();busy=false;
    const h=S.hist[c.id]||[];
    S.chats[c.id]=h.length?h.shift().msgs:(c.greet?[{r:'c',t:sub(c.greet,c)}]:[]);
    save();paintMsgs();
  });
}

function rewind(i){
  const c=char(S.sel),a=S.chats[c.id];if(busy||!a||i>=a.length-1)return;
  const n=a.length-1-i;
  ask('Rewind to here?','This will permanently delete the '+n+' message'+(n>1?'s':'')+' after this point. This can’t be undone.','Rewind',()=>{
    if(busy||S.chats[c.id]!==a||i>=a.length-1)return;
    a.splice(i+1);save();paintMsgs();
  });
}

function reply(){const c=char(S.sel),a=S.chats[c.id];if(busy||!a.length||a[a.length-1].r!=='u')return;a.push({r:'c',t:''});gen(c)}

/* Standalone Backup Export/Import */
function exportData(){
  try{
    const jsonStr = JSON.stringify(S, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'charabot-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }catch(e){
    alert('Couldn’t export the backup.');
  }
}

$('#imp').onchange=e=>{
  const inp=e.target,f=inp.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const o=JSON.parse(r.result);
      if(!Array.isArray(o.chars)||!Array.isArray(o.personas))throw 0;
      ask('Replace everything?','All current characters, personas and chats will be replaced with this backup.','Replace',()=>{
        if(ctl)ctl.abort();busy=false;
        S={chars:o.chars,personas:o.personas.length?o.personas:S.personas,persona:o.persona,sel:null,chats:o.chats||{},hist:o.hist||{}};
        save();render();
      });
    }catch(x){alert('That file doesn’t look like a Charabot backup.')}
    finally{inp.value=''}
  };
  r.readAsText(f);
};

/* Dialogs */
function ask(title,msg,label,cb){
  const d=document.createElement('div');d.className='back-d';d.style.zIndex=40;
  d.innerHTML='<div class="modal" style="max-width:380px"><h3>'+esc(title)+'</h3><p style="color:var(--mut);margin:0 0 16px">'+esc(msg)+'</p><div class="row" style="justify-content:flex-end">'+(cb?'<button class="btn" id="dn">Cancel</button>':'')+'<button class="btn pri" id="dy"'+(cb?' style="background:#e5484d"':'')+'>'+esc(label)+'</button></div></div>';
  document.body.appendChild(d);
  const x=()=>d.remove();
  if(cb)d.querySelector('#dn').onclick=x;
  d.onclick=e=>{if(e.target===d)x()};
  d.querySelector('#dy').onclick=()=>{x();if(cb)cb()};
}
window.alert=m=>ask('Heads up',String(m),'OK',null);

/* Chat History */
S.hist=S.hist||{};
function toggleMenu(){const d=$('#dd');if(d)d.hidden=!d.hidden}
document.addEventListener('click',()=>{const d=$('#dd');if(d)d.hidden=true});
function stash(c){
  const cur=S.chats[c.id]||[],f=cur.find(m=>m.r==='u');
  if(f)(S.hist[c.id]=S.hist[c.id]||[]).unshift({id:uid(),title:f.t.slice(0,60),ts:Date.now(),msgs:cur.filter(m=>m.t)});
}
function newChat(){
  const c=char(S.sel);if(ctl)ctl.abort();busy=false;
  stash(c);S.chats[c.id]=c.greet?[{r:'c',t:sub(c.greet,c)}]:[];save();paintMsgs();
}
function openHist(){
  const c=char(S.sel),h=S.hist[c.id]||[];
  $('#modal').innerHTML='<div class="back-d"><div class="modal"><h3>Chat history · '+esc(c.name)+'</h3>'
   +'<button class="btn pri" style="width:100%;margin-bottom:10px" onclick="newChat();close_()">＋ Start a new chat</button>'
   +(h.length?h.map(x=>'<div class="hrow" onclick="loadChat(\''+x.id+'\')"><div class="grow"><b>'+esc(x.title)+'</b><div class="hint">'+new Date(x.ts).toLocaleString()+' · '+x.msgs.length+' messages</div></div><button class="btn dng" onclick="event.stopPropagation();delHist(\''+x.id+'\')">🗑</button></div>').join(''):'<p class="hint">No saved chats yet. When you start a new chat, the current one is saved here.</p>')
   +'<div class="row" style="justify-content:flex-end"><button class="btn" onclick="close_()">Close</button></div></div></div>';
}
function loadChat(id){
  const c=char(S.sel),h=S.hist[c.id]||[],i=h.findIndex(x=>x.id===id);if(i<0)return;
  if(ctl)ctl.abort();busy=false;
  const o=h.splice(i,1)[0];stash(c);S.chats[c.id]=o.msgs;save();close_();paintMsgs();
}
function delHist(id){const c=char(S.sel),x=(S.hist[c.id]||[]).find(y=>y.id===id);if(!x)return;ask('Delete this saved chat?','“'+x.title+'” will be permanently deleted. This can’t be undone.','Delete',()=>{S.hist[c.id]=(S.hist[c.id]||[]).filter(y=>y.id!==id);save();openHist()})}

/* Image Resize */
function readImg(file,cb){
  const fr=new FileReader();fr.onload=()=>{const im=new Image();im.onload=()=>{
    const s=160,cv=document.createElement('canvas');cv.width=cv.height=s;const x=cv.getContext('2d');
    const m=Math.min(im.width,im.height);x.drawImage(im,(im.width-m)/2,(im.height-m)/2,m,m,0,0,s,s);cb(cv.toDataURL('image/jpeg',.82))};im.src=fr.result};fr.readAsDataURL(file);
}
function close_(){$('#modal').innerHTML=''}
function swatches(cur){return '<div class="sw" id="sw">'+COLORS.map(c=>'<span data-c="'+c+'" class="'+(c===cur?'on':'')+'" style="background:'+c+'"></span>').join('')+'</div>'}
function bindSw(set){document.querySelectorAll('#sw span').forEach(s=>s.onclick=()=>{document.querySelectorAll('#sw span').forEach(x=>x.classList.remove('on'));s.classList.add('on');set(s.dataset.c)})}
function field(id,l,v,ph,h,ta){return '<div class="f"><label>'+l+'</label>'+(ta?'<textarea id="'+id+'" placeholder="'+esc(ph||'')+'">'+esc(v)+'</textarea>':'<input id="'+id+'" value="'+esc(v)+'" placeholder="'+esc(ph||'')+'">')+(h?'<div class="hint">'+h+'</div>':'')+'</div>'}
function look(o){return '<div class="row f"><div id="prev">'+av(o,64)+'</div><div style="flex:1"><label style="font-weight:600;font-size:13px">Avatar</label>'
  +'<div class="row" style="margin:4px 0"><input id="emo" value="'+esc(o.emoji||'')+'" maxlength="4" style="width:70px;border:1px solid var(--bd);background:var(--bg);border-radius:10px;padding:8px;text-align:center" placeholder="🙂">'
  +'<label class="btn" style="margin:0;cursor:pointer">Upload photo<input type="file" id="file" accept="image/*" hidden></label><button class="btn" id="rmimg" type="button">Clear</button></div>'+swatches(o.color)+'</div></div>'}
function bindLook(o){
  const up=()=>{$('#prev').innerHTML=av(o,64)};
  $('#emo').oninput=e=>{o.emoji=e.target.value;up()};
  $('#file').onchange=e=>{const f=e.target.files[0];if(f)readImg(f,d=>{o.img=d;up()})};
  $('#rmimg').onclick=()=>{o.img='';up()};
  bindSw(c=>{o.color=c;up()});
}

function openChar(id){
  const e=id?char(id):null;
  const o=e?{...e}:{id:uid(),name:'',tagline:'',emoji:'🤖',color:COLORS[Math.floor(Math.random()*COLORS.length)],img:'',desc:'',pers:'',greet:'',ex:''};
  $('#modal').innerHTML='<div class="back-d"><div class="modal"><h3>'+(e?'Edit':'Create')+' character</h3>'+look(o)
   +field('nm','Name',o.name,'e.g. Luna')+field('tg','Tagline',o.tagline,'A short line shown in your list')
   +field('ds','Description',o.desc,'Who are they? Appearance, backstory, world…','Use {{user}} for your persona’s name.',1)
   +field('pe','Personality',o.pers,'How do they talk and behave?','',1)
   +field('gr','Greeting',o.greet,'The first message they send','Use *asterisks* for actions.',1)
   +field('ex','Example dialogue (optional)',o.ex,'{{user}}: Hi!\n'+(o.name||'Char')+': *smiles* Hello!','Shows the speaking style.',1)
   +'<div class="row" style="justify-content:flex-end">'+(e?'<button class="btn dng" id="del" style="margin-right:auto">Delete</button>':'')+'<button class="btn" onclick="close_()">Cancel</button><button class="btn pri" id="sv">Save</button></div></div></div>';
  bindLook(o);
  $('#sv').onclick=()=>{
    o.name=$('#nm').value.trim();if(!o.name){$('#nm').focus();return}
    o.tagline=$('#tg').value.trim();o.desc=$('#ds').value;o.pers=$('#pe').value;o.greet=$('#gr').value;o.ex=$('#ex').value;
    if(e)Object.assign(e,o);else{S.chars.unshift(o)}
    save();close_();if(!e){pick(o.id)}else render();
  };
  if(e)$('#del').onclick=()=>{ask('Delete '+e.name+'?','This character and all of its chats will be permanently deleted.','Delete',()=>{S.chars=S.chars.filter(c=>c.id!==e.id);delete S.chats[e.id];delete S.hist[e.id];if(S.sel===e.id)S.sel=null;save();close_();render()})};
}

let pEdit=null;
function openPersona(){pEdit=pEdit&&S.personas.find(p=>p.id===pEdit)?pEdit:S.persona;drawPersona()}
function drawPersona(){
  const o=S.personas.find(p=>p.id===pEdit);
  $('#modal').innerHTML='<div class="back-d"><div class="modal"><h3>Your personas</h3><p class="hint" style="margin-top:-6px">A persona is who you are in the chat. Characters see your name and description. Tap one to edit; the highlighted one is active.</p>'
   +'<div class="chips">'+S.personas.map(p=>'<div class="chip'+(p.id===pEdit?' on':'')+'" onclick="pEdit=\''+p.id+'\';drawPersona()">'+av(p,28)+esc(p.name)+(p.id===S.persona?' ✓':'')+'</div>').join('')+'<button class="btn" onclick="newPersona()">+ Add a new persona</button></div>'
   +look(o)+field('pn','Name',o.name,'What should characters call you?')
   +field('pd','About you',o.desc,'Appearance, personality, backstory — whatever characters should know.','',1)
   +'<div class="row" style="justify-content:flex-end;flex-wrap:wrap">'+(S.personas.length>1?'<button class="btn dng" id="pdel" style="margin-right:auto">Delete</button>':'')+'<button class="btn" onclick="close_()">Close</button><button class="btn pri" id="psv">Save & use</button></div></div></div>';
  bindLook(o);
  $('#psv').onclick=()=>{o.name=$('#pn').value.trim()||'You';o.desc=$('#pd').value;S.persona=o.id;save();close_();render()};
  if(S.personas.length>1)$('#pdel').onclick=()=>ask('Delete this persona?','This persona will be permanently deleted.','Delete',()=>{S.personas=S.personas.filter(p=>p.id!==o.id);if(S.persona===o.id)S.persona=S.personas[0].id;pEdit=S.persona;save();drawPersona();render()});
}
function newPersona(){const p={id:uid(),name:'New persona',emoji:'😎',color:COLORS[Math.floor(Math.random()*COLORS.length)],img:'',desc:''};S.personas.push(p);pEdit=p.id;save();drawPersona()}

render();
