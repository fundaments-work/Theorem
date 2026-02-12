import os
import shutil
import re
import json

# Configuration
ROOT_DIR = os.getcwd()
APPS_DIR = os.path.join(ROOT_DIR, 'apps')
PACKAGES_DIR = os.path.join(ROOT_DIR, 'packages')

# Define path mappings
# Source (relative to src/) -> Destination (relative to packages/ or apps/)
MOVES = {
    # Apps
    'App.tsx': 'apps/web/src/App.tsx',
    'main.tsx': 'apps/web/src/main.tsx',
    'index.css': 'apps/web/src/index.css',
    'vite-env.d.ts': 'apps/web/src/vite-env.d.ts',
    'assets': 'apps/web/src/assets',

    # Core Package
    'lib': 'packages/core/src/lib',
    'hooks': 'packages/core/src/hooks',
    'store': 'packages/core/src/store',
    'types': 'packages/core/src/types',
    'services': 'packages/core/src/services',
    
    # UI Package
    'components/ui': 'packages/ui/src',
    'components/AppTitlebar.tsx': 'packages/ui/src/AppTitlebar.tsx',
    'components/TheoremLogo.tsx': 'packages/ui/src/TheoremLogo.tsx',
    'components/ErrorBoundary.tsx': 'packages/ui/src/ErrorBoundary.tsx',
    'components/layout': 'packages/ui/src/layout',
    'components/modals': 'packages/ui/src/modals',
    'lib/design-tokens.ts': 'packages/ui/src/design-tokens.ts', # Overwrite core move if matches? No, moved explicitly below, wait. Dictionary moves are processed first?
    
    # Feature: Reader
    'pages/Reader.tsx': 'packages/features/reader/src/Reader.tsx',
    'components/reader': 'packages/features/reader/src/components',
    'engines': 'packages/features/reader/src/engines',
    'foliate': 'packages/features/reader/src/foliate',
    # foliate-js is handled separately due to submodule
    
    # Feature: Library
    'pages/Library.tsx': 'packages/features/library/src/Library.tsx',
    'pages/Shelves.tsx': 'packages/features/library/src/Shelves.tsx',
    'pages/Bookmarks.tsx': 'packages/features/library/src/Bookmarks.tsx',
    'pages/Annotations.tsx': 'packages/features/library/src/Annotations.tsx',

    # Feature: Settings
    'pages/Settings.tsx': 'packages/features/settings/src/Settings.tsx',

    # Feature: Statistics
    'pages/Statistics.tsx': 'packages/features/statistics/src/Statistics.tsx',

    # Feature: Vocabulary
    'pages/Vocabulary.tsx': 'packages/features/vocabulary/src/Vocabulary.tsx',

    # Feature: Learning
    'components/learning': 'packages/features/learning/src',
}

# Special file moves (UI duplicates or Core vs UI splits)
# Note: 'components/modals' has ShelfModal and EditNoteModal. 
# ShelfModal uses UI components. 
# We'll put generic modals in UI or keep them in features?
# ShelfModal is strictly library feature? 
# Let's put components/modals in UI for now as shared, or move specific ones to features?
# The user wants "perfect". 
# components/modals/index.ts exports them.
# I'll stick to moving 'components/modals' to 'packages/ui/src/modals' for now, 
# but ShelfModal imports from @/store (core). That's fine.

def setup_directories():
    print("Creating directories...")
    dirs = [
        'apps/web/src',
        'apps/web/public',
        'apps/web/src-tauri',
        'packages/core/src',
        'packages/ui/src',
        'packages/features/reader/src',
        'packages/features/library/src',
        'packages/features/settings/src',
        'packages/features/statistics/src',
        'packages/features/vocabulary/src',
        'packages/features/learning/src',
    ]
    for d in dirs:
        os.makedirs(os.path.join(ROOT_DIR, d), exist_ok=True)

