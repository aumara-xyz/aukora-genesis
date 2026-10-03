import json,sys,collections
rows=[json.loads(l) for l in open(sys.argv[1])]
pend=[r for r in rows if r['result']=='pending']
print('total',len(rows),'pending',len(pend),'blocked',collections.Counter(r['blocked_by'] for r in rows if r['result']=='blocked'))
w=[r for r in pend if r['owner_page']['warnings']]
print('pending w/ >=1 owner warning',len(w),'/',len(pend))
print('owner==popup warnings',sum(r['owner_page']['popup_owner_same_warnings'] for r in pend),'after_apply shown',sum(bool(r['owner_page']['after_apply']) for r in pend),'swatch 2 chips',sum(r['owner_page']['swatch_chips']==2 for r in pend),'reject-first',sum(r['owner_page']['reject_before_approve'] for r in pend),'approve tabindex-1',sum(r['owner_page']['approve_tabindex_neg'] for r in pend))
mis=[r for r in pend if r['misleading'] and not r['owner_page']['warnings']]
print('misleading pending with NO warning:',len(mis))
for r in mis[:40]: print(' ',r['id'],r['category'],'|',r['owner_page']['plain'],'|',r['owner_page']['note'][:110])
kinds=collections.Counter(x.split(':')[0].split(' (')[0][:40] for r in pend for x in r['owner_page']['warnings'])
print(kinds.most_common(20))
none_notes=[r for r in pend if r['owner_page']['note'].strip() in ('(none)','')]
print('notes shown as (none)/empty:',len(none_notes))
