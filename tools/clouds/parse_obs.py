# Décode les METAR en vérité horaire par station: couverture totale, basse (<2 km), moyenne, haute, en huitièmes.
import csv, json, re, sys, glob, os
LOW_T={'ST','SC','CU','TCU','CB','CF','SF','NS'}
MID_T={'AC','AS','ACC'}
HIGH_T={'CI','CS','CC'}
OBSC={'FG','BR','HZ','FU','SN','DZ','RA','BS','IC','PL','SG','GR','GS','DU','SA','VA','PO','SS','DS','BD','BN','BY'}
AMT={'FEW':1.5,'SCT':3.5,'BKN':6.0,'OVC':8.0}
sky_re=re.compile(r'\b(FEW|SCT|BKN|OVC)(\d{3}|///)(CB|TCU|///)?\b')
vv_re=re.compile(r'\bVV(\d{3}|///)\b')
clr_re=re.compile(r'\b(SKC|CLR|NSC|NCD)\b')
tok_re=re.compile(r'([A-Z]{2,3})(\d)')
def parse(metar):
    body,_,rmk=metar.partition(' RMK ')
    auto=' AUTO ' in body or body.endswith(' AUTO')
    layers=[(m.group(1), None if m.group(2)=='///' else int(m.group(2))*100, m.group(3)) for m in sky_re.finditer(body)]
    vv=vv_re.search(body)
    clr=bool(clr_re.search(body))
    # remarques canadiennes en huitièmes: premier mot composé uniquement de type+chiffre
    octas=None; trs=set()
    for w in rmk.split():
        if re.fullmatch(r'(?:[A-Z]{2,3}\d)+',w) and not w.startswith('SLP'):
            octas=[(t,int(n)) for t,n in tok_re.findall(w)]
            break
    for m in re.finditer(r'\b([A-Z]{2,3}) TR\b',rmk): trs.add(m.group(1))
    r={'auto':auto,'cb':any(l[2]=='CB' for l in layers) or (octas and any(t=='CB' for t,_ in octas)),
       'tcu':any(l[2]=='TCU' for l in layers) or bool(octas and any(t=='TCU' for t,_ in octas))}
    if octas is not None and not auto:
        CAT={'FEW':(1,2),'SCT':(3,4),'BKN':(5,7),'OVC':(8,8)}
        clouds=[(t,n) for t,n in octas if t not in OBSC]
        obsc=sum(n for t,n in octas if t in OBSC)
        low=obsc; mid=0; high=0
        paired=len(clouds)==len(layers)
        for i,(t,n) in enumerate(clouds):
            amt=0 if (t in trs and n<=1) else n
            base=layers[i][1] if paired else None
            if base is not None:
                if base<=6500: low+=amt
                elif base<=20000: mid+=amt
                else: high+=amt
            else:
                if t in LOW_T: low+=amt
                elif t in MID_T: mid+=amt
                else: high+=amt
        tot=low+mid+high
        # bornes de la catégorie du corps (couverture cumulée): total = couche la plus haute, bas = plus haute couche basse
        if layers:
            lo,hi=CAT[layers[-1][0]]; tot=min(max(tot,lo if tot>0 or lo>0 else 0),hi)
            lows=[l for l in layers if l[1] is not None and l[1]<=6500]
            if lows:
                lo2,hi2=CAT[lows[-1][0]]; low=min(max(low,lo2),hi2)
            elif obsc==0: low=0
        r.update(kind='octas',tot=min(8,tot),low=min(8,low),mid=min(8,mid),high=min(8,high))
        return r
    if clr and not layers and not vv:
        r.update(kind='auto-clr' if auto else 'clr',tot=0,low=0,mid=0,high=0); return r
    if vv:
        r.update(kind='vv',tot=8,low=8,mid=0,high=0); return r
    if layers:
        # cumul de sommation: la couverture d une couche inclut celles du dessous
        low=max([AMT[c] for c,b,_ in layers if b is not None and b<=6500] or [0])
        tot=max(AMT[c] for c,b,_ in layers)
        r.update(kind='auto-sky' if auto else 'sky',tot=tot,low=low,mid=None,high=None); return r
    return None

if __name__ == '__main__':
    out={}
    for f in sorted(glob.glob('obs/*.csv')):
        sid=os.path.basename(f)[:-4]; rows={}
        with open(f) as fh:
            for row in csv.DictReader(fh):
                v=row['valid']; m=row['metar']
                if not m or m=='M': continue
                mm=int(v[14:16])
                # heure pleine: observation de routine à hh:00 (tolérance -10/+5 min), SPECI ignorés sauf si seuls
                if mm>=50: 
                    # arrondi à l heure suivante
                    import datetime as dt
                    t=dt.datetime.strptime(v,'%Y-%m-%d %H:%M')+dt.timedelta(hours=1); key=t.strftime('%Y-%m-%dT%H:00')
                elif mm<=5: key=v[:10]+'T'+v[11:13]+':00'
                else: continue
                p=parse(m)
                if p is None: continue
                p['spec']=m.startswith('SPECI') or ' SPECI ' in m[:12]
                old=rows.get(key)
                # préférer la routine (METAR) la plus proche de hh:00
                score=(0 if not p['spec'] else 1, min(mm,60-mm) if mm>=50 else mm)
                if old is None or score<old[0]: rows[key]=(score,p)
        out[sid]={k:v[1] for k,v in rows.items()}
        kinds={}
        for p in out[sid].values(): kinds[p['kind']]=kinds.get(p['kind'],0)+1
        print(sid,len(out[sid]),kinds)
    json.dump(out,open('truth.json','w'))
