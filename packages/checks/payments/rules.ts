import type { RepoFile } from '../repo';

export type PaymentProblemKind =
  'price-from-request' | 'success-page-unlocks' | 'unverified-webhook';

export interface PaymentProblem {
  kind: PaymentProblemKind;
  path: string;
  line: number;
  language: 'js' | 'python';
  /** What the code does there, in plain words. */
  detail: string;
}

const JS_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const PY_FILE = /\.py$/;
const TEST_FILE = /\.(?:test|spec)\.|(?:^|\/)(?:__tests__|tests?|fixtures?)\//;
const USES_STRIPE = /\bstripe\b/i;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/**
 * The text between the bracket at `open` and its partner, skipping brackets inside
 * strings. Good enough for reading the arguments of one call.
 */
export function insideBrackets(text: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closers: string[] = [];
  let quote: string | undefined;
  for (let index = open; index < text.length; index++) {
    const char = text[index] ?? '';
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (pairs[char]) closers.push(pairs[char]);
    else if (char === closers.at(-1)) {
      closers.pop();
      if (closers.length === 0) return text.slice(open + 1, index);
    }
  }
  return text.slice(open + 1);
}

// 1. Prices from the request.

// Calls that set what the customer pays.
const CHARGE_CALL =
  /\b(?:checkout\.sessions\.create|paymentIntents\.create|invoiceItems\.create|checkout\.Session\.create|PaymentIntent\.create|InvoiceItem\.create)\s*\(/g;
// `unit_amount: x` in JavaScript, `unit_amount=x` in Python, the same for `amount`, and
// shorthand like `{ amount, currency }`, where the value is a variable called amount.
const AMOUNT_FIELD = /["']?\b(unit_amount|amount)\b["']?\s*([:=](?!=))?/g;

/** The whole value starting at `start`, up to the comma or bracket that ends it. */
function readValue(text: string, start: number): string {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index < text.length; index++) {
    const char = text[index] ?? '';
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) depth++;
    else if (depth > 0 && ')]}'.includes(char)) depth--;
    else if (depth === 0 && ',)]}\n'.includes(char))
      return text.slice(start, index).trim();
  }
  return text.slice(start).trim();
}

/**
 * True if `value` is just the request's names, maybe converted, like `Number(body.amount) * 100`.
 * A database lookup that uses them, like `db.product.find({ id: body.id })`, isn't: what it
 * returns comes from the database, which is the safe way.
 */
function onlyConverts(value: string, names: ReadonlySet<string>): boolean {
  const mentions = [...names].some((name) =>
    new RegExp(`\\b${name}\\b`).test(value),
  );
  const stripped = value.replace(
    /\b(?:Number|parseInt|parseFloat|String|BigInt|Math\.\w+|int|float|Decimal|str|round)\s*\(/g,
    '',
  );
  return mentions && !stripped.includes('(') && !/\bawait\b/.test(stripped);
}

/** Names a JavaScript file gets from the request body, a form, the address, or a server action's arguments. */
function requestNamesJs(text: string): Set<string> {
  const names = new Set<string>(['body']);
  const source =
    /(?:await\s+)?(?:req|request|ctx\.request|c\.req|event)\.(?:json|formData|body|query|text)\s*\(?\)?|\breq\.(?:body|query|params)\b|\bformData\b|\bsearchParams\b/;
  // `const { amount, price } = await req.json()` and `const body = req.body`.
  for (const match of text.matchAll(
    /\b(?:const|let|var)\s+(\{[^}]*\}|\w+)\s*(?::\s*[\w<>[\]{}|, ]+)?=\s*([^;\n]+)/g,
  )) {
    const [, target = '', value = ''] = match;
    if (!source.test(value) && !onlyConverts(value, names)) continue;
    for (const name of target.replace(/[{}]/g, '').split(',')) {
      const local = name.split(':').at(-1)?.split('=')[0]?.trim();
      if (local && /^\w+$/.test(local)) names.add(local);
    }
  }
  // Server actions: every argument comes straight from the visitor's browser.
  if (/^\s*['"]use server['"]/m.test(text)) {
    for (const match of text.matchAll(
      /export\s+(?:default\s+)?async\s+function\s+\w*\s*\(([^)]*)\)/g,
    )) {
      for (const parameter of (match[1] ?? '').split(',')) {
        const name = /^\s*(\w+)/.exec(parameter)?.[1];
        if (name) names.add(name);
      }
    }
  }
  return names;
}

