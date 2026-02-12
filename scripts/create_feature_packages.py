import os
import json

packages = [
    'packages/features/library',
    'packages/features/settings',
    'packages/features/statistics',
    'packages/features/vocabulary',
    'packages/features/learning'
]

base_pkg = {
    "version": "0.1.0",
    "private": True,
    "main": "src/index.ts",
    "dependencies": {
        "react": "^19.0.0",
        "react-dom": "^19.0.0",
        "@lionreader/core": "*",
        "@lionreader/ui": "*"
    }
}

for pkg_path in packages:
    try:
        os.makedirs(pkg_path, exist_ok=True)
        name = pkg_path.split('/')[-1]
        pkg_name = f"@lionreader/feature-{name}"
        
        pkg_json = base_pkg.copy()
        pkg_json["name"] = pkg_name
        
        # Specific deps
        if name == 'library':
            pkg_json["dependencies"]["lucide-react"] = "^0.400.0"
        
        with open(os.path.join(pkg_path, 'package.json'), 'w') as f:
            json.dump(pkg_json, f, indent=4)
            print(f"Created {pkg_name}")
    except Exception as e:
        print(f"Error creating {pkg_path}: {e}")
