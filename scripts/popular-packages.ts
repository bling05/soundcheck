/**
 * Refreshes the list of most-downloaded npm and PyPI packages that Check #10 compares
 * names against to spot lookalikes, like `reqeusts` for `requests`. Run it now and then
 * with `npm run popular-packages`, and commit the result. Uses ecosyste.ms, a free index
 * of package registries.
 */
import { writeFile } from 'node:fs/promises';

const HOW_MANY = 3000;
const PER_PAGE = 1000;
const OUTPUT = 'packages/checks/slopsquatting/popular.ts';

async function topNames(registry: string): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; names.length < HOW_MANY; page++) {
    const url = `https://packages.ecosyste.ms/api/v1/registries/${registry}/packages?sort=downloads&order=desc&per_page=${PER_PAGE}&page=${page}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const batch = (await response.json()) as { name: string }[];
    if (batch.length === 0) break;
    names.push(...batch.map(({ name }) => name));
  }
  return names.slice(0, HOW_MANY);
}

const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');
const npm = await topNames('npmjs.org');
const pypi = [...new Set((await topNames('pypi.org')).map(normalize))];

const list = (names: string[]) =>
  `[\n${names.map((name) => `  ${JSON.stringify(name)},`).join('\n')}\n]`;
await writeFile(
  OUTPUT,
  `// Made by scripts/popular-packages.ts on ${new Date().toISOString().slice(0, 10)}. Don't edit by hand.\n\n` +
    `/** The ${npm.length} most-downloaded npm packages. */\n` +
    `export const POPULAR_NPM: readonly string[] = ${list(npm)};\n\n` +
    `/** The ${pypi.length} most-downloaded PyPI packages, names normalized. */\n` +
    `export const POPULAR_PYPI: readonly string[] = ${list(pypi)};\n`,
);
console.log(
  `Wrote ${npm.length} npm and ${pypi.length} PyPI names to ${OUTPUT}`,
);
