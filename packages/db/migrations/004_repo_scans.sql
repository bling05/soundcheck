-- Repo scans. A scan can now be of a site, a public GitHub repo, or both, so the site link
-- is optional. `repo` is stored like `github.com/you/app`.
alter table scans alter column url drop not null;
alter table scans add column repo text;
alter table scans add constraint scans_url_or_repo
  check (url is not null or repo is not null);
