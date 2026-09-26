# Migre les 4 pages secondaires (site/*.html, React via Babel dans le navigateur) en entrées Vite:
# HTML allégé + src/pages/<page>.jsx + src/pages/<page>.css, sans changer le code de la page.
import re, sys
PAGES = ['login', 'signup', 'account', 'dieu']
HOOKS = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'createContext', 'useContext', 'useLayoutEffect']
for p in PAGES:
    html = open(f'site/{p}.html', encoding='utf-8').read()
    # 1. bloc <style> (le premier) -> css
    m = re.search(r'\n[ \t]*<style>\n(.*?)\n[ \t]*</style>\n', html, re.S)
    assert m, p
    css = m.group(1).replace("url('../fonts/", "url('/fonts/")
    html = html[:m.start()] + '\n' + html[m.end():]
    # 2. script babel -> jsx
    m = re.search(r'\n([ \t]*)<script type="text/babel">\n(.*?)\n[ \t]*</script>\n', html, re.S)
    assert m, p
    indent, code = m.group(1), m.group(2)
    html = html[:m.start()] + f'\n{indent}<script type="module" src="/src/pages/{p}.jsx"></script>\n' + html[m.end():]
    # 3. balises CDN, shared.js, Google Fonts, config tailwind inline
    html = re.sub(r'\n[ \t]*<script src="https://(unpkg\.com|cdn\.jsdelivr\.net|cdn\.tailwindcss\.com)[^"]*"></script>', '', html)
    html = re.sub(r'\n[ \t]*<script src="shared\.js"></script>', '', html)
    html = re.sub(r'\n[ \t]*<link href="https://fonts\.googleapis\.com[^"]*" rel="stylesheet">', '', html)
    m = re.search(r'\n[ \t]*<script>\n[ \t]*tailwind\.config = \{.*?\n[ \t]*</script>', html, re.S)
    assert m, p
    html = html[:m.start()] + html[m.end():]
    assert 'text/babel' not in html and 'unpkg' not in html and 'tailwindcss.com' not in html and 'shared.js' not in html, p
    open(f'site/{p}.html', 'w', encoding='utf-8').write(html)
    # 4. code de la page: dédentation (4 espaces si toutes les lignes non vides les ont) et remplacements
    lines = code.split('\n')
    ded = min((len(l) - len(l.lstrip(' ')) for l in lines if l.strip()), default=0)
    ded = min(ded, 4)
    code = '\n'.join(l[ded:] if l.startswith(' ' * ded) else l for l in lines)
    hooks_used = set()
    def repl(mm):
        for n in mm.group(1).split(','):
            n = n.strip()
            if n: hooks_used.add(n)
        return ''
    code = re.sub(r'^const \{([^}]+)\} = React;\n?', repl, code, flags=re.M)
    code = code.replace('window.supabase.createClient(', 'createClient(').replace('ReactDOM.createRoot(', 'createRoot(')
    uses = lambda name: re.search(r'\b' + re.escape(name) + r'\b', code) is not None
    for h in HOOKS:
        if uses(h): hooks_used.add(h)
    imports = [f"import './{p}.css';", "import '@fontsource/montserrat/300.css';", "import '@fontsource/montserrat/400.css';", "import '@fontsource/montserrat/500.css';", "import '@fontsource/montserrat/600.css';", "import '@fontsource/montserrat/700.css';"]
    hl = sorted(hooks_used)
    imports.append(f"import React{', { ' + ', '.join(hl) + ' }' if hl else ''} from 'react';")
    if uses('ReactDOM'): imports.append("import ReactDOM from 'react-dom';")
    if uses('createRoot'): imports.append("import { createRoot } from 'react-dom/client';")
    if uses('createClient'): imports.append("import { createClient } from '@supabase/supabase-js';")
    cfg = [n for n in ['SUPABASE_URL', 'SUPABASE_KEY', 'LEMON_CHECKOUT_URL'] if uses(n)]
    if cfg: imports.append(f"import {{ {', '.join(cfg)} }} from '../shared/config.js';")
    tr = [n for n in ['TRANSLATIONS', 'getDefaultLang'] if uses(n)]
    if tr: imports.append(f"import {{ {', '.join(tr)} }} from '../shared/translations.js';")
    open(f'src/pages/{p}.jsx', 'w', encoding='utf-8').write('\n'.join(imports) + '\n\n' + code + '\n')
    open(f'src/pages/{p}.css', 'w', encoding='utf-8').write("/* Styles de la page (ancien bloc <style>), puis Tailwind, comme dans la page d'origine. */\n" + css + "\n\n@tailwind base;\n@tailwind components;\n@tailwind utilities;\n")
    print(p, ': html', len(html), 'car. | jsx', len(code), 'car. | hooks', hl, '| config', cfg, '| trad', tr)
