import type { RepoFile } from '../repo';
import { tableKind } from '../supabase-rls/rules';
import type { RouteProblem } from './types';

interface Block {
  name: string;
  /** For classes, what they inherit from. For functions, their parameters. */
  head: string;
  body: string;
  line: number;
  indent: number;
}

/** Top-level classes, or methods inside a class body, found by indentation. */
function blocksIn(
  lines: readonly string[],
  keyword: 'class' | 'def',
  start = 0,
  end = lines.length,
  indent = 0,
): Block[] {
  const blocks: Block[] = [];
  const pattern = new RegExp(
    `^(\\s{${indent}})(?:async\\s+)?${keyword}\\s+(\\w+)\\s*\\(([^)]*)\\)?`,
  );
  for (let index = start; index < end; index++) {
    const match = pattern.exec(lines[index] ?? '');
    if (!match || (match[1]?.length ?? 0) !== indent) continue;
    let stop = index + 1;
    while (stop < end) {
      const next = lines[stop] ?? '';
      if (
        next.trim() !== '' &&
        next.search(/\S/) <= indent &&
        !next.trim().startsWith('#')
      )
        break;
      stop++;
    }
    blocks.push({
      name: match[2] ?? '',
      head: match[3] ?? '',
      body: lines.slice(index + 1, stop).join('\n'),
      line: index + 1,
      indent,
    });
  }
  return blocks;
}

/** Any sign the code ties a record to the person asking. */
const OWNERSHIP =
  /request\.user|self\.request\.user|has_object_permission|IsOwner|IsAuthor|IsSelf|IsAdminUser|owner|get_queryset/;

// Views that load one record by its id from the address.
const DETAIL_BASES =
  /\b(Retrieve|Update|Destroy|RetrieveUpdate|RetrieveDestroy|RetrieveUpdateDestroy)APIView\b|\b(ModelViewSet|ReadOnlyModelViewSet)\b/;
const QUERYSET = /^\s*queryset\s*=\s*(\w+)\.objects\.all\(\)/m;
const LOOKUP =
  /(\w+)\.objects\.(?:get|filter|select_for_update)\(|get_object_or_404\(\s*(\w+)/;
const WRITE_METHODS = new Set(['put', 'patch', 'delete', 'post']);

function modelKind(model: string) {
  return tableKind(model.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());
}

/** The parameters a view takes from the address, after `self` and `request`. */
function addressParams(head: string): string[] {
  return head
    .split(',')
    .map((part) => part.trim().split(/[:=\s]/)[0] ?? '')
    .filter(
      (name) =>
        name && name !== 'self' && name !== 'request' && !name.startsWith('*'),
    );
}

/** Finds a lookup by one of `params` that nothing ties to the signed-in user. */
function unownedLookup(
  body: string,
  params: readonly string[],
): { model: string; offset: number } | undefined {
  if (OWNERSHIP.test(body)) return undefined;
  const lines = body.split('\n');
  for (const [offset, line] of lines.entries()) {
    const lookup = LOOKUP.exec(line);
    const model = lookup?.[1] ?? lookup?.[2];
    if (!model) continue;
    if (
      params.some((param) =>
        new RegExp(`\\b${param}\\b`).test(line.slice(lookup?.index ?? 0)),
      )
    ) {
      return { model, offset };
    }
  }
  return undefined;
}

/** Django and Django REST Framework views that load a record by id without checking its owner. */
export function findDjangoProblems(files: readonly RepoFile[]): RouteProblem[] {
  const problems: RouteProblem[] = [];
  for (const { path, text } of files) {
    if (
      !path.endsWith('.py') ||
      !/\bfrom (?:django|rest_framework)\b|\bimport (?:django|rest_framework)\b/.test(
        text,
      )
    )
      continue;
    const lines = text.split('\n');

    for (const cls of blocksIn(lines, 'class')) {
      // Generic detail views: the record comes from `queryset`, by the id in the address.
      const queryset = QUERYSET.exec(cls.body)?.[1];
      if (
        queryset &&
        DETAIL_BASES.test(cls.head) &&
        !OWNERSHIP.test(cls.body) &&
        modelKind(queryset) === 'personal'
      ) {
        problems.push({
          framework: 'django',
          route: cls.name,
          thing: queryset,
          write: /Update|Destroy|ModelViewSet$/.test(cls.head),
          place: { path, line: cls.line },
        });
        continue;
      }
      // Hand-written methods, like `def delete(self, request, pk)`.
      const start = cls.line;
      const end = start + cls.body.split('\n').length;
      const methodIndent = /\n(\s+)\S/.exec(`\n${cls.body}`)?.[1]?.length ?? 4;
      for (const method of blocksIn(lines, 'def', start, end, methodIndent)) {
        if (!['get', 'put', 'patch', 'delete', 'post'].includes(method.name))
          continue;
        const params = addressParams(method.head);
        if (params.length === 0) continue;
        const found = unownedLookup(method.body, params);
        if (!found) continue;
        const write = WRITE_METHODS.has(method.name);
        if (!write && modelKind(found.model) !== 'personal') continue;
        problems.push({
          framework: 'django',
          route: `${cls.name}.${method.name}`,
          thing: found.model,
          write,
          place: { path, line: method.line + 1 + found.offset },
        });
      }
    }

    // Function views, like `def recipe_detail(request, pk)`.
    for (const fn of blocksIn(lines, 'def')) {
      if (!/^\s*request\b/.test(fn.head)) continue;
      const params = addressParams(fn.head);
      if (params.length === 0) continue;
      const found = unownedLookup(fn.body, params);
      if (!found) continue;
      const write = /\.(?:delete|save|update)\(/.test(fn.body);
      if (!write && modelKind(found.model) !== 'personal') continue;
      problems.push({
        framework: 'django',
        route: fn.name,
        thing: found.model,
        write,
        place: { path, line: fn.line + 1 + found.offset },
      });
    }
  }
  return problems;
}
