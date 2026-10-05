import json, sys, time
from concurrent.futures import ThreadPoolExecutor
import pyarrow.dataset as ds, pyarrow.fs as fs
REL = sys.argv[1] if len(sys.argv) > 1 else '2026-09-23.1'
TYPES = ['theme=buildings/type=building', 'theme=transportation/type=segment', 'theme=base/type=land', 'theme=base/type=land_use', 'theme=base/type=water']
s3 = fs.S3FileSystem(anonymous=True, region='us-west-2')
out = {'release': REL, 'types': {}}
def one(frag):
    md = frag.metadata
    b = [180.0, 90.0, -180.0, -90.0]
    for rg in range(md.num_row_groups):
        r = md.row_group(rg)
        for ci in range(r.num_columns):
            c = r.column(ci); p = c.path_in_schema; st = c.statistics
            if not st or not st.has_min_max: continue
            if p.endswith('xmin'): b[0] = min(b[0], float(st.min))
            elif p.endswith('ymin'): b[1] = min(b[1], float(st.min))
            elif p.endswith('xmax'): b[2] = max(b[2], float(st.max))
            elif p.endswith('ymax'): b[3] = max(b[3], float(st.max))
    return [frag.path.split('/')[-1]] + [round(v, 3) for v in b]
for t in TYPES:
    t0 = time.time()
    d = ds.dataset(f'overturemaps-us-west-2/release/{REL}/{t}/', filesystem=s3, format='parquet')
    frags = list(d.get_fragments())
    with ThreadPoolExecutor(16) as ex: rows = list(ex.map(one, frags))
    out['types'][t] = rows
    print(t, len(rows), 'fichiers', round(time.time() - t0), 's', flush=True)
json.dump(out, open('/Users/sgroleau/Documents/_METEOSHOOT/repo/api/overture-index.json', 'w'), separators=(',', ':'))
print('écrit api/overture-index.json')
