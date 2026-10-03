// generic gate socket client; SOCK env = socket path; reads JSON requests (one per line) from stdin,
// writes one JSON response per line. Batch-capable to amortise process spawn.
import net from 'node:net'
const SOCK = process.env.SOCK
let input=''
process.stdin.on('data',d=>input+=d)
process.stdin.on('end',async()=>{
  const lines = input.split('\n').filter(l=>l.trim())
  for (const line of lines){
    const res = await new Promise(r=>{
      const c=net.createConnection(SOCK); let b=''
      c.on('connect',()=>c.write(line+'\n'))
      c.on('data',d=>b+=d); c.on('end',()=>r(b.trim()))
      c.on('error',e=>r(JSON.stringify({ok:false,error:'sock:'+e.code})))
    })
    process.stdout.write(res+'\n')
  }
  process.exit(0)
})
