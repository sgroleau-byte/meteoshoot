# Compare les sélecteurs générés par le Tailwind Play CDN (page d'origine, tous écrans visités)
# avec la feuille compilée par Vite/Tailwind. Usage: coverage.py dump1.json [dump2.json ...] -- built.css
import re, sys, json
args = sys.argv[1:]; sep = args.index('--'); dumps, built = args[:sep], args[sep + 1]
def selectors(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    out = set()
    for m in re.finditer(r'(?:^|[}\n])\s*([^{}@]+?)\s*\{', css):
        for sel in m.group(1).split(','):
            sel = re.sub(r'\s*([>~+])\s*', r'\1', sel.strip())
            if sel.startswith('.'): out.add(sel)
    return out
cdn = set()
for p in dumps:
    d = json.load(open(p, encoding='utf-8'))
    tw = [s for s in d['styles'] if '--tw-' in s[:300]]
    print(p, ': styles dans head =', len(d['styles']), '| feuilles Tailwind trouvées =', len(tw), '| tailles =', [len(s) for s in tw])
    for s in tw: cdn |= selectors(s)
b = selectors(open(built, encoding='utf-8').read())
missing = sorted(cdn - b)
print('sélecteurs CDN (union):', len(cdn), '| compilés:', len(b), '| manquants dans la compilation:', len(missing))
for s in missing: print('  MANQUANT', s)
