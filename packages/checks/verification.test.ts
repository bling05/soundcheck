import { afterEach, describe, expect, it } from 'vitest';
import { startFixture, type RunningFixture } from '../../fixtures/server';
import { testFetchFor } from './request-guard/test-fetch';
import {
  checkVerification,
  createVerificationSecret,
  fileHasCode,
  pageHasCode,
  VERIFICATION_FILE_PATH,
  verificationCode,
} from './verification';

const SECRET = 'test-secret';
const CODE = verificationCode(SECRET, 'my-app.com');

let site: RunningFixture;
afterEach(() => site?.stop());

describe('verificationCode', () => {
  it('is the same for the same secret and site, every time', () => {
    expect(verificationCode(SECRET, 'my-app.com')).toBe(CODE);
    expect(verificationCode(SECRET, 'My-App.com')).toBe(CODE);
  });

  it('is different for every site and every secret', () => {
    expect(verificationCode(SECRET, 'other-app.com')).not.toBe(CODE);
    expect(verificationCode('other-secret', 'my-app.com')).not.toBe(CODE);
  });

  it('never contains the secret', () => {
    const secret = createVerificationSecret();
    expect(verificationCode(secret, 'my-app.com')).not.toContain(secret);
  });
});

describe('pageHasCode', () => {
  it.each([
    `<meta name="soundcheck-verification" content="${CODE}">`,
    `<meta content='${CODE}' name='soundcheck-verification' />`,
    `<META NAME="Soundcheck-Verification" CONTENT=" ${CODE} ">`,
  ])('finds the code in %s', (tag) => {
    expect(pageHasCode(`<html><head>${tag}</head></html>`, CODE)).toBe(true);
  });

  it.each([
    [
      'a different code',
      `<meta name="soundcheck-verification" content="sc-nope">`,
    ],
    [
      'the code under another name',
      `<meta name="description" content="${CODE}">`,
    ],
    ['the code in page text', `<p>${CODE}</p>`],
    [
      'a code that only starts the same',
      `<meta name="soundcheck-verification" content="${CODE}x">`,
    ],
  ])('does not count %s', (_name, html) => {
    expect(pageHasCode(html, CODE)).toBe(false);
  });
});

describe('fileHasCode', () => {
  it('accepts the code alone, with or without a trailing newline', () => {
    expect(fileHasCode(`${CODE}\n`, CODE)).toBe(true);
    expect(fileHasCode(`${CODE} and more`, CODE)).toBe(false);
  });
});

describe('checkVerification', () => {
  const page = (head: string) => ({
    body: `<!doctype html><head>${head}</head><h1>Hi</h1>`,
  });

  async function verify(fixture: Parameters<typeof startFixture>[0]) {
    site = await startFixture(fixture);
    const hostname = new URL(site.url).hostname;
    const code = verificationCode(SECRET, hostname);
    return {
      code,
      check: () => checkVerification(site.url, code, testFetchFor(site)),
    };
  }

  it('finds a meta tag on the page', async () => {
    const code = verificationCode(SECRET, '127.0.0.1');
    site = await startFixture({
      '/': page(`<meta name="soundcheck-verification" content="${code}">`),
    });

    expect(await checkVerification(site.url, code, testFetchFor(site))).toEqual(
      { verified: true, method: 'meta-tag' },
    );
  });

  it('finds the verification file', async () => {
    const code = verificationCode(SECRET, '127.0.0.1');
    site = await startFixture({
      '/': page(''),
      [VERIFICATION_FILE_PATH]: { body: `${code}\n` },
    });

    expect(await checkVerification(site.url, code, testFetchFor(site))).toEqual(
      { verified: true, method: 'file' },
    );
  });

  it('says plainly when the code is missing', async () => {
    const { check } = await verify({ '/': page('') });

    expect(await check()).toMatchObject({
      verified: false,
      reason: 'not-found',
    });
  });

  it('does not count a site that shows its home page for every address', async () => {
    const { check } = await verify({ '/': page(''), '*': page('') });

    expect(await check()).toMatchObject({ verified: false });
  });

  it('says when the site can not be reached', async () => {
    site = await startFixture({});
    await site.stop();
    const result = await checkVerification(site.url, CODE, testFetchFor(site));
    site = await startFixture({});

    expect(result).toMatchObject({ verified: false, reason: 'unreachable' });
  });
});
