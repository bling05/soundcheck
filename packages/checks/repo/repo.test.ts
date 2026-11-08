import { afterEach, describe, expect, it } from 'vitest';
import { repoArchive } from '../../../fixtures/repo';
import { startFixture, type RunningFixture } from '../../../fixtures/server';
import { testFetchFor } from '../request-guard/test-fetch';
import { downloadRepo, filesFromArchive, technologiesInRepo } from './index';
import { readTar } from './tar';

let site: RunningFixture;
afterEach(() => site?.stop());

const REPO = { owner: 'you', name: 'app' };

async function githubServing(archive: Buffer | undefined, status = 200) {
  site = await startFixture({
    '/you/app/tar.gz/HEAD': archive
      ? { status, body: archive }
      : { status: 404, body: '404: Not Found' },
  });
  return downloadRepo(REPO, testFetchFor(site), site.url.slice(0, -1));
}

describe('downloadRepo', () => {
  it("reads a repo's text files, relative to its root", async () => {
    const result = await githubServing(
      repoArchive({
        'package.json': '{"name":"app"}',
        'supabase/migrations/001_init.sql': 'create table profiles ();',
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        repo: REPO,
        complete: true,
        files: [
          { path: 'package.json', text: '{"name":"app"}' },
          {
            path: 'supabase/migrations/001_init.sql',
            text: 'create table profiles ();',
          },
        ],
      },
    });
  });

  it('says a missing or private repo can’t be found', async () => {
    expect(await githubServing(undefined)).toMatchObject({
      ok: false,
      message: expect.stringContaining('only public repos'),
    });
  });

  it('refuses something that isn’t an archive', async () => {
    expect(await githubServing(Buffer.from('<html>oops</html>'))).toMatchObject(
      {
        ok: false,
        message: expect.stringContaining("couldn't read"),
      },
    );
  });
});

describe('filesFromArchive', () => {
  it('leaves out installed and built code, and binary files', async () => {
    const { files } = await filesFromArchive(
      repoArchive({
        'src/app.ts': 'export {}',
        'node_modules/left-pad/index.js': 'module.exports = 1',
        'apps/web/.next/server/page.js': 'built',
        'dist/bundle.js': 'built',
        'public/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
      }),
    );

    expect(files.map(({ path }) => path)).toEqual(['src/app.ts']);
  });

  it('skips code files too big to read, and says the read was partial', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    const result = await filesFromArchive(
      repoArchive({ 'small.ts': 'ok', 'huge.sql': big }),
    );

    expect(result.files.map(({ path }) => path)).toEqual(['small.ts']);
    expect(result.filesSkipped).toBe(1);
  });

  it('reads long paths, stored the way GitHub stores them', async () => {
    const deep = `${'folder/'.repeat(40)}file.ts`;

    expect(
      (await filesFromArchive(repoArchive({ [deep]: 'deep' }))).files[0]?.path,
    ).toBe(deep);
  });
});

describe('data-heavy repos', () => {
  it('skips big data files quietly, without calling the scan incomplete', async () => {
    const csv = 'id,name\n'.repeat(200_000);
    const result = await filesFromArchive(
      repoArchive({
        'app/views.py': 'def index(): pass',
        'scraping/recipes.csv': csv,
        'scraping/sitemaps/sitemap1.txt': csv,
        'package-lock.json': '{}'.padEnd(2 * 1024 * 1024, ' '),
      }),
    );

    expect(result.files.map(({ path }) => path)).toEqual(['app/views.py']);
    expect(result.filesSkipped).toBe(0);
  });
});

describe('readTar', () => {
  it('stops at the end of a broken archive instead of reading past it', () => {
    const cutOff = Buffer.alloc(512);
    cutOff.write('file.txt', 0);
    cutOff.write('00000001000\0', 124);
    cutOff.write('0', 156);

    expect(readTar(cutOff)).toEqual([]);
  });
});

describe('technologiesInRepo', () => {
  it('reads what the app is built with from every package.json', () => {
    expect(
      technologiesInRepo([
        {
          path: 'package.json',
          text: '{"devDependencies":{"vite":"6"},"dependencies":{"@supabase/supabase-js":"2"}}',
        },
        {
          path: 'apps/web/package.json',
          text: '{"dependencies":{"next":"16"}}',
        },
        { path: 'broken/package.json', text: '{nope' },
      ]),
    ).toEqual(['supabase', 'nextjs', 'vite']);
  });
});
