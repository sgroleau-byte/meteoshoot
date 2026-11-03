import sys, re
svg = open(sys.argv[1]).read()
x, y, w = sys.argv[2], sys.argv[3], sys.argv[4]
svg = re.sub(r'viewBox="[^"]+"', f'viewBox="{x} {y} {w} {w}"', svg, count=1)
svg = svg.replace('font-size="13"', 'font-size="7"').replace('stroke-width="2"', 'stroke-width="1"').replace('stroke-width="1.2"', 'stroke-width="0.7"')
open(sys.argv[5], 'w').write(svg)
