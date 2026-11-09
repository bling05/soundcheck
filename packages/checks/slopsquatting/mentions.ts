import { builtinModules } from 'node:module';
import type { RepoFile } from '../repo';
import {
  NPM_NAME,
  normalizePythonName,
  npmSettings,
  ownNpmNames,
  requirementName,
  type Ecosystem,
  type NpmSettings,
  type PlaceSource,
} from './manifests';

/** One package name found outside a manifest, at one place. */
export interface Mention {
  ecosystem: Ecosystem;
  name: string;
  path: string;
  line: number;
  source: Exclude<PlaceSource, 'manifest'>;
  maybePrivate: boolean;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

// Where people write install commands for others to copy or for machines to run.
const COMMAND_FILE =
  /\.(?:md|mdx|markdown|rst|txt|sh|bash|zsh|ps1|ya?ml)$|(?:^|\/)(?:Dockerfile[\w.-]*|Makefile|Procfile|Justfile)$/i;
// Everything after the command, up to the end of the shell command it's in.
const NPM_INSTALL =
  /\b(?:npm\s+(?:install|i|add)|yarn\s+(?:global\s+)?add|pnpm\s+(?:add|install|i)|bun\s+(?:add|install|i)|(?:npx|pnpx|bunx)(?=\s))[ \t]+([^\n`|;&)<>]*)/g;
const PIP_INSTALL =
  /\b(?:pip3?\s+install|python3?\s+-m\s+pip\s+install|py\s+-m\s+pip\s+install|uv\s+(?:pip\s+install|add)|poetry\s+add|pipx\s+install|pdm\s+add)[ \t]+([^\n`|;&)<>]*)/g;
// Flags followed by a value, which isn't a package.
// Not -w: npm's takes a workspace name, but pnpm's means the workspace root and takes none.
const NPM_VALUE_FLAGS = new Set([
  '--registry',
  '--prefix',
  '--workspace',
  '--tag',
  '-p',
  '--package',
]);
const PIP_VALUE_FLAGS = new Set([
  '-r',
  '--requirement',
  '-e',
  '--editable',
  '-i',
  '--index-url',
  '--extra-index-url',
  '-c',
  '--constraint',
  '-t',
  '--target',
  '-f',
  '--find-links',
  '--python',
]);
// Names docs use to mean "your package here".
const PLACEHOLDER_NAMES =
  /^(?:package|packages|pkg|package-name|package_name|packagename|your-package|my-package|some-package|module|module-name|name|foo|bar|baz|example|lib|library|dependency|dep|deps|\.+)$/i;

