import os

# 1. Update packages/ui/src/index.ts
ui_index_path = 'packages/ui/src/index.ts'
with open(ui_index_path, 'a') as f:
    f.write('export { Sidebar } from "./layout/Sidebar";\n')
    f.write('export * from "./modals";\n')

# 2. Update apps/web/vite.config.ts
vite_config_path = 'apps/web/vite.config.ts'
with open(vite_config_path, 'r') as f:
    vite_content = f.read()

# Replace aliases
if 'resolve: {' in vite_content:
    # We replace the entire alias block or just insert
    # Replacing the simple alias block
    new_alias = """alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            "@lionreader/core": fileURLToPath(new URL("../../packages/core/src", import.meta.url)),
            "@lionreader/ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
            "@lionreader/feature-reader": fileURLToPath(new URL("../../packages/features/reader/src", import.meta.url)),
            // Add other features as needed
        },"""
    # Regex replacement for the specific block
    import re
    vite_content = re.sub(r'alias:\s*\{[^}]+\},', new_alias, vite_content)
    
    # Replace foliate-js paths
    vite_content = vite_content.replace('"src/foliate-js/', '"../../packages/features/reader/foliate-js/')
    
    # Replace node_modules path in static copy if needed, effectively likely ../../node_modules
    # But usually vite finds it. Let's try explicit relative path for safety
    vite_content = vite_content.replace('src: "node_modules/', 'src: "../../node_modules/')

with open(vite_config_path, 'w') as f:
    f.write(vite_content)

# 3. Update apps/web/tsconfig.json
tsconfig_path = 'apps/web/tsconfig.json'
# We'll valid JSON here
import json
with open(tsconfig_path, 'r') as f:
    ts_config = json.load(f)

ts_config['compilerOptions']['baseUrl'] = '.'
ts_config['compilerOptions']['paths'] = {
    "@/*": ["./src/*"],
    "@lionreader/core": ["../../packages/core/src"],
    "@lionreader/ui": ["../../packages/ui/src"],
    "@lionreader/feature-reader": ["../../packages/features/reader/src"]
}

with open(tsconfig_path, 'w') as f:
    json.dump(ts_config, f, indent=4)
