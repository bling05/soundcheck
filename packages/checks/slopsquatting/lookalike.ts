import type { Ecosystem } from './manifests';
import { POPULAR_NPM, POPULAR_PYPI } from './popular';

const POPULAR: Record<Ecosystem, ReadonlySet<string>> = {
  npm: new Set(POPULAR_NPM),
  pypi: new Set(POPULAR_PYPI),
};
// Short names are a typo away from too many others, like `vue` and `vite`.
const MIN_LENGTH = 5;

/** One letter added, dropped, changed, or two neighbors swapped, like `reqeusts`. */
export function oneTypoApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const middleA = a.slice(start, endA + 1);
  const middleB = b.slice(start, endB + 1);
  if (middleA.length + middleB.length <= 1) return true;
  if (middleA.length === 1 && middleB.length === 1) return true;
  return (
    middleA.length === 2 &&
    middleB.length === 2 &&
    middleA[0] === middleB[1] &&
    middleA[1] === middleB[0]
  );
}

const withoutSeparators = (name: string) => name.replace(/[-_.]/g, '');

/**
 * The popular package `name` looks like a misspelling of, if any: one typo away, or the
 * same letters with the dashes left out, like `crossenv` for `cross-env`.
 */
export function lookalikeOf(
  ecosystem: Ecosystem,
  name: string,
): string | undefined {
  const popular = POPULAR[ecosystem];
  if (popular.has(name) || name.startsWith('@') || name.length < MIN_LENGTH)
    return undefined;
  const bare = withoutSeparators(name);
  for (const candidate of popular) {
    if (candidate.startsWith('@') || candidate.length < MIN_LENGTH) continue;
    if (withoutSeparators(candidate) === bare || oneTypoApart(name, candidate))
      return candidate;
  }
  return undefined;
}