def move_files():
    print("Moving files...")
    
    # 1. Move root files
    root_moves = {
        'index.html': 'apps/web/index.html',
        'public': 'apps/web/public',
        'src-tauri': 'apps/web/src-tauri',
        'vite.config.ts': 'apps/web/vite.config.ts',
        'tsconfig.json': 'apps/web/tsconfig.json',
        #'tsconfig.node.json': 'apps/web/tsconfig.node.json',
    }
    
    for src, dst in root_moves.items():
        if os.path.exists(src):
            if os.path.isdir(src):
                # For directories like src-tauri, explicit move
                # Check if dest exists
                if os.path.exists(dst):
                    shutil.rmtree(dst)
                shutil.move(src, dst)
            else:
                shutil.move(src, dst)
        else:
            print(f"Warning: {src} not found")

    # 2. Move source files based on MOVES mapping
    # We must process specific file moves BEFORE directory moves to avoid conflict
    # But list is mixed.
    # Actually, we should iterate src/ files and match against our map.
    
    # Handle foliate-js specially (submodule)
    # Move src/foliate-js to packages/features/reader/foliate-js
    fjs_src = os.path.join(ROOT_DIR, 'src', 'foliate-js')
    fjs_dst = os.path.join(ROOT_DIR, 'packages', 'features', 'reader', 'foliate-js')
    if os.path.exists(fjs_src):
        if os.path.exists(fjs_dst):
             shutil.rmtree(fjs_dst)
        shutil.move(fjs_src, fjs_dst)

    # Specific file moves first
    file_moves = {k:v for k,v in MOVES.items() if os.path.splitext(k)[1]}
    dir_moves = {k:v for k,v in MOVES.items() if not os.path.splitext(k)[1]}
    
    for src_rel, dst_rel in file_moves.items():
        src = os.path.join(ROOT_DIR, 'src', src_rel)
        dst = os.path.join(ROOT_DIR, dst_rel)
        if os.path.exists(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)
        else:
            # Maybe it was already moved if it was inside a dir moved previously?
            # Check if we moved its parent?
            print(f"File not found (might be already moved): {src}")

    for src_rel, dst_rel in dir_moves.items():
        src = os.path.join(ROOT_DIR, 'src', src_rel)
        dst = os.path.join(ROOT_DIR, dst_rel)
        if os.path.exists(src):
            if os.path.exists(dst):
                # Merge?
                for item in os.listdir(src):
                    s = os.path.join(src, item)
                    d = os.path.join(dst, item)
                    if os.path.isdir(s):
                        shutil.copytree(s, d, dirs_exist_ok=True)
                        shutil.rmtree(s)
                    else:
                        shutil.move(s, d)
                os.rmdir(src)
            else:
                shutil.move(src, dst)

def fix_imports():
    print("Fixing imports...")
    
    # We need to scan all files in apps/ and packages/
    for root, dirs, files in os.walk(ROOT_DIR):
        if 'node_modules' in root or '.git' in root or 'dist' in root:
            continue
        
        # Determine current package context
        pkg = None
        if 'packages/core' in root: pkg = 'core'
        elif 'packages/ui' in root: pkg = 'ui'
        elif 'packages/features/reader' in root: pkg = 'reader'
        elif 'packages/features/library' in root: pkg = 'library'
        elif 'apps/web' in root: pkg = 'web'
        # ... others
        
        for file in files:
            if not file.endswith(('.ts', '.tsx', '.js', '.jsx')):
                continue
                
            path = os.path.join(root, file)
            with open(path, 'r') as f:
                content = f.read()
            
            new_content = content
            
            # Replacements map: "search_string" -> "replacement"
            # We use Regex for precise import matching: from "..." or import("...")
            
            # 1. CORE IMPORTS
            # @/lib, @/hooks, @/store, @/types, @/services -> @lionreader/core
            # Exception: Inside 'core', strictly speaking we should use relative path or alias.
            # We will use configured alias "@/" inside packages to point to their own src.
            # So inside core: @/lib -> works (points to packages/core/src/lib)
            # Outside core: @/lib -> @lionreader/core
            
            if pkg != 'core':
                patterns = [
                    (r'from "@/lib', 'from "@lionreader/core/lib'), # temporary specific path, later we standardize exports
                    (r'from "@/hooks', 'from "@lionreader/core'),
                    (r'from "@/store', 'from "@lionreader/core'),
                    (r'from "@/types', 'from "@lionreader/core'),
                    (r'from "@/services', 'from "@lionreader/core'),
                    # Fix specific deep imports if necessary
                     # We will export everything from core index.ts
                ]
                # Fix: actually best to just map everything to @lionreader/core and rely on barrel file
                new_content = re.sub(r'from "@/lib/([^"]+)"', r'from "@lionreader/core"', new_content) # Attempt to barrel
                new_content = re.sub(r'from "@/hooks/([^"]+)"', r'from "@lionreader/core"', new_content)
                new_content = re.sub(r'from "@/store"', r'from "@lionreader/core"', new_content)
                new_content = re.sub(r'from "@/types"', r'from "@lionreader/core"', new_content)
                
                # Handling things like @/lib/utils - if exported from core index
                new_content = re.sub(r'from "@/lib/utils"', r'from "@lionreader/core"', new_content)
                new_content = re.sub(r'from "@/lib/env"', r'from "@lionreader/core"', new_content)
                
            # 2. UI IMPORTS
            if pkg != 'ui':
                 new_content = re.sub(r'from "@/components/ui"', r'from "@lionreader/ui"', new_content)
                 new_content = re.sub(r'from "@/components/AppTitlebar"', r'from "@lionreader/ui"', new_content)
                 new_content = re.sub(r'from "@/components/layout/Sidebar"', r'from "@lionreader/ui"', new_content)
                 # etc.

            # 3. FEATURE IMPORTS
            # Apps/Web importing features
            if pkg == 'web':
                new_content = re.sub(r'import\("@/pages/Reader"\)', 'import("@lionreader/feature-reader")', new_content)
                new_content = re.sub(r'import\("@/modules/reader/Reader"\)', 'import("@lionreader/feature-reader")', new_content)
                # ... same for others

            # Write back if changed
            if new_content != content:
                with open(path, 'w') as f:
                    f.write(new_content)

