import {
  findingId,
  sortBySeverity,
  type Finding,
  type ManualFix,
} from '@soundcheck/report';
import type { Check, CheckContext, CheckResult } from '../types';
import { findDependencies } from './dependencies';
import { lookalikeOf } from './lookalike';
import type { Dependency, PlaceSource } from './manifests';
import { findKnownMalware } from './osv';
import {
  inBatches,
  lookUp,
  REGISTRIES,
  type PackageStatus,
  type RegistryBases,
} from './registry';

const CHECK_ID = 'slopsquatting';
// A big monorepo can list hundreds. Past this, the lookups would outlast the check's time.
const MAX_PACKAGES = 400;
const AT_ONCE = 8;
const MAX_EVIDENCE_FILES = 5;

const REGISTRY_NAME = { npm: 'npm', pypi: 'PyPI' } as const;

type Problem = Exclude<PackageStatus, { kind: 'fine' } | { kind: 'unknown' }>;

interface Judged {
  dependency: Dependency;
  status: Problem;
  /** The popular package this name is a typo away from, for a "did you mean" hint. */
  similarTo: string | undefined;
}

function installCommands({ ecosystem, name }: Dependency) {
  return ecosystem === 'npm'
    ? { remove: `npm uninstall ${name}`, add: 'npm install <the-real-package>' }
    : {
        remove: `pip uninstall ${name}  # and delete it from your requirements`,
        add: 'pip install <the-real-package>',
      };
}

function titleFor({ dependency, status }: Judged): string {
  const { ecosystem, name, maybePrivate } = dependency;
  const registry = REGISTRY_NAME[ecosystem];
  switch (status.kind) {
    case 'missing':
      return maybePrivate
        ? `${name} isn't on the public ${registry} registry`
        : `${name} doesn't exist on ${registry}, so anyone could publish it`;
    case 'malware':
      return status.by === 'npm'
        ? `npm removed ${name} for containing malware`
        : `${name} is known malware`;
    case 'new':
      return status.installScript
        ? `${name} is brand new, barely used, and runs code when installed`
        : `${name} is brand new on ${registry} and barely used`;
    case 'lookalike':
      return `${name} looks like a misspelling of ${status.of}`;
  }
}

function severityFor({ dependency, status }: Judged): Finding['severity'] {
  switch (status.kind) {
    case 'malware':
      return 'critical';
    case 'missing':
      // A scoped or private-registry name is often a private package, not a made-up one.
      return dependency.maybePrivate || dependency.name.startsWith('@')
        ? 'medium'
        : 'high';
    case 'new':
      return status.installScript ? 'high' : 'medium';
    case 'lookalike':
      return 'medium';
  }
}

const WHERE: Record<PlaceSource, string> = {
  manifest: 'Listed here',
  'install-command': 'Installed by this command',
  import:
    'Imported here, but no package.json lists it, so whoever installs it adds it by name',
};

function statusSentence({ dependency, status, similarTo }: Judged): string {
  const registry = REGISTRY_NAME[dependency.ecosystem];
  const guess = similarTo ? ` Did you mean ${similarTo}?` : '';
  switch (status.kind) {
    case 'missing':
      return `${registry} has no package with this name.${guess}`;
    case 'malware':
      return status.by === 'npm'
        ? 'npm replaced this package with a placeholder after finding malware in it.'
        : `OSV, a public database of malicious packages, lists every version of it as malware (${status.advisory}).`;
    case 'new': {
      const age = status.daysOld === 0 ? 'today' : `${status.daysOld} days ago`;
      const script = status.installScript
        ? ' It also runs a script on your computer as soon as it is installed.'
        : '';
      return `It was first published ${age} and had ${status.weeklyDownloads} downloads last week.${script}${guess}`;
    }
    case 'lookalike':
      return `${status.of} is a popular package one typo away, and this one had only ${status.weeklyDownloads} downloads last week.`;
  }
}

