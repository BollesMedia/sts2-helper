-- Bump tier-list-images bucket size limit from 10MB to 25MB.
-- Matches the next.config proxyClientMaxBodySize and extract route
-- MAX_IMAGE_BYTES so large full-page tier list screenshots (typically
-- 10-20MB as uncompressed PNG) can be uploaded without re-encoding.

update storage.buckets
set file_size_limit = 26214400  -- 25 MB
where id = 'tier-list-images';
