-- The checks the worker plans to run, as [{ "id": ..., "title": ... }], written before the
-- first one starts so the scan page can list them all while they run.
alter table scans add column checks jsonb not null default '[]';

-- Who asked for the scan, as a keyed hash of their IP address. The address itself is never
-- stored. Only used to count a visitor's recent scans.
alter table scans add column requester text;

-- For "how many scans has this visitor started in the last hour".
create index scans_requester on scans (requester, requested_at);

-- For "was this link scanned in the last few minutes".
create index scans_recent_url on scans (url, requested_at);