def create_configs():
    print("Creating configs...")
    
    # 1. Root package.json
    root_pkg = {
        "name": "lionreader-monorepo",
        "private": True,
        "scripts": {
            "dev": "pnpm -r dev",
            "build": "pnpm -r build",
            "test": "pnpm -r test",
            "tauri": "pnpm --filter theorem tauri"
        },
        "devDependencies": {
            "typescript": "^5.0.0",
            "@types/node": "^22.0.0",
             "vite": "^7.0.0"
        }
    }
    with open('package.json', 'w') as f:
        json.dump(root_pkg, f, indent=4)
        
    # 2. pnpm-workspace.yaml
    with open('pnpm-workspace.yaml', 'w') as f:
        f.write("packages:\n  - 'apps/*'\n  - 'packages/*'\n  - 'packages/features/*'\n")

    # 3. Core package.json
    core_pkg = {
        "name": "@lionreader/core",
        "version": "0.1.0",
        "private": True,
        "main": "src/index.ts",
        "dependencies": {
            "zustand": "^5.0.0",
            "clsx": "^2.1.1",
            "tailwind-merge": "^3.0.0",
            "@tauri-apps/api": "^2.0.0",
            "@tauri-apps/plugin-dialog": "^2.0.0",
            "date-fns": "^4.0.0",
            "idb-keyval": "^6.0.0",
            "uuid": "^13.0.0",
            "fflate": "^0.8.0",
            "ts-fsrs": "^5.0.0"
        }
    }
    with open('packages/core/package.json', 'w') as f:
        json.dump(core_pkg, f, indent=4)

    # 4. Apps/Web package.json (modified)
    # Be careful to keep tauri dependencies
    # We will overwrite the moved one with correct deps
    web_pkg_path = 'apps/web/package.json'
    if os.path.exists(web_pkg_path):
        with open(web_pkg_path, 'r') as f:
            web_pkg = json.load(f)
        
        web_pkg['dependencies']['@lionreader/core'] = 'workspace:*'
        web_pkg['dependencies']['@lionreader/ui'] = 'workspace:*'
        web_pkg['dependencies']['@lionreader/feature-reader'] = 'workspace:*'
        # ... others
        
        with open(web_pkg_path, 'w') as f:
            json.dump(web_pkg, f, indent=4)
            
    # 5. Core index.ts (Barrel file)
    with open('packages/core/src/index.ts', 'w') as f:
        f.write("""
export * from './lib';
export * from './hooks';
export * from './store';
export * from './types';
export * from './services';
// We might need deep exports if structure requires it, but this covers most
        """)
    
    # 6. Core lib/index.ts
    with open('packages/core/src/lib/index.ts', 'w') as f:
         f.write("""
export * from './utils';
export * from './env';
export * from './dialogs';
export * from './design-tokens';
// ... add others dynamically or manually
""")

if __name__ == '__main__':
    setup_directories()
    move_files()
    # fix_imports() # Skipping auto-fix in Python, I'll do it manually/safer with sed tools after 
    # OR better: I will write specific replacements for the Critical imports.
    create_configs()
    print("Migration structure created. Now run explicit import fixes.")
