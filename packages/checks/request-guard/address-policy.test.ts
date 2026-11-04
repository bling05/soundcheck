import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './address-policy';

describe('isPublicAddress', () => {
  it.each([
    ['0.0.0.0'],
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['100.64.0.0'],
    ['100.100.100.200'], // Alibaba metadata
    ['100.127.255.255'],
    ['127.0.0.1'],
    ['127.255.255.255'],
    ['168.63.129.16'], // Azure platform address
    ['169.254.169.254'], // AWS, Google Cloud, and Azure metadata
    ['172.16.0.0'],
    ['172.31.255.255'],
    ['192.0.0.192'],
    ['192.0.2.1'],
    ['192.88.99.1'],
    ['192.168.1.10'],
    ['198.18.0.0'],
    ['198.19.255.255'],
    ['198.51.100.1'],
    ['203.0.113.1'],
    ['224.0.0.1'],
    ['240.0.0.1'],
    ['255.255.255.255'],
  ])('blocks IPv4 %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ['::'],
    ['::1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:7f00:1'], // The same address in hex
    ['::ffff:169.254.169.254'],
    ['::127.0.0.1'], // Deprecated IPv4-compatible form
    ['64:ff9b::7f00:1'], // NAT64
    ['100::1'],
    ['fc00::1'],
    ['fd00:ec2::254'], // AWS metadata over IPv6
    ['fe80::1'],
    ['fe80::1%eth0'],
    ['fec0::1'],
    ['ff02::1'],
    ['2001::1'], // Teredo
    ['2001:db8::1'],
    ['2002:7f00:1::'], // 6to4 wrapping 127.0.0.1
    ['3fff::1'],
  ])('blocks IPv6 %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    // The addresses just outside each neighboring blocked range.
    ['9.255.255.255'],
    ['11.0.0.0'],
    ['100.63.255.255'],
    ['100.128.0.0'],
    ['126.255.255.255'],
    ['128.0.0.0'],
    ['168.63.129.15'],
    ['168.63.129.17'],
    ['169.253.255.255'],
    ['169.255.0.0'],
    ['172.15.255.255'],
    ['172.32.0.0'],
    ['192.167.255.255'],
    ['192.169.0.0'],
    ['198.17.255.255'],
    ['198.20.0.0'],
    ['223.255.255.255'],
    // Ordinary public addresses.
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['::ffff:8.8.8.8'],
    ['2606:4700:4700::1111'],
    ['2001:4860:4860::8888'],
  ])('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    [''],
    ['localhost'],
    ['example.com'],
    ['256.0.0.1'],
    ['2130706433'],
  ])('refuses %s because it is not an IP address', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
