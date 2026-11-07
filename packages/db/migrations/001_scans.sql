-- One row per scan. It's also the queue: the worker picks up rows that are still queued.
create table scans (
  id uuid primary key default gen_random_uuid(),
  -- The link to scan, without its query string or #fragment.
  url text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  -- The finished ScanReport. Findings are already redacted. Page contents are never stored.
  report jsonb,
  -- Why a scan failed, in words a user can read.
  failure text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Lets the worker find the oldest waiting scan without reading every row.
create index scans_queued on scans (requested_at) where status = 'queued';
