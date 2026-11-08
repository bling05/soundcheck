const BLOCK = 512;
/** Long-name headers are a few hundred bytes. Anything far bigger isn't one. */
const MAX_HEADER_DATA = 64 * 1024;

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

export interface TarCallbacks {
  /** Whether to keep a file. Files it turns down are skipped without being held in memory. */
  wants(path: string, size: number): boolean;
  onFile(entry: TarEntry): void;
}

type Collecting = {
  kind: 'file' | 'pax' | 'gnu';
  path: string;
  remaining: number;
  parts: Buffer[];
  padding: number;
};

/**
 * Reads a tar archive, the format GitHub serves repos in, a piece at a time. Files the
 * caller turns down are skipped as they stream past, so a repo full of big data files
 * never has to fit in memory. Handles ustar names, the `prefix` field, pax long names
 * (`x`), and GNU long names (`L`). Stops at the end marker or at a header that makes no
 * sense, so a broken archive can't loop.
 */
export class TarReader {
  done = false;
  private header = Buffer.alloc(0);
  private skip = 0;
  private collecting: Collecting | undefined;
  private longName: string | undefined;

  constructor(private readonly callbacks: TarCallbacks) {}

  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length && !this.done) {
      if (this.skip > 0) {
        const taken = Math.min(this.skip, chunk.length - offset);
        this.skip -= taken;
        offset += taken;
        continue;
      }
      if (this.collecting) {
        const entry = this.collecting;
        const taken = Math.min(entry.remaining, chunk.length - offset);
        entry.parts.push(chunk.subarray(offset, offset + taken));
        entry.remaining -= taken;
        offset += taken;
        if (entry.remaining === 0) this.finish(entry);
        continue;
      }
      const taken = Math.min(BLOCK - this.header.length, chunk.length - offset);
      this.header = Buffer.concat([
        this.header,
        chunk.subarray(offset, offset + taken),
      ]);
      offset += taken;
      if (this.header.length === BLOCK) {
        const block = this.header;
        this.header = Buffer.alloc(0);
        this.readHeader(block);
      }
    }
  }

  private finish(entry: Collecting): void {
    this.collecting = undefined;
    this.skip = entry.padding;
    const data = Buffer.concat(entry.parts);
    if (entry.kind === 'pax') this.longName = paxPath(data) ?? this.longName;
    else if (entry.kind === 'gnu') this.longName = text(data, 0, data.length);
    else this.callbacks.onFile({ path: entry.path, data });
  }

  private readHeader(block: Buffer): void {
    if (block.every((byte) => byte === 0)) {
      this.done = true;
      return;
    }
    const size = octal(block, 124, 12);
    if (!Number.isFinite(size) || size < 0) {
      this.done = true;
      return;
    }
    const padding = Math.ceil(size / BLOCK) * BLOCK - size;
    const type = String.fromCharCode(block[156] ?? 0);
    const collect = (kind: Collecting['kind'], path: string) => {
      this.collecting = { kind, path, remaining: size, parts: [], padding };
      if (size === 0) this.finish(this.collecting);
    };

    if ((type === 'x' || type === 'L') && size <= MAX_HEADER_DATA) {
      collect(type === 'x' ? 'pax' : 'gnu', '');
      return;
    }
    if (type !== '0' && type !== '\0') {
      // Folders, links, the global pax header, and anything unusual.
      this.skip = size + padding;
      return;
    }

    const isUstar = text(block, 257, 6) === 'ustar';
    const prefix = isUstar ? text(block, 345, 155) : '';
    const name = text(block, 0, 100);
    const path = this.longName ?? (prefix ? `${prefix}/${name}` : name);
    this.longName = undefined;

    if (this.callbacks.wants(path, size)) collect('file', path);
    else this.skip = size + padding;
  }
}

/** Reads every file in an uncompressed archive held in memory. Used in tests. */
export function readTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  const reader = new TarReader({
    wants: () => true,
    onFile: (entry) => entries.push(entry),
  });
  reader.push(archive);
  return entries;
}
