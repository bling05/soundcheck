-- Scans started by someone who may own the site, holding a verification secret. They can
-- include database results, so they're never reused for another visitor who scans the
-- same link.
alter table scans add column private boolean not null default false;
