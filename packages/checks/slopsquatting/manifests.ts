import type { RepoFile } from '../repo';

export type Ecosystem = 'npm' | 'pypi';

/** How the repo uses the package: lists it, installs it in a command, or imports it. */
export type PlaceSource = 'manifest' | 'install-command' | 'import';

export interface Place {
  path: string;
  line: number;
  source: PlaceSource;
}

export interface Dependency {
  ecosystem: Ecosystem;
  /** As the registry knows it: npm names as written, PyPI names normalized. */
  name: string;
  /** Every file and line that lists it. */
  places: Place[];
  /**
   * True when the project says it installs from somewhere other than the public registry
   * for this name, so not finding it there doesn't mean it doesn't exist.
   */
  maybePrivate: boolean;
}

function lineWhere(text: string, pattern: RegExp): number {
  const index = text.split('\n').findIndex((row) => pattern.test(row));
  return index === -1 ? 1 : index + 1;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export const NPM_NAME =
  /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;
// Versions that don't come from the npm registry: local folders, workspaces, git, links.
const NOT_FROM_REGISTRY =
  /^(?:workspace:|file:|link:|portal:|patch:|exec:|git\+|git:|github:|gitlab:|bitbucket:|https?:|\.{0,2}\/|~\/)/;
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export interface NpmSettings {
  /** The whole project installs from another registry. */
  customRegistry: boolean;
  /** Scopes, like `@acme`, that install from another registry. */
  privateScopes: Set<string>;
}

/** Reads `.npmrc` files for registries other than the public one. */
export function npmSettings(files: readonly RepoFile[]): NpmSettings {
  const settings: NpmSettings = {
    customRegistry: false,
    privateScopes: new Set(),
  };
  for (const { path, text } of files) {
    if (path !== '.npmrc' && !path.endsWith('/.npmrc')) continue;
    for (const row of text.split('\n')) {
      const scoped = /^\s*(@[\w.~-]+):registry\s*=/.exec(row);
      if (scoped?.[1]) settings.privateScopes.add(scoped[1].toLowerCase());
      else if (
        /^\s*registry\s*=/.test(row) &&
        !/registry\.npmjs\.org/.test(row)
      )
        settings.customRegistry = true;
    }
  }
  return settings;
}

function isManifest(path: string, name: string): boolean {
  return path === name || path.endsWith(`/${name}`);
}

/** The npm package a version spec installs. `npm:real@^1` is an alias for `real`. */
function npmTarget(name: string, spec: unknown): string | undefined {
  if (typeof spec !== 'string') return name;
  if (NOT_FROM_REGISTRY.test(spec)) return undefined;
  const alias = /^npm:((?:@[^/@]+\/)?[^@]+)/.exec(spec);
  if (alias?.[1]) return alias[1];
  // `user/repo` is a GitHub shorthand. Version ranges never contain a slash.
  if (spec.includes('/')) return undefined;
  return name;
}

function npmDependencies(files: readonly RepoFile[]): Dependency[] {
  const settings = npmSettings(files);
  const manifests: {
    path: string;
    text: string;
    json: Record<string, unknown>;
  }[] = [];
  for (const { path, text } of files) {
    if (!isManifest(path, 'package.json')) continue;
    try {
      const json: unknown = JSON.parse(text);
      if (typeof json === 'object' && json !== null)
        manifests.push({ path, text, json: json as Record<string, unknown> });
    } catch {
      // Not valid JSON, so npm couldn't read it either.
    }
  }
  // Packages that live in this repo, like workspaces, aren't fetched from the registry.
  const own = new Set(
    manifests.flatMap(({ json }) =>
      typeof json.name === 'string' ? [json.name] : [],
    ),
  );

  const byName = new Map<string, Dependency>();
  for (const { path, text, json } of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      const listed = json[field];
      if (typeof listed !== 'object' || listed === null) continue;
      for (const [written, spec] of Object.entries(listed)) {
        const name = npmTarget(written, spec);
        if (!name || own.has(name) || !NPM_NAME.test(name)) continue;
        const scope = name.startsWith('@')
          ? name.split('/')[0]?.toLowerCase()
          : undefined;
        const place: Place = {
          path,
          line: lineWhere(text, new RegExp(`^\\s*"${escape(written)}"\\s*:`)),
          source: 'manifest',
        };
        const known = byName.get(name);
        if (known) {
          if (!known.places.some((p) => p.path === path))
            known.places.push(place);
          continue;
        }
        byName.set(name, {
          ecosystem: 'npm',
          name,
          places: [place],
          maybePrivate:
            settings.customRegistry ||
            (scope !== undefined && settings.privateScopes.has(scope)),
        });
      }
    }
  }
  return [...byName.values()];
}

/** PyPI treats `Foo_Bar`, `foo-bar`, and `foo.bar` as the same name. */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

