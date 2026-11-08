import { gzipSync } from 'node:zlib';

function header(path: string, size: number, type: string): Buffer {
  const block = Buffer.alloc(512);
  // Long names go in the ustar prefix field, like real archives.
  const slash = path.length > 100 ? path.lastIndexOf('/', 155) : -1;
  const name = slash === -1 ? path : path.slice(slash + 1);
  block.write(name, 0, 100, 'utf8');
  if (slash !== -1) block.write(path.slice(0, slash), 345, 155, 'utf8');
  block.write('0000644\0', 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  block.write('00000000000\0', 136);
  block.write(type, 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  // The checksum is computed with its own field as spaces.
  block.write('        ', 148);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

function entry(path: string, data: Buffer, type = '0'): Buffer {
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header(path, data.length, type), data, padding]);
}

/**
 * Builds a gzipped tar archive the way GitHub serves a repo: a global pax header, then
 * every file inside one `owner-repo-commit/` folder. `files` maps a path to its contents.
 */
export function repoArchive(
  files: Record<string, string | Buffer>,
  { folder = 'owner-repo-abc1234' } = {},
): Buffer {
  const parts = [
    entry('pax_global_header', Buffer.from('52 comment=abc1234\n'), 'g'),
    entry(`${folder}/`, Buffer.alloc(0), '5'),
  ];
  for (const [path, contents] of Object.entries(files)) {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const fullPath = `${folder}/${path}`;
    if (fullPath.length > 255) {
      const record = ` path=${fullPath}\n`;
      const pax = `${record.length + String(record.length).length}${record}`;
      parts.push(entry('PaxHeader', Buffer.from(pax), 'x'));
      parts.push(entry('long-name-placeholder', data));
    } else {
      parts.push(entry(fullPath, data));
    }
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