// Python's ways of reading the request: Flask, Django, and Django REST Framework.
const PY_REQUEST =
  /\brequest\.(?:get_json\(\)|(?:json|data|POST|GET|form|args|query_params|body)\b)/;

/** Names a Python file gets from the request. */
function requestNamesPython(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/^\s*(\w+)\s*=\s*([^\n]+)/gm)) {
    const [, name = '', value = ''] = match;
    if (PY_REQUEST.test(value) || onlyConverts(value, names)) names.add(name);
  }
  return names;
}

function fromRequest(
  expression: string,
  names: ReadonlySet<string>,
  language: 'js' | 'python',
): boolean {
  const direct =
    language === 'js'
      ? /\b(?:req|request)\.(?:body|query|params)\b|\bformData\.get\(|\bsearchParams\.get\(/g
      : new RegExp(PY_REQUEST.source, 'g');
  // Reading the request counts like a name from it. Either way, only plain conversions
  // count: `calculateOrderAmount(req.body.items)` works the price out on the server.
  const masked = expression.replace(direct, 'FROM_REQUEST');
  return onlyConverts(masked, new Set([...names, 'FROM_REQUEST']));
}

function priceProblems(
  file: RepoFile,
  language: 'js' | 'python',
): PaymentProblem[] {
  const { path, text } = file;
  const names =
    language === 'js' ? requestNamesJs(text) : requestNamesPython(text);
  const problems: PaymentProblem[] = [];
  for (const call of text.matchAll(CHARGE_CALL)) {
    const open = call.index + call[0].length - 1;
    const args = insideBrackets(text, open);
    for (const field of args.matchAll(AMOUNT_FIELD)) {
      const name = field[1] ?? 'amount';
      const after = field.index + field[0].length;
      // Shorthand like `{ amount, currency }` uses a variable with the same name. It sits
      // where a key would, after `{` or `,`, not as a value like the second `amount` in
      // `amount: amount`.
      const isShorthand =
        /(?:^|[{,])\s*$/.test(args.slice(0, field.index)) &&
        /^\s*[,}\n]/.test(args.slice(after));
      if (!field[2] && !isShorthand) continue;
      const expression = field[2] ? readValue(args, after) : name;
      if (!fromRequest(expression, names, language)) continue;
      problems.push({
        kind: 'price-from-request',
        path,
        line: lineOf(text, open + 1 + field.index),
        language,
        detail: `The ${name} charged here is ${expression.trim()}, which comes from the visitor's request, so they can change it.`,
      });
    }
  }
  return problems;
}

// 2. Success pages that unlock what was paid for.

const SUCCESS_PATH =
  /(?:^|\/)[^/]*(?:success|thank-?you|thanks|payment-complete|order-complete|confirmation)[^/]*(?:\/|$)/i;
const SUCCESS_FUNCTION =
  /^\s*(?:async\s+)?def\s+(\w*(?:success|thank)\w*)\s*\(/gim;
// Writing to a database or saving a record.
const WRITE =
  /\.(?:update|upsert|insert|updateOne|updateMany|findByIdAndUpdate|save|create)\s*\(|\b(?:updateDoc|setDoc|addDoc|increment)\s*\(/;
// A field that records payment or unlocks a paid plan, being set.
const PAID_FIELD =
  /["']?\b(?:is_?paid|paid|has_?paid|is_?pro|is_?premium|premium|plan|tier|subscription_?status|subscription|payment_?status|credits|is_?subscribed|subscribed)\b["']?\s*(?::|=(?!=))/i;
// Asking Stripe whether the payment really happened.
const VERIFIES_PAYMENT =
  /\b(?:sessions|paymentIntents|subscriptions)\.retrieve\s*\(|\b(?:Session|PaymentIntent|Subscription)\.retrieve\s*\(|constructEvent|construct_event/;

function successProblems(
  file: RepoFile,
  language: 'js' | 'python',
): PaymentProblem[] {
  const { path, text } = file;
  const detail =
    'This success page marks the payment as done or unlocks paid features, without asking Stripe whether a payment happened.';
  const unlocks = (code: string) =>
    WRITE.test(code) && PAID_FIELD.test(code) && !VERIFIES_PAYMENT.test(code);

  if (language === 'js') {
    if (!SUCCESS_PATH.test(path) || !unlocks(text)) return [];
    const at = text.search(PAID_FIELD);
    return [
      {
        kind: 'success-page-unlocks',
        path,
        line: lineOf(text, at),
        language,
        detail,
      },
    ];
  }
  // Python: views named like `payment_success`, up to the next function or class.
  const problems: PaymentProblem[] = [];
  for (const match of text.matchAll(SUCCESS_FUNCTION)) {
    // The body starts on the line after `def` and ends at the next unindented line.
    const start = text.indexOf('\n', match.index + match[0].length) + 1;
    const rest = start === 0 ? '' : text.slice(start);
    const end = rest.search(/^\S/m);
    const body = end === -1 ? rest : rest.slice(0, end);
    if (!unlocks(body)) continue;
    const at = start + body.search(PAID_FIELD);
    problems.push({
      kind: 'success-page-unlocks',
      path,
      line: lineOf(text, at),
      language,
      detail,
    });
  }
  return problems;
}

// 3. Stripe webhooks that don't check Stripe's signature.

const STRIPE_EVENT =
  /["'](?:checkout\.session\.(?:completed|async_payment_succeeded)|invoice\.(?:paid|payment_succeeded)|customer\.subscription\.(?:created|updated|deleted)|payment_intent\.succeeded)["']/;
// Code that receives requests: a route handler, an Express route, a Deno server, a Convex
// HTTP action, or a Python view.
const HANDLES_REQUESTS =
  /export\s+(?:async\s+)?function\s+POST\b|export\s+const\s+POST\b|export\s+default\s+(?:async\s+)?function|\b(?:app|router)\.post\s*\(|\bDeno\.serve\s*\(|\bserve\s*\(|\bhttpAction\s*\(|\bhttp\.route\s*\(|@(?:app|router|bp|blueprint)\.(?:route|post)\s*\(|@csrf_exempt|def\s+\w*webhook\w*\s*\(/i;
// Checking the signature, reading it to hand to a helper that does, or using a library
// that checks it for you, like Convex's or Better Auth's Stripe integrations.
const CHECKS_SIGNATURE =
  /constructEvent(?:Async)?\s*\(|construct_event\s*\(|WebhookSignature\.verify|verify_header|stripe-signature|HTTP_STRIPE_SIGNATURE|Stripe-Signature|@convex-dev\/stripe|@better-auth\/stripe/i;

function webhookProblems(
  file: RepoFile,
  language: 'js' | 'python',
): PaymentProblem[] {
  const { path, text } = file;
  const event = STRIPE_EVENT.exec(text);
  if (!event || !HANDLES_REQUESTS.test(text) || CHECKS_SIGNATURE.test(text))
    return [];
  return [
    {
      kind: 'unverified-webhook',
      path,
      line: lineOf(text, event.index),
      language,
      detail: `This webhook acts on Stripe events like ${event[0]} without checking Stripe's signature, so anyone can send it a fake one.`,
    },
  ];
}

/** Payment mistakes in a repo's Stripe code, in JavaScript, TypeScript, and Python. */
export function findPaymentProblems(
  files: readonly RepoFile[],
): PaymentProblem[] {
  const problems: PaymentProblem[] = [];
  for (const file of files) {
    if (TEST_FILE.test(file.path)) continue;
    const language = JS_FILE.test(file.path)
      ? 'js'
      : PY_FILE.test(file.path)
        ? 'python'
        : undefined;
    if (!language) continue;
    if (USES_STRIPE.test(file.text)) {
      problems.push(
        ...priceProblems(file, language),
        ...webhookProblems(file, language),
      );
    }
    problems.push(...successProblems(file, language));
  }
  return problems;
}
