import {
  findingId,
  sortBySeverity,
  withUniqueIds,
  type Finding,
  type ManualFix,
} from '@soundcheck/report';
import type { Check, CheckContext, CheckResult } from '../types';
import {
  findPaymentProblems,
  type PaymentProblem,
  type PaymentProblemKind,
} from './rules';

const CHECK_ID = 'payments';

const TITLES: Record<PaymentProblemKind, string> = {
  'price-from-request':
    'Visitors may be able to set their own price at checkout',
  'success-page-unlocks':
    'Visiting your success page may unlock paid features without paying',
  'unverified-webhook':
    'Anyone may be able to send your app a fake "payment succeeded" message',
};

function fixFor({ kind, language }: PaymentProblem): ManualFix {
  const python = language === 'python';
  switch (kind) {
    case 'price-from-request':
      return {
        description:
          'Have the browser send only which product it wants, never the amount. (If visitors are meant to choose the amount, like a donation or a tip, this is expected: just set a minimum and maximum on the server.) Look the price up on your server, from your database or a Stripe Price, and charge that. Anything the browser sends can be edited before it reaches you.',
        language: python ? 'python' : 'ts',
        snippet: python
          ? `# The browser sends a product id. The price comes from your database.\nproduct = Product.objects.get(id=data["product_id"])\nsession = stripe.checkout.Session.create(\n    mode="payment",\n    line_items=[{"price": product.stripe_price_id, "quantity": 1}],\n    success_url=SUCCESS_URL,\n    cancel_url=CANCEL_URL,\n)`
          : `// The browser sends a product id. The price comes from your database.\nconst product = await db.product.findUnique({ where: { id: productId } });\nif (!product) return new Response('Not found', { status: 404 });\n\nconst session = await stripe.checkout.sessions.create({\n  mode: 'payment',\n  line_items: [{ price: product.stripePriceId, quantity: 1 }],\n  success_url: SUCCESS_URL,\n  cancel_url: CANCEL_URL,\n});`,
      };
    case 'success-page-unlocks':
      return {
        description:
          "Let Stripe tell your server when a payment succeeds, through a webhook that checks Stripe's signature, and unlock paid features there. The success page should only say thanks. If it must check, look the Checkout Session up on your server and confirm it's paid and belongs to the signed-in user.",
        language: python ? 'python' : 'ts',
        snippet: python
          ? `# On the server, before unlocking anything:\nsession = stripe.checkout.Session.retrieve(session_id)\nif session.payment_status != "paid" or session.client_reference_id != str(request.user.id):\n    return HttpResponseForbidden()`
          : `// On the server, before unlocking anything:\nconst session = await stripe.checkout.sessions.retrieve(sessionId);\nif (session.payment_status !== 'paid' || session.client_reference_id !== user.id) {\n  return new Response('Payment not found', { status: 402 });\n}`,
      };
    case 'unverified-webhook':
      return {
        description:
          "Check Stripe's signature on every webhook before acting on it, using the raw request body and your webhook signing secret from the Stripe dashboard. Reject anything that fails. Make sure the secret is actually set: an empty one can let fake messages through.",
        language: python ? 'python' : 'ts',
        snippet: python
          ? `payload = request.body\nsignature = request.META.get("HTTP_STRIPE_SIGNATURE")\ntry:\n    event = stripe.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)\nexcept (ValueError, stripe.error.SignatureVerificationError):\n    return HttpResponse(status=400)`
          : `// The raw body, not parsed JSON: the signature is over the exact bytes Stripe sent.\nconst body = await req.text();\nconst signature = req.headers.get('stripe-signature');\nlet event: Stripe.Event;\ntry {\n  event = stripe.webhooks.constructEvent(body, signature!, process.env.STRIPE_WEBHOOK_SECRET!);\n} catch {\n  return new Response('Invalid signature', { status: 400 });\n}`,
      };
  }
}

function fixRequestFor({ kind, path }: PaymentProblem): string {
  switch (kind) {
    case 'price-from-request':
      return `In ${path}, the amount charged at checkout comes from the browser's request, so a visitor can change it. Make the browser send only which product it wants, look the price up on the server from the database or a Stripe Price, and charge that. Check every other place that creates a Stripe Checkout Session or PaymentIntent for the same problem, and tell me what you changed. If the amount is meant to be chosen by the visitor, like a donation or a tip, keep it but enforce a minimum and maximum on the server.`;
    case 'success-page-unlocks':
      return `In ${path}, the payment success page marks the order paid or unlocks paid features without checking with Stripe, so anyone can open that page and get them free. Move the unlocking into a Stripe webhook that checks Stripe's signature, and make the success page only show a message. If the page must check, retrieve the Checkout Session on the server and confirm payment_status is paid and it belongs to the signed-in user.`;
    case 'unverified-webhook':
      return `In ${path}, the Stripe webhook acts on events without checking Stripe's signature, so anyone can send a fake "payment succeeded" event. Verify every event with stripe.webhooks.constructEvent (or stripe.Webhook.construct_event in Python), using the raw request body, the stripe-signature header, and the webhook secret from an environment variable named STRIPE_WEBHOOK_SECRET. Reject anything that fails with a 400. Don't print the secret. Then remind me to set STRIPE_WEBHOOK_SECRET in my hosting settings.`;
  }
}

async function run(context: CheckContext): Promise<CheckResult> {
  if (!context.repo) {
    return { status: 'skipped', reason: 'This check needs your repo.' };
  }
  const findings = findPaymentProblems(context.repo.files).map(
    (problem): Finding => {
      const title = TITLES[problem.kind];
      return {
        id: findingId(CHECK_ID, problem.kind, problem.path),
        checkId: CHECK_ID,
        title,
        // Read from code alone, so a strong sign rather than proof.
        severity: 'high',
        source: 'code',
        evidence: [
          {
            kind: 'file',
            path: problem.path,
            line: problem.line,
            detail: problem.detail,
          },
        ],
        lessonId: `${CHECK_ID}:${problem.kind}`,
        manualFix: fixFor(problem),
        aiFix: { problem: title, request: fixRequestFor(problem) },
      };
    },
  );
  const result: CheckResult = {
    status: 'ran',
    findings: sortBySeverity(withUniqueIds(findings)),
  };
  return context.repo.complete
    ? result
    : {
        ...result,
        note: "Some files in your repo were too big to read, so there could be payment code we didn't see.",
      };
}

export const payments: Check = {
  id: CHECK_ID,
  title: 'Payment mistakes in your code',
  mode: 'repo',
  platforms: 'all',
  run,
};
