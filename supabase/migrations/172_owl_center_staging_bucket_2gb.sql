-- Raise the Owl Center Sugar staging bucket size limit from 512MB to 2GB.
-- Large Sugar batches (PNG + JSON) regularly exceed 512MB; staging uses signed
-- direct uploads so the app server body limit is not the constraint here.
-- Keep in sync with OWL_CENTER_STAGED_ZIP_MAX_BYTES in
-- lib/owl-center/asset-staging-limits.ts.
--
-- NOTE: the per-bucket limit cannot exceed the project-wide storage upload limit.
-- Raise "Upload file size limit" under Storage → Settings to >= 2GB as well,
-- otherwise uploads above the global limit are still rejected at upload time.

UPDATE storage.buckets
SET file_size_limit = 2147483648 -- 2 * 1024 * 1024 * 1024
WHERE id = 'owl-center-asset-staging';
