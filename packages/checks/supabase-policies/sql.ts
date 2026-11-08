export interface Statement {
  /** The statement with comments removed and whitespace collapsed. String contents are kept. */
  text: string;
  /** 1-based line where the statement starts. */
  line: number;
}

/**
 * Splits SQL into statements at semicolons, skipping semicolons inside strings, quoted
 * names, dollar-quoted function bodies, and comments. Function bodies are kept whole, so
 * a policy written inside one isn't mistaken for a real one.
 */
export function splitStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let current = '';
  let line = 1;
  let startLine = 1;
  let index = 0;

  const flush = () => {
    const text = current.replace(/\s+/g, ' ').trim();
    if (text) statements.push({ text, line: startLine });
    current = '';
  };
  const add = (chunk: string) => {
    if (current.trim() === '' && chunk.trim() !== '') startLine = line;
    current += chunk;
    line += (chunk.match(/\n/g) ?? []).length;
  };

  while (index < sql.length) {
    const rest = sql.slice(index);
    const char = sql[index] ?? '';

    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      line += (sql.slice(index, stop).match(/\n/g) ?? []).length;
      current += ' ';
      index = stop;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, index + dollar.length);
      const stop = end === -1 ? sql.length : end + dollar.length;
      add(sql.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === "'" || char === '"') {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === char) {
          // A doubled quote is an escaped quote, not the end.
          if (sql[end + 1] === char) end += 2;
          else break;
        } else end++;
      }
      add(sql.slice(index, end + 1));
      index = end + 1;
      continue;
    }
    if (char === ';') {
      flush();
      index++;
      continue;
    }
    add(char);
    index++;
  }
  flush();
  return statements;
}

/** The text inside the parentheses that open at `open`, or undefined if they never close. */
export function insideParens(text: string, open: number): string | undefined {
  if (text[open] !== '(') return undefined;
  let depth = 0;
  let quote: string | undefined;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return undefined;
}

/** `public.profiles`, `"Profiles"`, or `profiles` as schema and table, lower case. */
export function tableName(raw: string): { schema: string; table: string } {
  const parts = raw
    .split('.')
    .map((part) => part.replace(/^"|"$/g, '').toLowerCase());
  return parts.length > 1
    ? { schema: parts[0] ?? 'public', table: parts[1] ?? '' }
    : { schema: 'public', table: parts[0] ?? '' };
}
