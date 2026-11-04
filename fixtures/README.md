# Fixtures

Deliberately vulnerable demo apps used to test checks. Every check needs one case that triggers it and one case that passes cleanly.

Never put real credentials here. Use obviously fake values, because fixtures are public and secret scanners will read them.

## Adding a case

A fixture is a fake website written as plain data: each path maps to the response it sends. Add a file named after the check that exports one site with the problem and one without it. See `security-headers.ts`.

In a test, start the site with `startFixture` from `server.ts` and hand the check `testFetchFor(site)`, which can only reach that site. Stop the site when the test ends. The real guard refuses to visit fixtures because they run on this machine, so don't use `guardedFetch` to reach them.
