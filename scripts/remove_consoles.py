import os
import re

def clean_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Regex for console.log/warn/error/info/debug spanning multiple lines
    # It looks for 'console.log(', then any characters except ';', until closing ')'
    # Note: this is a simple regex and might not catch all edge cases (like strings with brackets)
    # but covers 99% of typical console.log statements.
    new_content = re.sub(r'^[ \t]*console\.(log|debug|info|warn|error)\([\s\S]*?\);?[ \t]*\n', '', content, flags=re.MULTILINE)
    
    # Fallback inline replacements (e.g. after a statement)
    new_content = re.sub(r'console\.(log|debug|info|warn|error)\([\s\S]*?\);?', '', new_content)
    
    if new_content != content:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    return False

def main():
    src_dir = os.path.join(os.path.dirname(__file__), '..', 'src')
    cleaned = 0
    for root, _, files in os.walk(src_dir):
        for file in files:
            if file.endswith(('.ts', '.tsx', '.js', '.jsx')):
                if clean_file(os.path.join(root, file)):
                    cleaned += 1
                    print(f"Cleaned {file}")
    print(f"Total files cleaned: {cleaned}")

if __name__ == '__main__':
    main()
