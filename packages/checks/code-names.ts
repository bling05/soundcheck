/**
 * Build tools often move a repeated string into a short variable, so app code that said
 * `storage.from('avatars')` ships as `S_="avatars"` and, later, `storage.from(S_)`. This
 * finds the string a variable was last set to before `index`, the call that uses it.
 *
 * Minified code reuses short names in different places, so only the nearest assignment
 * before the call counts. It's a best guess: a wrong name only costs one wasted request,
 * which comes back as "couldn't tell", never as a finding.
 */
export function stringAssignedBefore(
  text: string,
  variable: string,
  index: number,
): string | undefined {
  const escaped = variable.replace(/[$]/g, '\\$');
  const assignment = new RegExp(
    `(?:^|[^\\w$.])${escaped}\\s*=\\s*["'\`]([A-Za-z0-9_.-]{1,63})["'\`]`,
    'g',
  );
  let found: string | undefined;
  for (const match of text.slice(0, index).matchAll(assignment)) {
    found = match[1];
  }
  return found;
}

/** A JavaScript variable name, like `S_` or `$e`. */
export const VARIABLE = '[A-Za-z_$][\\w$]{0,30}';
