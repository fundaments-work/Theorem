import os
import json
import re

ROOT_DIR = os.getcwd()

def create_package_tsconfigs():
    print("Creating package tsconfigs...")
    # Standard tsconfig for packages
    tsconfig_base = {
        "extends": "../../tsconfig.base.json",
        "compilerOptions": {
            "outDir": "./dist",
            "rootDir": "./src",
            "baseUrl": ".",
            "paths": {
                "@/*": ["./src/*"]
            }
        },
        "include": ["src"],
        "exclude": ["node_modules", "dist"]
    }
    
    packages = [
        'packages/core',
        'packages/ui',
        'packages/features/reader',
        'packages/features/library',
        'packages/features/settings',
        'packages/features/statistics',
        'packages/features/vocabulary',
        'packages/features/learning'
    ]
    
    for pkg in packages:
        path = os.path.join(ROOT_DIR, pkg, 'tsconfig.json')
        with open(path, 'w') as f:
            json.dump(tsconfig_base, f, indent=4)

    # Create tsconfig.base.json in root
    with open('tsconfig.base.json', 'w') as f:
        json.dump({
            "compilerOptions": {
                "target": "ES2020",
                "useDefineForClassFields": True,
                "lib": ["ES2020", "DOM", "DOM.Iterable"],
                "module": "ESNext",
                "skipLibCheck": True,
                "moduleResolution": "bundler",
                "allowImportingTsExtensions": True,
                "resolveJsonModule": True,
                "isolatedModules": True,
                "noEmit": True,
                "jsx": "react-jsx",
                "strict": True,
                "noUnusedLocals": False,
                "noUnusedParameters": False,
                "noFallthroughCasesInSwitch": True,
                "allowJs": True,
                "checkJs": False
            }
        }, f, indent=4)

def rewrite_imports():
    print("Rewriting imports...")
    
    # 1. CORE mappings (for everyone except Core)
    # Map specifically to bare package import
    core_rewrites = [
        (r'from "@/lib/([^"]+)"', r'from "@lionreader/core"'), # Generic lib/foo -> core
        (r'from "@/lib"', r'from "@lionreader/core"'),
        (r'from "@/hooks/([^"]+)"', r'from "@lionreader/core"'),
        (r'from "@/hooks"', r'from "@lionreader/core"'),
        (r'from "@/store"', r'from "@lionreader/core"'),
        (r'from "@/types"', r'from "@lionreader/core"'),
        (r'from "@/services"', r'from "@lionreader/core"'),
        (r'from "@/services/([^"]+)"', r'from "@lionreader/core"'),
    ]

    # 2. UI mappings (for everyone except UI)
    ui_rewrites = [
        (r'from "@/components/ui/([^"]+)"', r'from "@lionreader/ui"'),
        (r'from "@/components/ui"', r'from "@lionreader/ui"'),
        (r'from "@/components/AppTitlebar"', r'from "@lionreader/ui"'), # exported named/default?
        # Note: AppTitlebar was default export. Importing as { AppTitlebar } from package might fail if not re-exported correctly.
        # We handled re-export: export { default as AppTitlebar } from ...
        # So import AppTitlebar from ... becomes import { AppTitlebar } from ...
        # This regex replace mimics named import?
        # WAIT. `import AppTitlebar from "@/components/AppTitlebar"` -> `import { AppTitlebar } from "@lionreader/ui"`
        (r'import\s+(\w+)\s+from\s+"@/components/AppTitlebar"', r'import { \1 } from "@lionreader/ui"'),
        (r'import\s+(\w+)\s+from\s+"@/components/TheoremLogo"', r'import { \1 } from "@lionreader/ui"'),
        (r'import\s+(\w+)\s+from\s+"@/components/ErrorBoundary"', r'import { \1 } from "@lionreader/ui"'),
        
        # Generic UI components: import { Button } from "@/components/ui/button"? 
        # Usually it was import { Button } from "@/components/ui/button" (lowercase file)
        # But we mapped `src/components/ui` -> `packages/ui/src`
        # And `packages/ui/src/index.ts` exports { Button } from "./button" ?
        # We need to verify `packages/ui/src/index.ts` has all exports.
    ]

    # 3. Reader mappings (for Web)
    reader_rewrites = [
        (r'import\("@/pages/Reader"\)', 'import("@lionreader/feature-reader")'), # Lazy load
        # Reader component imports might be implicit if used in routing
    ]

    for root, dirs, files in os.walk(ROOT_DIR):
        if 'node_modules' in root or 'dist' in root or '.git' in root:
            continue
            
        is_core = 'packages/core' in root
        is_ui = 'packages/ui' in root
        is_reader = 'packages/features/reader' in root
        is_web = 'apps/web' in root
        
        for file in files:
            if not file.endswith(('.ts', '.tsx', '.js', '.jsx')):
                continue
                
            path = os.path.join(root, file)
            with open(path, 'r') as f:
                content = f.read()
            
            new_content = content
            
            # Apply rewrites based on context
            
            if not is_core:
                for pattern, repl in core_rewrites:
                    new_content = re.sub(pattern, repl, new_content)
                    
            if not is_ui:
                for pattern, repl in ui_rewrites:
                    new_content = re.sub(pattern, repl, new_content)
            
            if is_web:
                for pattern, repl in reader_rewrites:
                    new_content = re.sub(pattern, repl, new_content)

            # Special case: apps/web/vite.config.ts alias adjustment?
            # Creating aliases in vite config is good for dev, but we want monorepo resolution.
            # We'll handle vite config separately.

            if new_content != content:
                print(f"Updated {path}")
                with open(path, 'w') as f:
                    f.write(new_content)

if __name__ == '__main__':
    create_package_tsconfigs()
    rewrite_imports()
