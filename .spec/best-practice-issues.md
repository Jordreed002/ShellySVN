# Vercel React Best Practices - Issues Report

Generated: 2026-02-28
Updated: 2026-02-28 (All issues resolved)

This report identifies performance optimization opportunities based on Vercel's React best practices.

---

## Status Legend
✅ = Fixed | ⚠️ = Accepted as-is | ❌ = Not fixed

---

## CRITICAL Issues

### 1. Barrel Imports (`bundle-barrel-imports`) ⚠️

**Status:** Accepted - No actual usages found in codebase. The barrel file exists but imports are already direct.

---

### 2. Non-Primitive Default Props (`rerender-memo-with-default-value`) ✅

**Fixed:** Added module-level constants in multiple files:
- `VirtualizedList.tsx`: `EMPTY_SET` for Set defaults
- `FileRow.tsx`: `EMPTY_FOLDER_SIZES`, `EMPTY_ACTIONS`, `DEFAULT_COLUMN_WIDTHS`
- `useDragDrop.tsx`: `EMPTY_OPTIONS`
- `useOfflineCache.ts`: `EMPTY_PARTIAL_CONFIG`
- `useLazyLoading.ts`: `EMPTY_PARTIAL_CONFIG`
- `RepoBrowserContent.tsx`: `EMPTY_PROPS`

---

## HIGH Priority Issues

### 3. Missing Memoization for Derived State (`rerender-derived-state`) ✅

**Fixed:** Wrapped `activeTheme` in `useMemo` in `useThemes.ts`

---

### 4. Side Effect During Render (`rendering-no-side-effects`) ✅

**Fixed:** Moved `onLoadMore` call to `useEffect` in `VirtualizedList.tsx`

---

### 5. Redundant useEffect Dependencies (`rerender-dependencies`) ✅

**Fixed:** Changed effect to depend on `activeThemeId` directly in `useThemes.ts`

---

## MEDIUM Priority Issues

### 6. Inline Arrow Functions in Event Handlers (`rerender-inline-handlers`) ✅

**Fixed:**
- `RepoBrowser.tsx`: Added `useCallback` for `handleNavigate`, `handleBack`, `handleRefresh`
- `RepoBrowserContent.tsx`: Added stable callbacks for selection and dialog handlers

---

### 7. Inline Object Creation in Map Callbacks (`js-cache-property-access`) ⚠️

**Status:** Accepted - Pattern is inside React Query's `queryFn` which only runs on query execution, not every render. Data is cached appropriately.

---

### 8. useCallback with Empty Dependencies (`rerender-dependencies`) ⚠️

**Status:** Acceptable - These callbacks only call `window.api.store.set()` which is stable.

---

## LOW Priority Issues

### 9. Missing Dynamic Imports for Heavy Components (`bundle-dynamic-imports`) ✅

**Fixed:** Added lazy loading with `React.lazy()` and `Suspense` for:
- `CommitDialog`
- `DiffViewer`
- `LogViewer`
- `SettingsDialog`
- `UpdateToRevisionDialog`
- `ImageDiffViewer` (lazy loaded within DiffViewer)

---

### 10. Conditional Rendering with && (`rendering-conditional-render`) ✅

**Fixed:** Changed to ternary pattern in `RepoBrowser.tsx`

---

## Summary

| Priority | Total | Fixed | Accepted |
|----------|-------|-------|----------|
| CRITICAL | 2 | 1 | 1 |
| HIGH | 3 | 3 | 0 |
| MEDIUM | 3 | 1 | 2 |
| LOW | 2 | 2 | 0 |
| **Total** | **10** | **7** | **3** |
