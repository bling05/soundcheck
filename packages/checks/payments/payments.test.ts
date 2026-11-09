import { LESSONS } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import type { RepoFile } from '../repo';
import type { CheckContext } from '../types';
import { payments } from './index';
import { findPaymentProblems, insideBrackets } from './rules';

const filesFrom = (files: Record<string, string>): RepoFile[] =>
  Object.entries(files).map(([path, text]) => ({ path, text }));

const problemsIn = (files: Record<string, string>) =>
  findPaymentProblems(filesFrom(files)).map(
    ({ kind, path, line }) => `${kind} ${path}:${line}`,
  );

const IMPORT_STRIPE =
  "import Stripe from 'stripe';\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);";

describe('prices from the request', () => {
  it('finds an amount taken from the request body', () => {
    const route = `${IMPORT_STRIPE}
export async function POST(req: Request) {
  const { amount, name } = await req.json();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name },
        unit_amount: Math.round(amount * 100),
      },
      quantity: 1,
    }],
  });
  return Response.json({ url: session.url });
}`;
    expect(problemsIn({ 'app/api/checkout/route.ts': route })).toEqual([
      'price-from-request app/api/checkout/route.ts:11',
    ]);
  });

  it('finds a server action that charges an amount it was given, written as shorthand', () => {
    const action = `'use server';
${IMPORT_STRIPE}
export async function pay(amount: number) {
  return stripe.paymentIntents.create({ amount, currency: 'usd' });
}`;
    expect(problemsIn({ 'app/actions.ts': action })).toEqual([
      'price-from-request app/actions.ts:5',
    ]);
  });

  it('finds the same in Python', () => {
    const view = `import stripe
from flask import request

@app.route("/checkout", methods=["POST"])
def checkout():
    data = request.get_json()
    price = int(data["price"])
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[{"price_data": {"currency": "usd", "unit_amount": price}, "quantity": 1}],
    )`;
    expect(problemsIn({ 'app.py': view })).toEqual([
      'price-from-request app.py:10',
    ]);
  });

  it('accepts a price looked up on the server, even by an id from the request', () => {
    const route = `${IMPORT_STRIPE}
export async function POST(req: Request) {
  const { productId } = await req.json();
  const product = await db.product.findUnique({ where: { id: productId } });
  await stripe.checkout.sessions.create({
    line_items: [{ price_data: { currency: 'usd', unit_amount: product.price }, quantity: 1 }],
  });
  await stripe.paymentIntents.create({ amount: product.price * 100, currency: 'usd' });
}`;
    expect(problemsIn({ 'app/api/checkout/route.ts': route })).toEqual([]);
  });
});

describe('success pages', () => {
  it('finds a success page that unlocks the paid plan by itself', () => {
    const page = `'use client';
import { useEffect } from 'react';
export default function Success() {
  useEffect(() => {
    supabase.from('profiles').update({ is_pro: true }).eq('id', user.id);
  }, []);
  return <p>Thanks!</p>;
}`;
    expect(problemsIn({ 'app/success/page.tsx': page })).toEqual([
      'success-page-unlocks app/success/page.tsx:5',
    ]);
  });

  it('finds a Django view named like a success page', () => {
    const views = `from django.shortcuts import render

def payment_success(request):
    order = Order.objects.get(user=request.user, status="pending")
    order.paid = True
    order.save()
    return render(request, "success.html")

def home(request):
    return render(request, "home.html")
`;
    expect(problemsIn({ 'shop/views.py': views })).toEqual([
      'success-page-unlocks shop/views.py:5',
    ]);
  });

  it('accepts a success page that only says thanks, or checks with Stripe first', () => {
    expect(
      problemsIn({
        'app/success/page.tsx':
          'export default () => <p>Thanks for your order!</p>;',
        'app/thank-you/page.tsx': `${IMPORT_STRIPE}
export default async function Page({ searchParams }) {
  const session = await stripe.checkout.sessions.retrieve(searchParams.session_id);
  if (session.payment_status === 'paid') await db.order.update({ where: { id }, data: { paid: true } });
}`,
      }),
    ).toEqual([]);
  });
});

