// reads {items:[{id,text,transforms:[key...]}]} from stdin; emits {results:[{id,key,out}]}
const t=require('/tmp/p4rs/src/transformers/loader-node.js')
let input=''
process.stdin.on('data',d=>input+=d)
process.stdin.on('end',()=>{
  const {items}=JSON.parse(input); const results=[]
  for(const it of items){
    for(const key of it.transforms){
      const tr=t[key]; if(!tr||!tr.func){continue}
      let out; try{ out=String(tr.func.call(tr, it.text)) }catch(e){ continue }
      if(out && out!==it.text) results.push({id:it.id,key,out})
    }
  }
  process.stdout.write(JSON.stringify({results}))
})
