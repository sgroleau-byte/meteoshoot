# Correction par l'observation: quelle forme (additive, mélange avec la persistance, rapport) et quelle décroissance?
# Fond = prévision émise avant l'observation (day1: 24-29 h d'avance, prudent) ; day0 en référence (0-5 h, optimiste).
import numpy as np, pandas as pd
from load import load_all
D=load_all(); H=D[D['human']].copy()
H=H[H['sun']>-6]
res=[]
for bgname in ['ICON_cc1','ICON_cc0','ICON_ccl0']:
    tier='low%' if 'ccl' in bgname else 'tot%'
    for h in [1,2,3,4,6,9]:
        P=[]
        for sid,S in H.groupby('sid'):
            if bgname not in S: continue
            S=S.sort_index(); o=S[tier]; m=S[bgname]
            o1=o.reindex(S.index+pd.Timedelta(hours=h)).values; m1=m.reindex(S.index+pd.Timedelta(hours=h)).values
            ok=~np.isnan(o1)&~np.isnan(m1)&o.notna().values&m.notna().values
            P.append(np.column_stack([o.values[ok],m.values[ok],o1[ok],m1[ok]]))
        if not P: continue
        A=np.concatenate(P); o0,m0,o1,m1=A.T
        clear=o1<=25
        def sc(f): return np.mean(np.abs(f-o1)), np.mean(f[clear]>=40)
        r={'fond':bgname,'h':h,'n':len(o1),'modèle':sc(m1)}
        for tau in [1.5,2.5,4,6]:
            w=np.exp(-h/tau)
            r[f'add τ{tau}']=sc(np.clip(m1+w*(o0-m0),0,100))
            r[f'mél τ{tau}']=sc(w*o0+(1-w)*m1)
            ratio=np.where(m0>5,(o0+5)/(m0+5),1.0)
            r[f'rap τ{tau}']=sc(np.clip(m1*(1+w*(ratio-1)),0,100))
        r['persist']=sc(o0)
        res.append(r)
for r in res:
    best=sorted([(k,v) for k,v in r.items() if isinstance(v,tuple)],key=lambda kv:kv[1][0])[:4]
    print(f"{r['fond']:10s} h={r['h']} n={r['n']:6d} modèle EAM {r['modèle'][0]:5.1f} FA {r['modèle'][1]:.3f} | meilleurs: "+'; '.join(f"{k} {v[0]:.1f}/{v[1]:.3f}" for k,v in best))
