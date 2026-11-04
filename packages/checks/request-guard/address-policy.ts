import { BlockList, isIP } from 'node:net';

function subnets(
  family: 'ipv4' | 'ipv6',
  ranges: ReadonlyArray<readonly [string, number]>,
) {
  const list = new BlockList();
  for (const [network, prefix] of ranges)
    list.addSubnet(network, prefix, family);
  return list;
}

const BLOCKED_IPV4 = subnets('ipv4', [
  ['0.0.0.0', 8], // "This network". 0.0.0.0 can reach the machine itself.
  ['10.0.0.0', 8], // Private network.
  ['100.64.0.0', 10], // Shared carrier space. Includes Alibaba's metadata address.
  ['127.0.0.0', 8], // Loopback.
  ['168.63.129.16', 32], // Azure platform address. Looks public but isn't in a reserved range.
  ['169.254.0.0', 16], // Link-local. AWS, Google Cloud, and Azure metadata.
  ['172.16.0.0', 12], // Private network.
  ['192.0.0.0', 24], // Reserved for protocols.
  ['192.0.2.0', 24], // Documentation.
  ['192.88.99.0', 24], // Retired 6to4 relay.
  ['192.168.0.0', 16], // Private network.
  ['198.18.0.0', 15], // Benchmarking.
  ['198.51.100.0', 24], // Documentation.
  ['203.0.113.0', 24], // Documentation.
  ['224.0.0.0', 4], // Multicast.
  ['240.0.0.0', 4], // Reserved, including broadcast.
]);

// IPv6 is an allowlist: anything outside global unicast is refused, which covers
// loopback, private (including AWS's fd00:ec2::254), link-local, and multicast.
const GLOBAL_IPV6 = subnets('ipv6', [['2000::', 3]]);

const BLOCKED_IPV6 = subnets('ipv6', [
  ['2001::', 23], // Reserved for protocols, including Teredo tunneling.
  ['2001:db8::', 32], // Documentation.
  ['2002::', 16], // 6to4 tunneling, which can hide a private IPv4 address.
  ['3fff::', 20], // Documentation.
]);

const IPV4_MAPPED = subnets('ipv6', [['::ffff:0:0', 96]]);

/**
 * True only for ordinary public internet addresses. Compares numeric values, so
 * spelling can't disguise an address. Anything that isn't an IP is refused.
 */
export function isPublicAddress(address: string): boolean {
  // Scoped addresses like fe80::1%eth0 name a local interface, so they're never public.
  if (address.includes('%')) return false;

  const family = isIP(address);
  if (family === 4) return !BLOCKED_IPV4.check(address, 'ipv4');
  if (family !== 6) return false;

  if (IPV4_MAPPED.check(address, 'ipv6'))
    return !BLOCKED_IPV4.check(address, 'ipv6');
  return (
    GLOBAL_IPV6.check(address, 'ipv6') && !BLOCKED_IPV6.check(address, 'ipv6')
  );
}