function fixFor(judged: Judged): ManualFix {
  const { dependency, status, similarTo } = judged;
  const { remove, add } = installCommands(dependency);
  const registry = REGISTRY_NAME[dependency.ecosystem];
  const real =
    similarTo ?? (status.kind === 'lookalike' ? status.of : undefined);
  const replace = real
    ? `${remove}\n${add.replace('<the-real-package>', real)}`
    : `${remove}\n${add}`;
  const findReal = real
    ? `If you meant ${real}, switch to it everywhere this name is listed, installed, or imported.`
    : `Find the real package for what you need on ${registry}, check it has a real repo and plenty of users, and switch to it everywhere this name is listed, installed, or imported.`;
  switch (status.kind) {
    case 'missing':
      return {
        description: `${dependency.maybePrivate ? `If ${dependency.name} is your own private package, you can ignore this. Otherwise, w` : 'W'}ork out where the name came from: AI tools sometimes invent package names. ${findReal} Don't install the made-up name, because whoever publishes it first gets their code run on your computer.`,
        language: 'bash',
        snippet: replace,
      };
    case 'malware':
      return {
        description: `Remove ${dependency.name} now. ${findReal} If it was ever installed, assume every secret on that computer or build server was stolen, and replace them.`,
        language: 'bash',
        snippet: replace,
      };
    case 'new':
      return {
        description: `Open its page on ${registry} and check who published it, whether it links to a real repo with real history, and whether its name is close to a popular package.${status.installScript ? ' Be extra careful: it runs code as soon as it is installed.' : ''} If anything looks off, remove it. ${findReal}`,
        language: 'bash',
        snippet: `# If it doesn't check out:\n${replace}`,
      };
    case 'lookalike':
      return {
        description: `Check whether you meant ${status.of}. If so, switch to it, and treat any computer that installed ${dependency.name} with suspicion: lookalike names are a common way to spread malware.`,
        language: 'bash',
        snippet: replace,
      };
  }
}

function fixRequestFor({ dependency, status, similarTo }: Judged): string {
  const registry = REGISTRY_NAME[dependency.ecosystem];
  const where = [...new Set(dependency.places.map(({ path }) => path))].join(
    ', ',
  );
  const hint = similarTo ? ` It may be a typo for ${similarTo}.` : '';
  switch (status.kind) {
    case 'missing':
      return `My project uses ${dependency.name} in ${where}, but there's no package with that name on ${registry}, so it may be a made-up name.${hint} Don't install it. Find what the code uses it for, suggest the real, widely used package that does that, with a link to its ${registry} page, and switch to it everywhere. If ${dependency.name} looks like my own private package, tell me and change nothing.`;
    case 'malware':
      return `My project uses ${dependency.name} in ${where}, which is known malware. Remove it, find the real package it was imitating, and switch the code to that. Then remind me to replace every secret on any computer or build server that installed it.`;
    case 'new':
      return `My project uses ${dependency.name} in ${where}, which was published on ${registry} only recently and has very few users.${status.installScript ? ' It also runs a script when installed.' : ''}${hint} Tell me what the code uses it for and whether a well-known package does the same thing. Don't change anything until I decide.`;
    case 'lookalike':
      return `My project uses ${dependency.name} in ${where}, which looks like a misspelling of the popular package ${status.of}. Check whether the code expects ${status.of}, and if so, switch to it everywhere. Tell me what you changed.`;
  }
}

