#!/usr/bin/env node
/**
 * Postinstall: apply Next.js patches to avoid "Cannot read properties of null (reading 'useContext')".
 * 1. Skip prerendering /_global-error (node_modules/next/dist/build/index.js).
 *
 * Do not patch entry-base.js / SegmentViewNode: disabling it leaves a ()=>null stub in dev and strips the
 * entire layout tree (blank page + NEXT_MISSING_ROOT_TAGS). Replacing it with ad-hoc passthrough components
 * can also break RSC streaming. Use stock Next devtools SegmentViewNode.
 * Safe to run multiple times (idempotent).
 */
const fs = require('fs');
const path = require('path');

const nextBuildPath = path.join(
  process.cwd(),
  'node_modules',
  'next',
  'dist',
  'build',
  'index.js'
);

const FIX1 = {
  search: `sortedStaticPaths.forEach(([originalAppPath, routes])=>{
                                const appConfig = appDefaultConfigs.get(originalAppPath);`,
  insert: `sortedStaticPaths.forEach(([originalAppPath, routes])=>{
                                if (originalAppPath === _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY) return;
                                const appConfig = appDefaultConfigs.get(originalAppPath);`,
};

const FIX2 = {
  search: `sortedStaticPaths.forEach(([originalAppPath, prerenderedRoutes])=>{
                        var _pageInfos_get, _pageInfos_get1;
                        const page = appNormalizedPaths.get(originalAppPath);`,
  insert: `sortedStaticPaths.forEach(([originalAppPath, prerenderedRoutes])=>{
                        if (originalAppPath === _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY) return;
                        var _pageInfos_get, _pageInfos_get1;
                        const page = appNormalizedPaths.get(originalAppPath);`,
};

if (!fs.existsSync(nextBuildPath)) {
  process.exit(0);
}

let content = fs.readFileSync(nextBuildPath, 'utf8');
let changed = false;

if (!content.includes('UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY) return;')) {
  if (content.includes(FIX1.search)) {
    content = content.replace(FIX1.search, FIX1.insert);
    changed = true;
  }
  if (content.includes(FIX2.search)) {
    content = content.replace(FIX2.search, FIX2.insert);
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(nextBuildPath, content);
  }
}
