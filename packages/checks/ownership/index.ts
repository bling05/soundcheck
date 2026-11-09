import {
  findingId,
  sortBySeverity,
  type Finding,
  type ManualFix,
} from '@soundcheck/report';
import type { Check, CheckContext, CheckResult } from '../types';
import { findJavaScriptProblems } from './javascript';
import { findDjangoProblems } from './python';
import type { RouteProblem } from './types';

const CHECK_ID = 'ownership-checks';

/** `RecipeTag` or `recipe_tags` as plain words, like `recipe tags`. */
export function plainName(thing: string): string {
  const words = thing
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return words.endsWith('s') ? words : `${words}s`;
}

function titleFor({ thing: raw, write }: RouteProblem): string {
  const thing = plainName(raw);
  return write
    ? `Anyone signed in may be able to change or delete other people's ${thing}`
    : `Anyone signed in may be able to see other people's ${thing}`;
}

function detailFor({ route, write }: RouteProblem): string {
  return `${route} ${write ? 'changes or deletes' : 'loads'} a record using the id in the request, and nothing in it checks that the record belongs to the person asking.`;
}

function fixFor({ framework, thing }: RouteProblem): ManualFix {
  switch (framework) {
    case 'django':
      return {
        description:
          "Only look up records that belong to the signed-in user, so someone else's id finds nothing. For a generic view, filter the queryset in get_queryset.",
        language: 'python',
        snippet: `# Hand-written view: add the owner to the lookup.\nrecord = get_object_or_404(${thing}, pk=pk, user=request.user)\n\n# Generic view: only the user's own records can be found.\ndef get_queryset(self):\n    return ${thing}.objects.filter(user=self.request.user)`,
      };
    case 'nextjs':
      return {
        description:
          "Get the signed-in user from your auth library, return 401 if there isn't one, and include their id in the lookup, so someone else's id finds nothing. Change userId to your owner column.",
        language: 'ts',
        snippet: `const session = await auth();\nif (!session?.user) return new Response('Unauthorized', { status: 401 });\n\nconst record = await db.${thing}.findFirst({\n  where: { id, userId: session.user.id },\n});\nif (!record) return new Response('Not found', { status: 404 });`,
      };
    case 'express':
      return {
        description:
          "Require a signed-in user on this route, then include their id in the lookup, so someone else's id finds nothing. Change userId to your owner column.",
        language: 'ts',
        snippet: `router.get('/${thing}/:id', requireAuth, async (req, res) => {\n  const record = await ${thing}.findOne({ _id: req.params.id, userId: req.user.id });\n  if (!record) return res.sendStatus(404);\n  res.json(record);\n});`,
      };
  }
}

function fixRequestFor({ route, thing, place }: RouteProblem): string {
  return `In ${place.path}, ${route} loads a ${thing} by the id in the request without checking it belongs to the signed-in user. Make it require a signed-in user and include their id in the lookup, so asking for someone else's id returns not found. Then check every other route that takes an id from the request for the same problem, and tell me which ones you changed. If this ${thing} is meant to be visible to everyone, tell me and change nothing.`;
}

async function run(context: CheckContext): Promise<CheckResult> {
  if (!context.repo) {
    return { status: 'skipped', reason: 'This check needs your repo.' };
  }
  const { files } = context.repo;
  const problems = [
    ...findDjangoProblems(files),
    ...findJavaScriptProblems(files),
  ];
  const findings = problems.map((problem): Finding => {
    const title = titleFor(problem);
    return {
      id: findingId(CHECK_ID, problem.place.path, problem.route),
      checkId: CHECK_ID,
      title,
      // Read from code alone, so it's a strong sign rather than proof.
      severity: 'high',
      source: 'code',
      evidence: [
        {
          kind: 'file',
          path: problem.place.path,
          line: problem.place.line,
          detail: detailFor(problem),
        },
      ],
      lessonId: `${CHECK_ID}:missing-owner-check`,
      manualFix: fixFor(problem),
      aiFix: { problem: title, request: fixRequestFor(problem) },
    };
  });
  const result: CheckResult = {
    status: 'ran',
    findings: sortBySeverity(findings),
  };
  return context.repo.complete
    ? result
    : {
        ...result,
        note: "Some files in your repo were too big to read, so there could be routes we didn't see.",
      };
}

export const ownershipChecks: Check = {
  id: CHECK_ID,
  title: 'Missing ownership checks in your code',
  mode: 'repo',
  platforms: 'all',
  run,
};
