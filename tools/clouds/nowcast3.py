# Correction par observation sur le fond COMBINÉ (prédictions croisées), pour régler tau.
import numpy as np, pandas as pd
from load import load_all
D=load_all(); H=D[D['human']].copy(); H=H[H['sun']>-6]
for name in ['d1','d0']:
    P=pd.read_csv(f'cvpred_{name}.csv'); ts=(np.ceil(P['time'].values*1000/3600)*3600).astype('int64'); P['time']=pd.to_datetime(ts,unit='s',utc=True)
    P=P.set_index(['sid','time'])['comb']
    P.index=P.index.set_levels(P.index.levels[1].as_unit(H.index.unit) if hasattr(P.index.levels[1],'as_unit') else P.index.levels[1],level=1)
    d=P.to_dict(); H[f'COMB_{name}']=[d.get((s,t),np.nan) for s,t in zip(H['sid'],H.index)]
    print(name,'joint',H[f'COMB_{name}'].notna().sum())
    for h in [1,2,3,4,6,9]:
        A=[]
        for sid,S in H.groupby('sid'):
            S=S.sort_index(); o=S['tot%']; m=S[f'COMB_{name}']
            o1=o.reindex(S.index+pd.Timedelta(hours=h)).values; m1=m.reindex(S.index+pd.Timedelta(hours=h)).values
            ok=~np.isnan(o1)&~np.isnan(m1)&o.notna().values&m.notna().values
            A.append(np.column_stack([o.values[ok],m.values[ok],o1[ok],m1[ok]]))
        o0,m0,o1,m1=np.concatenate(A).T; clear=o1<=25
        sc=lambda f:(np.mean(np.abs(f-o1)),np.mean(f[clear]>=40))
        r={'combiné':sc(m1),'persist':sc(o0)}
        for tau in [1.5,2.5,3,4,5,6]:
            w=np.exp(-h/tau); r[f'mél τ{tau}']=sc(w*o0+(1-w)*m1)
        best=sorted(r.items(),key=lambda kv:kv[1][0])[:4]
        print(f"fond combiné {name} h={h} n={len(o1)} combiné {r['combiné'][0]:.1f}/{r['combiné'][1]:.3f} | "+'; '.join(f'{k} {v[0]:.1f}/{v[1]:.3f}' for k,v in best))