describe('webhooks', () => {
  const unsafe = `${IMPORT_STRIPE}
export async function POST(req: Request) {
  const event = await req.json();
  switch (event.type) {
    case 'checkout.session.completed':
      await grantPro(event.data.object.client_reference_id);
      break;
  }
  return new Response('ok');
}`;

  it('finds a webhook that acts on Stripe events without checking the signature', () => {
    expect(problemsIn({ 'app/api/webhooks/stripe/route.ts': unsafe })).toEqual([
      'unverified-webhook app/api/webhooks/stripe/route.ts:6',
    ]);
  });

  it('accepts a webhook that checks the signature, and a helper file that handles events', () => {
    const safe = unsafe.replace(
      'const event = await req.json();',
      "const event = stripe.webhooks.constructEvent(await req.text(), req.headers.get('stripe-signature')!, secret);",
    );
    const helper = `export async function handle(event: Stripe.Event) {
  if (event.type === 'invoice.paid') await renew(event.data.object);
}`;
    expect(
      problemsIn({
        'app/api/webhooks/stripe/route.ts': safe,
        'lib/stripe-events.ts': `import Stripe from 'stripe';\n${helper}`,
      }),
    ).toEqual([]);
  });

  it('finds a Python webhook view without construct_event', () => {
    const view = `import stripe, json
@csrf_exempt
def stripe_webhook(request):
    event = json.loads(request.body)
    if event["type"] == "checkout.session.completed":
        fulfill(event)
`;
    expect(problemsIn({ 'billing/views.py': view })).toEqual([
      'unverified-webhook billing/views.py:5',
    ]);
  });
});

describe('the check', () => {
  it('ignores tests', () => {
    expect(
      problemsIn({
        'app/api/webhook/route.test.ts': `export async function POST() { if (e.type === 'invoice.paid') {} } // stripe`,
      }),
    ).toEqual([]);
  });

  it('reads the arguments of one call, skipping brackets inside strings', () => {
    const text = "create({ a: ')', b: [1, 2] }) + other()";
    expect(insideBrackets(text, text.indexOf('('))).toBe(
      "{ a: ')', b: [1, 2] }",
    );
  });

  it('has everything a finding needs', async () => {
    const context: CheckContext = {
      fetch: async () => ({ ok: false, reason: 'timeout', message: 'unused' }),
      platforms: [],
      repo: {
        repo: { owner: 'you', name: 'app' },
        files: filesFrom({
          'app/success/page.tsx':
            "supabase.from('users').update({ plan: 'pro' })",
          'app/api/webhook/route.ts': `// stripe\nexport async function POST() { if (e.type === 'invoice.paid') {} }`,
        }),
        complete: true,
        filesSkipped: 0,
      },
    };
    const result = await payments.run(context);
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings).toHaveLength(2);
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding).toMatchObject({ severity: 'high', source: 'code' });
    }
    expect(payments).toMatchObject({ mode: 'repo', platforms: 'all' });
  });
});

describe('Convex', () => {
  const unsafe = `import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
// stripe
const http = httpRouter();
http.route({
  path: '/stripe',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const event = await request.json();
    if (event.type === 'checkout.session.completed') await ctx.runMutation(upgrade, {});
    return new Response(null);
  }),
});
export default http;`;

  it('finds a Convex HTTP action that trusts the event, and accepts the Stripe component that checks it', () => {
    const component = `import { registerRoutes } from '@convex-dev/stripe';
registerRoutes(http, components.stripe, {
  events: { 'checkout.session.completed': async (ctx, event) => {} },
});
export default http;`;
    expect(
      problemsIn({
        'convex/http.ts': unsafe,
        'other/convex/http.ts': component,
      }),
    ).toEqual(['unverified-webhook convex/http.ts:10']);
  });
});

describe('working the price out on the server', () => {
  it("accepts a total worked out from the cart by the server's own function", () => {
    const server = `${IMPORT_STRIPE}
app.post('/create-payment-intent', async (req, res) => {
  const { items } = req.body;
  const paymentIntent = await stripe.paymentIntents.create({
    amount: calculateOrderAmount(items),
    currency: 'usd',
  });
});`;
    expect(problemsIn({ 'server.js': server })).toEqual([]);
  });

  it('quotes the whole expression it found', () => {
    const server = `${IMPORT_STRIPE}
app.post('/pay', async (req, res) => {
  await stripe.paymentIntents.create({ amount: Math.round(req.query.total * 100), currency: 'usd' });
});`;
    expect(
      findPaymentProblems(filesFrom({ 'server.js': server }))[0]?.detail,
    ).toContain('Math.round(req.query.total * 100),'.slice(0, -1));
  });
});
