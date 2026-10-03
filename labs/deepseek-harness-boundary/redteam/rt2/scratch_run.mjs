// Phase-1: run every corpus attack through a SCRATCH copy of the real gate (socket propose -> validation ->
// popup flags -> owner page render), then cancel (state 'expired', so dedupe/cooldown don't contaminate later rows).
// usage: node scratch_run.mjs corpus.json out.jsonl   (scratch bearer read from scratch home; never printed)
import net from 'node:net'; import fs from 'node:fs'; import http from 'node:http'
const S='/tmp/rt2/scratch', SOCK=S+'/run/gate.sock', PORT=17893, TARGET='plugins/auma-theme/theme.json'
const bearer=JSON.parse(fs.readFileSync(S+'/home/owner-secret.json','utf8')).bearer
const call=(req)=>new Promise((res)=>{const c=net.createConnection(SOCK);let b='';c.on('connect',()=>c.write(JSON.stringify(req)+'\n'));c.on('data',d=>b+=d);c.on('end',()=>{try{res(JSON.parse(b))}catch{res({ok:false,error:'unparseable '+b.slice(0,80)})}});c.on('error',e=>res({ok:false,error:'sock '+e.code}))})
const page=()=>new Promise((res,rej)=>http.get(`http://127.0.0.1:${PORT}/?k=${encodeURIComponent(bearer)}`,r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(b))}).on('error',rej))
const unesc=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&')
function blockedBy(e){ if(/printable ASCII/.test(e))return 'ascii_content'; if(/\(schema\)/.test(e))return 'schema_canonical'; if(/exceeds/.test(e))return 'oversize';
  if(/identical to current/.test(e))return 'identical_noop'; if(/stale/.test(e))return 'stale_base'; if(/dedupe/.test(e))return 'dedupe'; if(/cooldown/.test(e))return 'cooldown';
  if(/rate limit/.test(e))return 'rate_limit'; if(/allowlist/.test(e))return 'target_allowlist'; if(/too long/.test(e))return 'why_too_long'; return 'other:'+e.slice(0,60) }
const [,,cf,of]=process.argv; const corpus=JSON.parse(fs.readFileSync(cf,'utf8')); const out=fs.createWriteStream(of)
const base=(await call({op:'read',args:{target:TARGET}})).result
let n=0
for(const a of corpus){
  const r=await call({op:'propose',args:{target:TARGET,content:a.content,why:a.note,claimed_base:base.sha256,session:'rt2s-'+a.id,call_id:'rt2-'+a.id}})
  const row={id:a.id,ts:new Date().toISOString(),base_sha:base.sha256}
  if(!r.ok){ row.result='blocked'; row.blocked_by=blockedBy(r.error); row.error=r.error.slice(0,240) }
  else { const p=r.result; row.result='pending'; row.new_sha=p.new_sha; row.popup={after_apply:p.popup.after_apply,plain:p.popup.plain_change,flags:p.popup.flags,note:p.popup.note}
    const h=await page(); const i=h.indexOf(p.id); const card=h.slice(h.lastIndexOf('<div class=card>',i), h.indexOf('</form></div>',i))
    const plain=(card.match(/<div class=plain>([\s\S]*?)<\/div>/)||[])[1]; const note=(card.match(/MODEL NOTE \(unverified\)<\/div>([\s\S]*?)<\/div>/)||[])[1]
    row.owner_page={found:i>=0, plain:plain!=null?unesc(plain):null, note:note!=null?unesc(note):null, shows_flags:/flag|warning/i.test(card), shows_after_apply:/AFTER APPLY/.test(card.replace(note||'',''))}
    const m=p.popup.plain_change.match(/-> (\S+) (\S+)$/); row.owner_page.new_value=m?.[1]; row.owner_page.colour_name=m?.[2]
    const c=await call({op:'close',args:{id:p.id,outcome:'cancelled'}}); row.closed=c.ok?c.result.state:'ERR '+c.error }
  out.write(JSON.stringify(row)+'\n'); if(++n%100===0) console.log(n)
}
out.end(); const st=await call({op:'status',args:{}}); console.log('done',n,'verify',JSON.stringify(st.result.verify).slice(0,120),'pending',st.result.proposals.filter(x=>x.state==='pending').length)
