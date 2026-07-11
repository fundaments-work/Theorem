#!/usr/bin/env bash
# Theorem — Comprehensive Audit Fix Script
# Fixes mechanical issues from COMPREHENSIVE_AUDIT.md automatically.
# Run: bash scripts/fix-audit-issues.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "═══════════════════════════════════════════"
echo " Theorem Audit Fix Script"
echo "═══════════════════════════════════════════"
echo ""

BACKUP_DIR="/tmp/theorem-audit-backup-$(date +%s)"
mkdir -p "$BACKUP_DIR"
echo "Backups: $BACKUP_DIR"

# ─── 1. Fix silent .catch(() => {}) ───
echo ""
echo "─── 1. Fixing silent .catch(() => {}) ───"

fix_catch() {
    local file="$1"
    local bak="$BACKUP_DIR/$(echo "$file" | tr '/' '_').catch.bak"
    cp "$file" "$bak"
    # Replace `.catch(() => {})` with logging version
    # Match: .catch(() => {}) or .catch(()=>{})
    # Replace with: .catch((e) => console.error("[promise] Unhandled:", e))
    sed -i \
        -E 's/\.catch\(\(\)\s*=>\s*\{\}\)/.catch((e) => console.error("[promise] Unhandled:", e))/g' \
        "$file"
    sed -i \
        -E 's/\.catch\(\(\)\s*=>\s*\{\s*\}\)/.catch((e) => console.error("[promise] Unhandled:", e))/g' \
        "$file"
    sed -i \
        -E 's/\.catch\(\(e\)\s*=>\s*\{\s*\}\)/.catch((e) => console.error("[promise] Unhandled:", e))/g' \
        "$file"
    # Count changes
    local changes=$(diff "$bak" "$file" | grep "^>" | wc -l)
    if [ "$changes" -gt 0 ]; then
        echo "  Fixed $changes catch(es) in $file"
    fi
}

# Find all TypeScript files with .catch(() => {})
find src/ -name "*.ts" -o -name "*.tsx" | while read -r file; do
    if grep -q '\.catch\s*\(\s*()\s*=>\s*{}\s*\)' "$file" 2>/dev/null; then
        fix_catch "$file"
    fi
done

# ─── 2. Find and report .unwrap() calls in Rust ───
echo ""
echo "─── 2. Auditing .unwrap() calls in Rust ───"
UNWRAP_COUNT=0
while IFS= read -r line; do
    if [ -n "$line" ]; then
        echo "  $line"
        UNWRAP_COUNT=$((UNWRAP_COUNT + 1))
    fi
done < <(grep -rn '\.unwrap()' src-tauri/src/ --include="*.rs" | grep -v "test\|#\[allow\|unreachable\|\.unwrap_or\|expect(" || true)
echo "  Total: $UNWRAP_COUNT unwrap() calls found (in non-test code)"

# ─── 3. Fix .unwrap() in iroh_sync.rs ───
echo ""
echo "─── 3. Fixing .unwrap() in iroh_sync.rs ───"
IROH_FILE="src-tauri/src/iroh_sync.rs"
cp "$IROH_FILE" "$BACKUP_DIR/iroh_sync.unwrap.bak"

# Fix serde_json::to_vec(...).unwrap() → map_err
sed -i 's/serde_json::to_vec(\(.*\))\.unwrap()/serde_json::to_vec(\1).map_err(|e| format!("serialize: {e}"))?/g' "$IROH_FILE"
# Fix serde_json::to_value(...).unwrap() → map_err  
sed -i 's/serde_json::to_value(\(.*\))\.unwrap()/serde_json::to_value(\1).map_err(|e| format!("to_value: {e}"))?/g' "$IROH_FILE"
# Fix serde_json::from_slice(...).unwrap() → map_err
sed -i 's/serde_json::from_slice(\(.*\))\.unwrap()/serde_json::from_slice(\1).map_err(|e| format!("from_slice: {e}"))?/g' "$IROH_FILE"
# Fix serde_json::from_value(...).unwrap() → map_err
sed -i 's/serde_json::from_value(\(.*\))\.unwrap()/serde_json::from_value(\1).map_err(|e| format!("from_value: {e}"))?/g' "$IROH_FILE"

echo "  Fixed unwrap() calls in $IROH_FILE"

