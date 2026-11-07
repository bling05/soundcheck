import { describe, expect, it } from 'vitest';
import { parseScanUrl } from './scan-url';

describe('parseScanUrl', () => {
  it.each([
    ['https://my-app.lovable.app', 'https://my-app.lovable.app/'],
    ['my-app.com', 'https://my-app.com/'],
    ['  my-app.com/pricing  ', 'https://my-app.com/pricing'],
    ['http://my-app.com', 'http://my-app.com/'],
    ['HTTPS://My-App.com', 'https://my-app.com/'],
  ])('accepts %s', (input, url) => {
    expect(parseScanUrl(input)).toEqual({ ok: true, url });
  });

  it('drops the query string and fragment, which can hold tokens', () => {
    expect(
      parseScanUrl('https://my-app.com/?token=abc#access_token=xyz'),
    ).toEqual({ ok: true, url: 'https://my-app.com/' });
  });

  it.each([
    ['', "Enter your app's link."],
    ['   ', "Enter your app's link."],
    ['https://', "That doesn't look like a link."],
    ['ftp://my-app.com', 'Only http and https links can be scanned.'],
    ['javascript://my-app.com', 'Only http and https links can be scanned.'],
    [
      'https://user:pass@my-app.com',
      'Links with a username or password in them cannot be scanned.',
    ],
    ['https://my-app.com:8080', 'Only ports 80 and 443 can be scanned.'],
    ['localhost', "Enter your app's full address, like your-app.com."],
    ['my-app', "Enter your app's full address, like your-app.com."],
  ])('rejects %j', (input, message) => {
    expect(parseScanUrl(input)).toEqual({ ok: false, message });
  });
});
