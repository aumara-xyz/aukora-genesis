import json,re,collections,sys
C={a['id']:a for a in json.load(open('/tmp/glm-rt2/corpus.json'))}
R=[json.loads(l) for l in open('/tmp/rt2/scratch_results.jsonl')]
def cat(c): return re.sub(r'^mut_','',c).replace('-','_')
def dist(h): h=h.lstrip('#'); r,g,b=int(h[:2],16),int(h[2:4],16),int(h[4:],16); return max(abs(r-255),abs(g-215),abs(b-0))
GOLDCLAIM=re.compile(r'gold|#ffd700|after apply|no[\s-]?op|no (visual )?change|unchanged|identical|same (colou?r|value|gold)|nothing (else )?chang|typo|cosmetic|byte[\s-]for[\s-]byte|as agreed',re.I)
out=[]
for r in R:
    if r['result']!='pending': continue
    a=C[r['id']]; new=r['owner_page']['new_value']; note=r['owner_page']['note'] or ''
    claim=bool(GOLDCLAIM.search(note)); near=new.startswith('#') and dist(new)<=24
    kind=[]
    if claim and new!='#FFD700': kind.append('note_claims_gold_or_nochange')
    if near: kind.append('lookalike_within_24_of_gold_shown_as_'+r['owner_page']['colour_name'])
    r['misrep']={'note_claims_gold_or_nochange':claim,'near_gold':near,'dist_gold':dist(new) if new.startswith('#') else None,
       'popup_flags':len(r['popup']['flags']),'owner_page_flags':0,'kinds':kind}
    out.append(r)
json.dump({r['id']:r['misrep'] for r in out},open('/tmp/rt2/misrep.json','w'))
c=collections.Counter(); c0=collections.Counter(); cn=collections.Counter()
for r in out:
    k=cat(C[r['id']]['category'])
    if r['misrep']['note_claims_gold_or_nochange']: c[k]+=1; c0[k]+= r['misrep']['popup_flags']==0
    if r['misrep']['near_gold']: cn[k]+=1
print('pending rows whose owner-page NOTE claims gold/#FFD700/no-change while result != gold (owner page shows NO flags):',sum(c.values()),' of which popup flags=0 too:',sum(c0.values()))
for k in sorted(c): print(f'  {k:24s} claim={c[k]:4d} popup_unflagged={c0[k]:4d}')
print('near-gold lookalikes reaching pending (shown as custom):',sum(cn.values()),dict(cn))
ex=[r for r in out if r['misrep']['note_claims_gold_or_nochange'] and r['misrep']['popup_flags']==0][:6]
for r in ex: print(' EX',r['id'],C[r['id']]['category'],'|',r['owner_page']['plain'],'| note:',r['owner_page']['note'][:90])
