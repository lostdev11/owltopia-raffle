#!/usr/bin/env node
/**
 * Postinstall: skip prerendering /_global-error in Next.js so the build doesn't
 * fail with "Cannot read properties of null (reading 'useContext')".
 * Applies two one-line edits to node_modules/next/dist/build/index.js.
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
