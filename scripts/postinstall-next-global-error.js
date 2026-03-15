#!/usr/bin/env node
/**
 * Postinstall: apply Next.js patches to avoid "Cannot read properties of null (reading 'useContext')".
 * 1. Skip prerendering /_global-error (node_modules/next/dist/build/index.js).
 * 2. Disable segment explorer on server (node_modules/next/dist/server/app-render/entry-base.js) so GET / and other routes don't 500 in dev.
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

const entryBasePath = path.join(
  process.cwd(),
  'node_modules',
  'next',
  'dist',
  'server',
  'app-render',
  'entry-base.js'
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

// Patch 2: Disable segment explorer on server (avoids 500 in dev from useContext null)
const SEGMENT_EXPLORER_LOAD = `if (process.env.NODE_ENV === 'development') {
    const mod = require('../../next-devtools/userspace/app/segment-explorer-node');
    SegmentViewNode = mod.SegmentViewNode;
    SegmentViewStateNode = mod.SegmentViewStateNode;
}`;
const SEGMENT_EXPLORER_DISABLED = `// Disabled: segment explorer runs during SSR where useContext(SegmentStateContext) is null → 500
// if (process.env.NODE_ENV === 'development') {
//     const mod = require('../../next-devtools/userspace/app/segment-explorer-node');
//     SegmentViewNode = mod.SegmentViewNode;
//     SegmentViewStateNode = mod.SegmentViewStateNode;
// }`;

if (fs.existsSync(entryBasePath)) {
  let entryContent = fs.readFileSync(entryBasePath, 'utf8');
  if (!entryContent.includes('// Disabled: segment explorer')) {
    if (entryContent.includes(SEGMENT_EXPLORER_LOAD)) {
      entryContent = entryContent.replace(SEGMENT_EXPLORER_LOAD, SEGMENT_EXPLORER_DISABLED);
      fs.writeFileSync(entryBasePath, entryContent);
    }
  }
}
