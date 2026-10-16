# Assemble une table horaire station x heure: vérité METAR + prévisions (day0 historique, day1/day2 previous-runs).
import json, glob, os, math
import numpy as np, pandas as pd
MODELS=['ncep_nbm_conus','ecmwf_ifs','icon_seamless','gem_seamless','gem_hrdps_continental','gfs_seamless','gfs_hrrr','ecmwf_ifs025','ecmwf_aifs025_single','ukmo_seamless']
SHORT={'ncep_nbm_conus':'NBM','ecmwf_ifs':'IFS9','icon_seamless':'ICON','gem_seamless':'GEM','gem_hrdps_continental':'HRDPS','gfs_seamless':'GFS','gfs_hrrr':'HRRR','ecmwf_ifs025':'ECMWF','ecmwf_aifs025_single':'AIFS','ukmo_seamless':'UKMO'}
ST={s['id']:s for s in json.load(open('stations.json'))}

def sun_sin(lat, lon, ts):  # ts: DatetimeIndex UTC
    doy=ts.dayofyear.values; hr=ts.hour.values+ts.minute.values/60
    g=2*np.pi/365*(doy-1+(hr-12)/24)
    dec=0.006918-0.399912*np.cos(g)+0.070257*np.sin(g)-0.006758*np.cos(2*g)+0.000907*np.sin(2*g)-0.002697*np.cos(3*g)+0.00148*np.sin(3*g)
    eot=229.18*(0.000075+0.001868*np.cos(g)-0.032077*np.sin(g)-0.014615*np.cos(2*g)-0.040849*np.sin(2*g))
    tst=hr*60+eot+4*lon; ha=np.radians(tst/4-180); la=np.radians(lat)
    return np.sin(la)*np.sin(dec)+np.cos(la)*np.cos(dec)*np.cos(ha)

def clear_ghi_prev_hour(lat, lon, ts):  # moyenne de l'heure précédente, modèle de Haurwitz
    acc=np.zeros(len(ts))
    for k in range(12):
        s=sun_sin(lat,lon,ts-pd.Timedelta(minutes=5*k+2.5))
        acc+=np.where(s>0.01,1098*s*np.exp(-0.057/np.maximum(s,0.01)),0)
    return acc/12

def load_station(sid, truth):
    t=truth.get(sid,{})
    if not t: return None
    obs=pd.DataFrame.from_dict(t,orient='index'); obs.index=pd.to_datetime(obs.index,utc=True)
    df=obs.copy()
    hfs=[f for f in [f'hist/{sid}.json',f'hist/{sid}.a.json',f'hist/{sid}.b.json',f'hist/{sid}.c.json',f'hist/{sid}.x.json'] if os.path.exists(f)]
    if hfs:
        Hs=[]
        for hf in hfs:
            h=json.load(open(hf))['hourly']; idx=pd.to_datetime(h['time'],utc=True)
            # un seul modèle dans la réponse: Open-Meteo ne suffixe pas le nom des variables (ICON, ou ECMWF 9 km hors du NBM)
            dm='ecmwf_ifs' if hf.endswith('.x.json') else 'icon_seamless'
            Hs.append(pd.DataFrame({(k if any(k.endswith('_'+m) for m in MODELS) else k+'_'+dm):v for k,v in h.items() if k!='time'},index=idx))
        H=pd.concat(Hs,axis=1)
        H=H.loc[:,~H.columns.duplicated()]
        for m in MODELS:
            s=SHORT[m]
            for var,lab in [('temperature_2m','t2'),('dew_point_2m','td2'),('relative_humidity_925hPa','rh925'),('relative_humidity_850hPa','rh850'),('relative_humidity_700hPa','rh700'),('cape','cape'),('cloud_cover','cc0'),('cloud_cover_low','ccl0'),('cloud_cover_mid','ccm0'),('cloud_cover_high','cch0'),('shortwave_radiation','sw0'),('direct_radiation','dir0')]:
                k=f'{var}_{m}'
                if k in H: df[f'{s}_{lab}']=H[k].reindex(df.index)
    for f in glob.glob(f'prev/{sid}_*.json'):
        h=json.load(open(f))['hourly']; idx=pd.to_datetime(h['time'],utc=True)
        dm='ecmwf_ifs' if f.endswith('_x1.json') else 'icon_seamless'
        for k,v in list(h.items()):
            if k=='time': continue
            if not any(k.endswith('_'+m) for m in MODELS): k=k+'_'+dm
            for m in MODELS:
                if k.endswith('_'+m):
                    var=k[:-len(m)-1]; s=SHORT[m]
                    lab={'cloud_cover_previous_day1':'cc1','cloud_cover_previous_day2':'cc2','shortwave_radiation_previous_day1':'sw1','direct_radiation_previous_day1':'dir1'}[var]
                    ser=pd.Series(v,index=idx,dtype='float64')
                    col=f'{s}_{lab}'
                    if col in df: df[col]=df[col].combine_first(ser.reindex(df.index))
                    else: df[col]=ser.reindex(df.index)
    st=ST[sid]
    df['sid']=sid; df['prov']=st['prov']; df['lat']=st['lat']; df['lon']=st['lon']
    df['sun']=np.degrees(np.arcsin(np.clip(sun_sin(st['lat'],st['lon'],df.index),-1,1)))
    df['clr']=clear_ghi_prev_hour(st['lat'],st['lon'],df.index)
    # fenêtres de tournage: lever -60/+60 min, coucher -90/+60 min (élévation -0,833°)
    day=df.index.normalize().unique()
    win=np.zeros(len(df),bool); wkind=np.array(['']*len(df),dtype=object)
    fine=pd.date_range(df.index.min().normalize()-pd.Timedelta(days=1), df.index.max().normalize()+pd.Timedelta(days=2), freq='2min', tz='UTC')
    el=np.degrees(np.arcsin(np.clip(sun_sin(st['lat'],st['lon'],fine),-1,1)))
    up=el>-0.833; cross=np.where(up[1:]!=up[:-1])[0]
    rises=fine[cross[up[cross+1]]+1]; sets=fine[cross[~up[cross+1]]+1]
    ti=df.index.values
    for r in rises:
        m=(ti>=np.datetime64((r-pd.Timedelta(minutes=60)).tz_convert(None)))&(ti<=np.datetime64((r+pd.Timedelta(minutes=60)).tz_convert(None)))
        win|=m; wkind[m]='am'
    for s_ in sets:
        m=(ti>=np.datetime64((s_-pd.Timedelta(minutes=90)).tz_convert(None)))&(ti<=np.datetime64((s_+pd.Timedelta(minutes=60)).tz_convert(None)))
        win|=m; wkind[m]='pm'
    df['win']=win; df['wkind']=wkind
    return df

def load_all():
    truth=json.load(open('truth.json'))
    parts=[load_station(s,truth) for s in ST]
    D=pd.concat([p for p in parts if p is not None])
    D['tot%']=D['tot']*12.5; D['low%']=D['low']*12.5
    D['human']=D['kind'].isin(['octas','clr'])
    return D