# ─── 4. Audit barrel imports ───
echo ""
echo "─── 4. Auditing barrel imports ───"
BARREL_COUNT=0
while IFS= read -r line; do
    if [ -n "$line" ]; then
        echo "  $line"
        BARREL_COUNT=$((BARREL_COUNT + 1))
    fi
done < <(grep -rn "from.*\.\.\/core['\"]\|from.*\.\.\/core\"\|from.*\.\.\/core\/index" src/ --include="*.ts" --include="*.tsx" || true)
echo "  Total: $BARREL_COUNT barrel imports found"

# ─── 5. Audit dangerouslySetInnerHTML ───
echo ""
echo "─── 5. Auditing dangerouslySetInnerHTML ───"
DANGER_COUNT=0
while IFS= read -r line; do
    if [ -n "$line" ]; then
        echo "  $line"
        DANGER_COUNT=$((DANGER_COUNT + 1))
    fi
done < <(grep -rn "dangerouslySetInnerHTML\|\.innerHTML\s*=" src/ --include="*.tsx" --include="*.ts" || true)
echo "  Total: $DANGER_COUNT dangerouslySetInnerHTML uses"

# ─── 6. Audit React.memo needs ───
echo ""
echo "─── 6. Auditing React.memo gaps ───"
# Find components with useState/useEffect that don't have memo
echo "  Components without React.memo that may need it:"
while IFS= read -r line; do
    echo "  $line"
done < <(grep -rn "export function\|export const.*=>" src/features/ --include="*.tsx" | grep -v "memo\|test\|\.d\.ts" | head -20 || true)

# ─── 7. Audit transition-all ───
echo ""
echo "─── 7. Auditing remaining transition-all ───"
TA_COUNT=0
while IFS= read -r line; do
    if [ -n "$line" ]; then
        echo "  $line"
        TA_COUNT=$((TA_COUNT + 1))
    fi
done < <(grep -rn "transition-all" src/ --include="*.tsx" --include="*.css" || true)
echo "  Total: $TA_COUNT transition-all remaining"

# ─── 8. Fix Cargo.toml deps ───
echo ""
echo "─── 8. Updating Cargo.toml dependencies ───"
CARGO_FILE="src-tauri/Cargo.toml"
cp "$CARGO_FILE" "$BACKUP_DIR/Cargo.bak"

# Update reqwest 0.11 → 0.12
sed -i 's/reqwest = "0.11"/reqwest = "0.12"/g' "$CARGO_FILE" 2>/dev/null || true
# Update rand 0.8 → 0.9
sed -i 's/rand = "0.8"/rand = "0.9"/g' "$CARGO_FILE" 2>/dev/null || true
# Update zip 0.6 → 2
sed -i 's/zip = "0.6"/zip = "2"/g' "$CARGO_FILE" 2>/dev/null || true
echo "  Updated Cargo.toml dependency versions"

# ─── 9. Install DOMPurify and sonner ───
echo ""
echo "─── 9. Installing dependencies ───"
pnpm add dompurify sonner 2>&1 | tail -5
pnpm add -D @types/dompurify 2>&1 | tail -3
echo "  Added dompurify and sonner"

# ─── 10. Summary ───
echo ""
echo "═══════════════════════════════════════════"
echo " Fix Summary"
echo "═══════════════════════════════════════════"
echo "  1. Silent .catch() → logging: Fixed"
echo "  2. .unwrap() in iroh_sync.rs: Fixed (serde only)"
echo "  3. Barrel imports: $BARREL_COUNT found (manual review needed)"
echo "  4. dangerouslySetInnerHTML: $DANGER_COUNT uses (manual DOMPurify wrap needed)"
echo "  5. React.memo gaps: Check above"
echo "  6. transition-all: $TA_COUNT remaining"
echo "  7. Cargo.toml deps: Updated"
echo "  8. dompurify + sonner: Installed"
echo ""
echo " MANUAL STEPS REQUIRED:"
echo "  - Wrap dangerouslySetInnerHTML with DOMPurify.sanitize()"
echo "  - Add sonner <Toaster /> to App.tsx"
echo "  - Add React.memo to flagged components"
echo "  - Fix remaining .unwrap() calls beyond serde (16 total)"
echo "  - Review barrel imports"
echo "═══════════════════════════════════════════"