function argumentsOf(
  command: string,
  valueFlags: ReadonlySet<string>,
  firstOnly: boolean,
): string[] {
  const names: string[] = [];
  const tokens = command.trim().split(/\s+/);
  for (let index = 0; index < tokens.length; index++) {
    const token = (tokens[index] ?? '').replace(/^["']|["']$/g, '');
    if (!token || token === '\\') continue;
    if (token.startsWith('#')) break;
    if (token.startsWith('-')) {
      if (valueFlags.has(token)) index++;
      continue;
    }
    if (/[<>{}$*]/.test(token)) continue;
    names.push(token);
    // `npx tool arg`: only the first word is a package; the rest are the tool's arguments.
    if (firstOnly) break;
  }
  return names;
}

/** `react@19` or `@scope/pkg@^1` to the package name, or nothing for a path or link. */
function npmNameFrom(token: string): string | undefined {
  if (/^(?:\.|\/|~|https?:|git|file:|link:|npm:|github:)/.test(token))
    return undefined;
  const name = /^((?:@[^/@\s]+\/)?[^@\s]+)/.exec(token)?.[1];
  if (!name || !NPM_NAME.test(name) || PLACEHOLDER_NAMES.test(name))
    return undefined;
  if (name.includes('/') && !name.startsWith('@')) return undefined;
  return name;
}

function pythonNameFrom(token: string): string | undefined {
  if (/\/|\\|:\/\/|\.(?:whl|zip|tar\.gz)$|^\./.test(token)) return undefined;
  const name = requirementName(token);
  return name && !PLACEHOLDER_NAMES.test(name)
    ? normalizePythonName(name)
    : undefined;
}

function installCommands(
  file: RepoFile,
  settings: NpmSettings,
  own: ReadonlySet<string>,
): Mention[] {
  const mentions: Mention[] = [];
  const { path, text } = file;
  for (const match of text.matchAll(NPM_INSTALL)) {
    const runsOne = /^(?:npx|pnpx|bunx)/.test(match[0]);
    for (const token of argumentsOf(match[1] ?? '', NPM_VALUE_FLAGS, runsOne)) {
      const name = npmNameFrom(token);
      if (!name || own.has(name)) continue;
      const scope = name.startsWith('@')
        ? name.split('/')[0]?.toLowerCase()
        : undefined;
      mentions.push({
        ecosystem: 'npm',
        name,
        path,
        line: lineOf(text, match.index),
        source: 'install-command',
        maybePrivate:
          settings.customRegistry ||
          (scope !== undefined && settings.privateScopes.has(scope)),
      });
    }
  }
  for (const match of text.matchAll(PIP_INSTALL)) {
    for (const token of argumentsOf(match[1] ?? '', PIP_VALUE_FLAGS, false)) {
      const name = pythonNameFrom(token);
      if (!name) continue;
      mentions.push({
        ecosystem: 'pypi',
        name,
        path,
        line: lineOf(text, match.index),
        source: 'install-command',
        maybePrivate: /--(?:extra-)?index-url\b|\s-i\s/.test(match[0]),
      });
    }
  }
  return mentions;
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const IMPORT =
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"'\n]+)["']|\bexport\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s+["']([^"'\n]+)["']|\b(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
const BUILTINS = new Set(builtinModules);

/** Path aliases from tsconfig or jsconfig, like `@components/` or `utils/`. */
function aliasPrefixes(files: readonly RepoFile[]): string[] {
  const prefixes: string[] = [];
  for (const { path, text } of files) {
    if (!/(?:^|\/)(?:ts|js)config[\w.-]*\.json$/.test(path)) continue;
    const paths = /"paths"\s*:\s*\{([^}]*)\}/.exec(text)?.[1] ?? '';
    for (const key of paths.matchAll(/"([^"]+)"\s*:/g)) {
      const prefix = (key[1] ?? '').replace(/\*.*$/, '');
      if (prefix) prefixes.push(prefix);
    }
  }
  return prefixes;
}

/** Folder and file names in the repo, which `baseUrl` lets code import by bare name. */
function localNames(files: readonly RepoFile[]): Set<string> {
  const names = new Set<string>();
  for (const { path } of files) {
    for (const part of path.split('/')) {
      names.add(part);
      names.add(part.replace(/\.[^.]+$/, ''));
    }
  }
  return names;
}

function packageOf(specifier: string): string | undefined {
  if (/^(?:\.|\/|#|~|\$|@\/|[a-z]+:)/i.test(specifier)) {
    // Deno-style `npm:pkg@1` still names an npm package.
    const npm = /^npm:((?:@[^/@]+\/)?[^/@]+)/.exec(specifier)?.[1];
    return npm;
  }
  const parts = specifier.split('/');
  const name = specifier.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : parts[0];
  return name && NPM_NAME.test(name) ? name : undefined;
}

/**
 * Packages the code imports that no package.json lists. Only for projects with a
 * package.json, since others may load packages from a CDN or an import map.
 */
function undeclaredImports(
  files: readonly RepoFile[],
  declared: ReadonlySet<string>,
  settings: NpmSettings,
  own: ReadonlySet<string>,
): Mention[] {
  if (
    !files.some(
      ({ path }) => path === 'package.json' || path.endsWith('/package.json'),
    )
  )
    return [];
  const aliases = aliasPrefixes(files);
  const local = localNames(files);
  const mentions: Mention[] = [];
  for (const { path, text } of files) {
    if (!CODE_FILE.test(path) || path.endsWith('.d.ts')) continue;
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? '';
      const name = packageOf(specifier);
      if (
        !name ||
        declared.has(name) ||
        own.has(name) ||
        BUILTINS.has(name) ||
        BUILTINS.has(specifier) ||
        aliases.some((prefix) => specifier.startsWith(prefix)) ||
        local.has(name.split('/')[0] ?? name)
      )
        continue;
      const scope = name.startsWith('@')
        ? name.split('/')[0]?.toLowerCase()
        : undefined;
      mentions.push({
        ecosystem: 'npm',
        name,
        path,
        line: lineOf(text, match.index),
        source: 'import',
        maybePrivate:
          settings.customRegistry ||
          (scope !== undefined && settings.privateScopes.has(scope)),
      });
    }
  }
  return mentions;
}

/** Package names in install commands, and imports of packages no package.json lists. */
export function findMentions(
  files: readonly RepoFile[],
  declaredNpm: ReadonlySet<string>,
): Mention[] {
  const settings = npmSettings(files);
  const own = ownNpmNames(files);
  return [
    ...files.flatMap((file) =>
      COMMAND_FILE.test(file.path) ? installCommands(file, settings, own) : [],
    ),
    ...undeclaredImports(files, declaredNpm, settings, own),
  ];
}
