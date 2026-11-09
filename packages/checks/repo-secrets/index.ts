import {
  findingId,
  sortBySeverity,
  withUniqueIds,
  type Finding,
} from '@soundcheck/report';
import type { Check, CheckContext, CheckResult } from '../types';
import { GITIGNORE_SNIPPET, SECRET_CONTENT } from './content';
import {
  findCommittedSecrets,
  findEnvFiles,
  findIgnoreGap,
  type CommittedEnvFile,
  type CommittedSecret,
  type IgnoreGap,
} from './rules';

const CHECK_ID = 'repo-secrets';
const MAX_EVIDENCE_FILES = 5;
const MAX_NAMES_SHOWN = 5;

const HISTORY =
  "Deleting it from your code isn't enough: it stays in your repo's history, where anyone can still find it, and anyone who already copied it can keep using it.";

const PARTIAL_READ =
  "Some files in your repo were too big to read, so there could be more secrets we didn't see.";

function secretFinding({ rule, redacted, places }: CommittedSecret): Finding {
  const { title, severity, name, newKeyFrom, variable } = SECRET_CONTENT[rule];
  const first = places[0]?.path ?? 'your code';
  return {
    // The redacted key, so the same committed key keeps its id until it's replaced.
    id: findingId(CHECK_ID, rule, redacted),
    checkId: CHECK_ID,
    title,
    severity,
    source: 'code',
    safetyStep: `Replace this ${name} first: make a new one in ${newKeyFrom}, then delete the old one. ${HISTORY}`,
    evidence: places.slice(0, MAX_EVIDENCE_FILES).map(({ path, line }) => ({
      kind: 'file',
      path,
      line,
      detail: `Found a ${name} ending in ${redacted} here.`,
    })),
    lessonId: `${CHECK_ID}:${rule}`,
    manualFix: {
      description: `Do these in order. 1. Make a new ${name} in ${newKeyFrom}. 2. Remove the old one from your code, and have your code read the new one from an environment variable named ${variable}. 3. Put the new one in your hosting settings and in a .env file on your computer, and make sure .gitignore keeps .env files out of your repo. 4. Delete the old ${name}. ${HISTORY}`,
      language: 'ts',
      snippet: `// Read it from the environment, never from the code.\nconst value = process.env.${variable};\n\n// .gitignore\n${GITIGNORE_SNIPPET.replace(/^/gm, '// ')}`,
    },
    aiFix: {
      problem: `${title}, in ${first}. It ends in ${redacted}`,
      request: `Remove the ${name} from ${places.map(({ path }) => path).join(', ')} and read it from an environment variable named ${variable} instead. Don't print or repeat the key. Add a .env.example file listing ${variable} with no value, and make sure .gitignore keeps .env files out of the repo. Then remind me that I still need to make a new ${name} and delete the old one myself, because the old one is already public in my repo's history.`,
    },
  };
}

function envFileFinding({ path, line, names }: CommittedEnvFile): Finding {
  const shown = names.slice(0, MAX_NAMES_SHOWN).join(', ');
  const more =
    names.length > MAX_NAMES_SHOWN
      ? `, and ${names.length - MAX_NAMES_SHOWN} more`
      : '';
  return {
    id: findingId(CHECK_ID, 'env-file', path),
    checkId: CHECK_ID,
    title: 'A .env file with secret settings is in your public repo',
    severity: 'high',
    source: 'code',
    safetyStep: `Replace every secret this file sets, like ${shown}${more}: make a new one with each service, then delete the old one. ${HISTORY}`,
    evidence: [
      {
        kind: 'file',
        path,
        line,
        detail: `Sets ${shown}${more}. We didn't keep or show the values.`,
      },
    ],
    lessonId: `${CHECK_ID}:env-file`,
    manualFix: {
      description: `Do these in order. 1. Replace each secret in ${path} with a new one from its service, and delete the old ones. 2. Stop tracking the file with the command below, which keeps your copy on your computer. 3. Add .env files to .gitignore so this can't happen again. 4. Put the new values in your hosting settings. ${HISTORY}`,
      language: 'bash',
      snippet: `git rm --cached ${path}\n\n# Then add these lines to .gitignore:\n${GITIGNORE_SNIPPET.split('\n').slice(1).join('\n')}`,
    },
    aiFix: {
      problem: `${path} is committed to my public repo and sets secrets like ${shown}`,
      request: `Stop tracking ${path} in git without deleting my local copy, add .env files to .gitignore, and add a .env.example file listing the same settings with no values. Don't print or repeat any of the values. Then remind me that I still need to replace each secret it set, because they're already public in my repo's history.`,
    },
  };
}

function ignoreGapFinding(gap: IgnoreGap): Finding {
  const path = gap.kind === 'no-gitignore' ? '.gitignore' : gap.path;
  return {
    id: findingId(CHECK_ID, 'env-not-ignored'),
    checkId: CHECK_ID,
    title: "Your repo doesn't keep .env files out",
    severity: 'low',
    source: 'code',
    evidence: [
      {
        kind: 'file',
        path,
        detail:
          gap.kind === 'no-gitignore'
            ? 'Your code reads environment variables, but your repo has no .gitignore file, so a .env file would be committed with everything else.'
            : "Your code reads environment variables, but .gitignore doesn't mention .env, so a .env file would be committed with everything else.",
      },
    ],
    lessonId: `${CHECK_ID}:env-not-ignored`,
    manualFix: {
      description:
        'Add these lines to the .gitignore file at the top of your repo, or create it if there is none. The last line keeps .env.example, which lists setting names without values, so others know what to set.',
      language: 'text',
      snippet: GITIGNORE_SNIPPET,
    },
    aiFix: {
      problem: "My repo's .gitignore doesn't keep .env files out",
      request:
        'Add .env and .env.* to the .gitignore at the root of the repo, creating it if needed, but keep .env.example tracked. Check that no .env file is tracked in git right now, and tell me if one is.',
    },
  };
}

async function run(context: CheckContext): Promise<CheckResult> {
  if (!context.repo) {
    return { status: 'skipped', reason: 'This check needs your repo.' };
  }
  const { files, complete } = context.repo;
  const secrets = findCommittedSecrets(files);
  const envFiles = findEnvFiles(files);
  // A committed .env file already says to fix .gitignore.
  const gap = envFiles.length === 0 ? findIgnoreGap(files) : undefined;

  const findings = sortBySeverity(
    withUniqueIds([
      ...secrets.map(secretFinding),
      ...envFiles.map(envFileFinding),
      ...(gap ? [ignoreGapFinding(gap)] : []),
    ]),
  );
  return complete
    ? { status: 'ran', findings }
    : { status: 'ran', findings, note: PARTIAL_READ };
}

export const repoSecrets: Check = {
  id: CHECK_ID,
  title: 'Secrets committed to your repo',
  mode: 'repo',
  platforms: 'all',
  run,
};
