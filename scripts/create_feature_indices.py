import os

ROOT_DIR = '/run/media/sapiens/Development1/lionreader'

def create_index(pkg_rel_path, lines):
    # Ensure directory exists
    dir_path = os.path.join(ROOT_DIR, pkg_rel_path, 'src')
    os.makedirs(dir_path, exist_ok=True)
    
    path = os.path.join(dir_path, 'index.ts')
    with open(path, 'w') as f:
        for line in lines:
            f.write(line + '\n')
    print(f"Created {path}")

# Reader
create_index('packages/features/reader', [
    "export { ReaderPage } from './Reader';",
    # "export { ReaderSettings } from './components/ReaderSettings';" # Only if needed
])

# Library
create_index('packages/features/library', [
    "export { LibraryPage } from './Library';",
    "export { ShelvesPage } from './Shelves';",
    "export { BookmarksPage } from './Bookmarks';",
    "export { AnnotationsPage } from './Annotations';",
])

# Settings
create_index('packages/features/settings', [
    "export { SettingsPage } from './Settings';"
])

# Statistics
create_index('packages/features/statistics', [
    "export { StatisticsPage } from './Statistics';"
])

# Vocabulary
create_index('packages/features/vocabulary', [
    "export { VocabularyPage } from './Vocabulary';"
])

# Learning
# Check if index exists or append
learning_index = os.path.join(ROOT_DIR, 'packages/features/learning/src/index.ts')
if not os.path.exists(learning_index):
    try:
        create_index('packages/features/learning', [
            "export { ReviewSessionModal } from './ReviewSessionModal';",
            "export { DictionaryResultPopover } from './DictionaryResultPopover';"
        ])
    except:
        pass