// The name at the start of a requirement, like `requests` in `requests[socks]>=2.0`.
const REQUIREMENT_NAME =
  /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:\[[^\]]*\])?\s*(.*)$/;
const REQUIREMENTS_FILE = /(?:^|\/)requirements[\w.-]*\.(?:txt|in)$/;
const CUSTOM_INDEX = /^\s*(?:-i\b|--index-url\b|--extra-index-url\b)/m;

export function requirementName(requirement: string): string | undefined {
  const match = REQUIREMENT_NAME.exec(requirement.trim());
  if (!match?.[1]) return undefined;
  // `name @ https://...` installs from a link, not from PyPI.
  if (/^@/.test(match[2]?.trim() ?? '')) return undefined;
  return match[1];
}

interface PythonListing {
  path: string;
  written: string;
  line: number;
  maybePrivate: boolean;
}

function requirementsListings({ path, text }: RepoFile): PythonListing[] {
  const maybePrivate = CUSTOM_INDEX.test(text);
  const listings: PythonListing[] = [];
  for (const [index, raw] of text.split('\n').entries()) {
    const row = raw.replace(/\s+#.*$/, '').trim();
    if (
      !row ||
      row.startsWith('#') ||
      row.startsWith('-') ||
      row.includes('://')
    )
      continue;
    const written = requirementName(row);
    if (written)
      listings.push({ path, written, line: index + 1, maybePrivate });
  }
  return listings;
}

function pyprojectListings({ path, text }: RepoFile): PythonListing[] {
  const listings: PythonListing[] = [];
  const own = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1];
  const rows = text.split('\n');
  let section = '';
  let inList = false;
  for (const [index, row] of rows.entries()) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(row);
    if (header) {
      section = header[1] ?? '';
      inList = false;
      continue;
    }
    // PEP 621: `dependencies = ["requests>=2", ...]` under [project].
    if (section === 'project' && /^\s*dependencies\s*=\s*\[/.test(row))
      inList = true;
    if (inList) {
      for (const quoted of row.matchAll(/["']([^"']+)["']/g)) {
        const written = requirementName(quoted[1] ?? '');
        if (written)
          listings.push({
            path,
            written,
            line: index + 1,
            maybePrivate: false,
          });
      }
      // The list ends at a `]` outside quotes. `requests[socks]` has brackets inside them.
      const bare = row.replace(/(["'])(?:(?!\1).)*\1/g, '');
      if (bare.includes(']')) inList = false;
      continue;
    }
    // Poetry: `requests = "^2.0"` under [tool.poetry.dependencies] or a group.
    if (
      /^tool\.poetry\.(?:group\.[\w-]+\.)?(?:dev-)?dependencies$/.test(section)
    ) {
      const key = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(row)?.[1];
      if (
        key &&
        key.toLowerCase() !== 'python' &&
        !/\b(?:path|git|url)\s*=/.test(row)
      )
        listings.push({
          path,
          written: key,
          line: index + 1,
          maybePrivate: false,
        });
    }
  }
  return own
    ? listings.filter(
        ({ written }) =>
          normalizePythonName(written) !== normalizePythonName(own),
      )
    : listings;
}

function pythonDependencies(files: readonly RepoFile[]): Dependency[] {
  const listings = files.flatMap((file) =>
    REQUIREMENTS_FILE.test(file.path)
      ? requirementsListings(file)
      : isManifest(file.path, 'pyproject.toml')
        ? pyprojectListings(file)
        : [],
  );
  const byName = new Map<string, Dependency>();
  for (const { path, written, line, maybePrivate } of listings) {
    const name = normalizePythonName(written);
    const known = byName.get(name);
    if (known) {
      if (!known.places.some((p) => p.path === path))
        known.places.push({ path, line, source: 'manifest' });
      known.maybePrivate ||= maybePrivate;
    } else {
      byName.set(name, {
        ecosystem: 'pypi',
        name,
        places: [{ path, line, source: 'manifest' }],
        maybePrivate,
      });
    }
  }
  return [...byName.values()];
}

/** Every package the repo's package.json, requirements, and pyproject.toml files list. */
export function manifestDependencies(files: readonly RepoFile[]): Dependency[] {
  return [...npmDependencies(files), ...pythonDependencies(files)];
}

/** Names of the packages that live in this repo, like workspaces. */
export function ownNpmNames(files: readonly RepoFile[]): Set<string> {
  const names = new Set<string>();
  for (const { path, text } of files) {
    if (!isManifest(path, 'package.json')) continue;
    try {
      const name: unknown = (JSON.parse(text) as { name?: unknown }).name;
      if (typeof name === 'string') names.add(name);
    } catch {
      // Not valid JSON, so it names nothing.
    }
  }
  return names;
}
