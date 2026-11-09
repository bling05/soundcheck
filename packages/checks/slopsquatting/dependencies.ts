import type { RepoFile } from '../repo';
import { manifestDependencies, type Dependency } from './manifests';
import { findMentions } from './mentions';

/**
 * Every package the repo uses from npm or PyPI, once each: listed in a manifest, installed
 * by a command in its docs or scripts, or imported by its code. Places are kept per file.
 */
export function findDependencies(files: readonly RepoFile[]): Dependency[] {
  const listed = manifestDependencies(files);
  const key = ({ ecosystem, name }: { ecosystem: string; name: string }) =>
    `${ecosystem}:${name}`;
  const byKey = new Map(
    listed.map((dependency) => [key(dependency), dependency]),
  );
  const declaredNpm = new Set(
    listed
      .filter(({ ecosystem }) => ecosystem === 'npm')
      .map(({ name }) => name),
  );

  for (const mention of findMentions(files, declaredNpm)) {
    const { ecosystem, name, path, line, source, maybePrivate } = mention;
    const known = byKey.get(key(mention));
    if (!known) {
      byKey.set(key(mention), {
        ecosystem,
        name,
        places: [{ path, line, source }],
        maybePrivate,
      });
      continue;
    }
    if (!known.places.some((place) => place.path === path))
      known.places.push({ path, line, source });
    known.maybePrivate ||= maybePrivate;
  }
  return [...byKey.values()];
}
