import os
import json

# 1. Update packages/features/reader/tsconfig.json
reader_ts_path = 'packages/features/features/reader/tsconfig.json'
# Wait, path is packages/features/reader...
# My earlier script might have created it?
reader_ts_path = 'packages/features/reader/tsconfig.json'

if os.path.exists(reader_ts_path):
    with open(reader_ts_path, 'r') as f:
        ts = json.load(f)
    
    # Update paths
    ts['compilerOptions']['paths']['@/foliate-js/*'] = ["./foliate-js/*"]
    # Update include
    if "foliate-js" not in ts['include']:
        ts['include'].append("foliate-js")
        
    with open(reader_ts_path, 'w') as f:
        json.dump(ts, f, indent=4)

# 2. Update apps/web/tsconfig.json
web_ts_path = 'apps/web/tsconfig.json'
with open(web_ts_path, 'r') as f:
    ts = json.load(f)

ts['compilerOptions']['paths']['@/foliate-js/*'] = ["../../packages/features/reader/foliate-js/*"]

with open(web_ts_path, 'w') as f:
    json.dump(ts, f, indent=4)

# 3. Update apps/web/vite.config.ts
# We need to add alias manually using string manipulation or regex if not present
vite_path = 'apps/web/vite.config.ts'
with open(vite_path, 'r') as f:
    content = f.read()

# Check if alias exists
if '"@/foliate-js":' not in content:
    # Insert it
    # Find start of alias block
    # We replaced it earlier with a block ending in `modules/reader/src", import.meta.url)),`
    # We can inject after `@lionreader/feature-reader": ...`
    
    injection = '\n            "@/foliate-js": fileURLToPath(new URL("../../packages/features/reader/foliate-js", import.meta.url)),'
    content = content.replace('feature-reader-src", import.meta.url)),', 'feature-reader/src", import.meta.url)),' + injection)
    # Wait, my previous script used ".../reader/src", import.meta.url)),"
    # I should match strictly.
    # regex matches: `@lionreader/feature-reader": .+?,`
    import re
    content = re.sub(r'("@lionreader/feature-reader": .+?,)', r'\1' + injection, content)

with open(vite_path, 'w') as f:
    f.write(content)
