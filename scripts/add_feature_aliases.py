import os
import json
import re

features = [
    "library",
    "settings", 
    "statistics", 
    "vocabulary", 
    "learning"
]

# 1. Update apps/web/tsconfig.json
ts_path = 'apps/web/tsconfig.json'
with open(ts_path, 'r') as f:
    ts = json.load(f)

for feat in features:
    ts['compilerOptions']['paths'][f"@lionreader/feature-{feat}"] = [f"../../packages/features/{feat}/src"]

with open(ts_path, 'w') as f:
    json.dump(ts, f, indent=4)

# 2. Update apps/web/vite.config.ts
vite_path = 'apps/web/vite.config.ts'
with open(vite_path, 'r') as f:
    content = f.read()

# We inject aliases. Look for existing feature-reader alias line
pattern = r'("@lionreader/feature-reader": .+?,)'
replacement = r'\1'
for feat in features:
    alias = f'\n            "@lionreader/feature-{feat}": fileURLToPath(new URL("../../packages/features/{feat}/src", import.meta.url)),'
    replacement += alias

content = re.sub(pattern, replacement, content)

with open(vite_path, 'w') as f:
    f.write(content)