function findingFor(judged: Judged): Finding {
  const { dependency, status } = judged;
  const title = titleFor(judged);
  const sentence = statusSentence(judged);
  return {
    id: findingId(CHECK_ID, status.kind, dependency.ecosystem, dependency.name),
    checkId: CHECK_ID,
    title,
    severity: severityFor(judged),
    source: 'code',
    ...(status.kind === 'malware' && {
      safetyStep:
        'If this package was ever installed, on your computer or a build server, treat every key and password there as stolen: replace them.',
    }),
    evidence: dependency.places
      .slice(0, MAX_EVIDENCE_FILES)
      .map(({ path, line, source }) => ({
        kind: 'file',
        path,
        line,
        detail: `${WHERE[source]}. ${sentence}`,
      })),
    lessonId: `${CHECK_ID}:${status.kind}-package`,
    manualFix: fixFor(judged),
    aiFix: { problem: title, request: fixRequestFor(judged) },
  };
}

export interface SlopsquattingOptions {
  registries?: RegistryBases;
  /** For tests, so "new" means the same thing every run. */
  now?: () => number;
}

export function createSlopsquatting(options: SlopsquattingOptions = {}): Check {
  const registries = options.registries ?? REGISTRIES;
  const now = options.now ?? Date.now;

  async function run(context: CheckContext): Promise<CheckResult> {
    if (!context.repo) {
      return { status: 'skipped', reason: 'This check needs your repo.' };
    }
    const all = findDependencies(context.repo.files);
    if (all.length === 0) {
      return {
        status: 'skipped',
        reason:
          "We didn't find any npm or PyPI packages in your repo's package files, docs, or code.",
      };
    }
    const dependencies = all.slice(0, MAX_PACKAGES);
    const time = now();
    const similar = dependencies.map((dependency) =>
      lookalikeOf(dependency.ecosystem, dependency.name),
    );
    const lookups = await inBatches(
      dependencies.map((dependency, index) => ({ dependency, index })),
      AT_ONCE,
      ({ dependency, index }) =>
        lookUp(dependency, similar[index], context.fetch, registries, time),
    );
    const unknown = lookups.filter(
      ({ status }) => status.kind === 'unknown',
    ).length;
    if (unknown === dependencies.length) {
      return {
        status: 'skipped',
        reason:
          "The package registries didn't answer, so we couldn't check your packages.",
      };
    }
    const osv = await findKnownMalware(
      dependencies,
      (dependency) => {
        const lookup = lookups[dependencies.indexOf(dependency)];
        // A package the registry no longer has has no clean versions left.
        return lookup?.status.kind === 'missing' ? [] : lookup?.versions;
      },
      context.fetch,
      registries,
    );

    const findings = dependencies.flatMap((dependency, index) => {
      const advisory = osv.malware.get(dependency);
      const found = lookups[index]?.status;
      const status: PackageStatus | undefined =
        found?.kind === 'malware' || !advisory
          ? found
          : { kind: 'malware', by: 'osv', advisory };
      if (!status || status.kind === 'fine' || status.kind === 'unknown')
        return [];
      // A name that's only imported is never installed by itself, and generated files,
      // bundler aliases, and baseUrl imports look just like missing packages. So imports
      // only count when the package exists and looks wrong.
      const onlyImported = dependency.places.every(
        ({ source }) => source === 'import',
      );
      if (onlyImported && status.kind === 'missing') return [];
      return [findingFor({ dependency, status, similarTo: similar[index] })];
    });

    const unchecked = unknown + (all.length - dependencies.length);
    const notes = [
      unchecked > 0 &&
        `We couldn't check ${unchecked} of your ${all.length} packages, so there could be more we didn't see.`,
      !osv.answered &&
        "OSV.dev's malware database didn't answer, so packages still on the registry weren't checked against it.",
      !context.repo.complete &&
        "Some files in your repo were too big to read, so there could be packages we didn't see.",
    ].filter((note): note is string => typeof note === 'string');

    const result: CheckResult = {
      status: 'ran',
      findings: sortBySeverity(findings),
    };
    return notes.length > 0 ? { ...result, note: notes.join(' ') } : result;
  }

  return {
    id: CHECK_ID,
    title: 'Packages that may be made up',
    mode: 'repo',
    platforms: 'all',
    run,
  };
}

export const slopsquatting = createSlopsquatting();
