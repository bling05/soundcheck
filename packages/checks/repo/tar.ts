const BLOCK = 512;

export interface TarEntry {
  path: string;
  /** Only regular files are returned. Links, folders, and devices are skipped. */
  data: Buffer;
}

function text(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

function octal(block: Buffer, start: number, length: number): number {
  const value = text(block, start, length).trim();
  return value === '' ? 0 : parseInt(value, 8);
}

/** A pax header holds `<length> key=value\n` records. Only `path` matters here. */
function paxPath(data: Buffer): string | undefined {
  for (const record of data.toString('utf8').split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Reads the files out of an uncompressed tar archive, the format GitHub serves repos in.
 * Handles plain ustar names, the `prefix` field, pax long names (`x`), and GNU long names
 * (`L`). Stops at the end marker, or at the first header that doesn't make sense, so a
 * broken archive can't loop or read past its end.
 */
export function readTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | undefined;

  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;

    const size = octal(header, 124, 12);
    if (!Number.isFinite(size) || size < 0) break;
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) break;
    const data = archive.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x') {
      longName = paxPath(data) ?? longName;
      continue;
    }
    if (type === 'L') {
      longName = text(data, 0, data.length);
      continue;
    }
    if (type === 'g') continue;

    const isUstar = text(header, 257, 6) === 'ustar';
    const prefix = isUstar ? text(header, 345, 155) : '';
    const name = text(header, 0, 100);
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = undefined;

    // '0' and the old empty type are regular files.
    if (type === '0' || type === '\0') entries.push({ path, data });
  }
  return entries;
}
