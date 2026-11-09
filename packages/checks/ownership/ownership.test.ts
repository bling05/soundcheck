import { LESSONS } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import type { RepoFile } from '../repo';
import type { CheckContext } from '../types';
import { ownershipChecks, plainName } from './index';

const contextFor = (files: Record<string, string>): CheckContext => ({
  fetch: async () => ({ ok: false, reason: 'timeout', message: 'unused' }),
  platforms: [],
  repo: {
    repo: { owner: 'you', name: 'app' },
    files: Object.entries(files).map(([path, text]): RepoFile => ({
      path,
      text,
    })),
    complete: true,
    filesSkipped: 0,
  },
});

async function findingsFor(files: Record<string, string>) {
  const result = await ownershipChecks.run(contextFor(files));
  if (result.status !== 'ran') throw new Error('did not run');
  return result.findings.map(({ title, evidence }) => ({
    title,
    where:
      evidence[0]?.kind === 'file'
        ? `${evidence[0].path}:${evidence[0].line}`
        : '',
  }));
}

// Shaped like SousChef's views.py, which this check found two real holes in.
const DJANGO_VIEWS = `from rest_framework import generics, permissions
from rest_framework.views import APIView
from .models import User, RecipeTag, MealPlan, Recipe

class UserDetails(generics.RetrieveAPIView):
    permission_classes = [permissions.IsAuthenticated]
    queryset = User.objects.all()
    serializer_class = UserSerializer

class RecipeDetailView(generics.RetrieveAPIView):
    queryset = Recipe.objects.all()

class TagDetail(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def delete(self, request, pk):
        queryset = RecipeTag.objects.filter(id=pk)
        queryset.delete()
        return Response(status=200)

class MealPlanDetailView(APIView):
    def get(self, request, pk):
        meal_plan = MealPlan.objects.get(id=pk, user=request.user)
        return Response(meal_plan)

class CreateMealView(APIView):
    def post(self, request, cooked_recipe_id):
        cooked = CookedRecipe.objects.get(id=cooked_recipe_id)
        if cooked.user != request.user:
            return Response(status=403)

def order_detail(request, order_id):
    order = get_object_or_404(Order, pk=order_id)
    return render(request, 'order.html', {'order': order})
`;

describe('Django', () => {
  it('finds the views that load by id without checking the owner, and nothing else', async () => {
    expect(await findingsFor({ 'api/views.py': DJANGO_VIEWS })).toEqual([
      {
        title: "Anyone signed in may be able to see other people's users",
        where: 'api/views.py:5',
      },
      {
        title:
          "Anyone signed in may be able to change or delete other people's recipe tags",
        where: 'api/views.py:16',
      },
      {
        title: "Anyone signed in may be able to see other people's orders",
        where: 'api/views.py:32',
      },
    ]);
  });

  it('accepts a generic view that filters by the user', async () => {
    const views = `from rest_framework import generics
class NoteDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Note.objects.all()
    def get_queryset(self):
        return Note.objects.filter(user=self.request.user)
`;
    expect(await findingsFor({ 'notes/views.py': views })).toEqual([]);
  });
});

describe('Next.js', () => {
  const unsafe = `import { db } from '@/lib/db';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await db.order.findUnique({ where: { id } });
  return Response.json(order);
}
export async function DELETE(req: Request, { params }) {
  await db.order.delete({ where: { id: (await params).id } });
}`;

  it('finds a route handler that loads by id with no user', async () => {
    expect(
      await findingsFor({ 'app/api/orders/[id]/route.ts': unsafe }),
    ).toEqual([
      {
        title:
          "Anyone signed in may be able to change or delete other people's orders",
        where: 'app/api/orders/[id]/route.ts:4',
      },
    ]);
  });

  it('accepts a handler that checks the session, and one that reads no record', async () => {
    const safe = unsafe.replace(
      "import { db } from '@/lib/db';",
      "import { db } from '@/lib/db';\nimport { auth } from '@/auth';\nconst session = await auth();",
    );
    expect(
      await findingsFor({
        'app/api/orders/[id]/route.ts': safe,
        'app/api/health/route.ts': 'export const GET = () => Response.json({})',
        'app/api/posts/route.ts': 'db.post.findMany()',
      }),
    ).toEqual([]);
  });

  it('reads pages/api routes too', async () => {
    const handler = `export default async function handler(req, res) {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.query.invoiceId } });
  res.json(invoice);
}`;
    expect(
      await findingsFor({ 'pages/api/invoices/[invoiceId].ts': handler }),
    ).toMatchObject([{ where: 'pages/api/invoices/[invoiceId].ts:2' }]);
  });
});

describe('Express', () => {
  it('finds a route that loads by id with no user, and skips one with auth', async () => {
    const routes = `const express = require('express');
const router = express.Router();
router.get('/notes/:noteId', async (req, res) => {
  const note = await Note.findById(req.params.noteId);
  res.json(note);
});
router.delete('/notes/:noteId', requireAuth, async (req, res) => {
  await Note.deleteOne({ _id: req.params.noteId, userId: req.user.id });
  res.sendStatus(204);
});`;
    expect(await findingsFor({ 'server/routes.js': routes })).toEqual([
      {
        title: "Anyone signed in may be able to see other people's notes",
        where: 'server/routes.js:4',
      },
    ]);
  });
});

describe('the check', () => {
  it('has everything a finding needs', async () => {
    const result = await ownershipChecks.run(
      contextFor({ 'api/views.py': DJANGO_VIEWS }),
    );
    if (result.status !== 'ran') throw new Error('did not run');
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding).toMatchObject({ severity: 'high', source: 'code' });
      expect(finding.aiFix.request).toContain('signed-in user');
    }
  });

  it('runs on any repo', () => {
    expect(ownershipChecks).toMatchObject({ mode: 'repo', platforms: 'all' });
  });

  it.each([
    ['RecipeTag', 'recipe tags'],
    ['User', 'users'],
    ['meal_plans', 'meal plans'],
  ])('calls %s "%s"', (thing, plain) => {
    expect(plainName(thing)).toBe(plain);
  });
});
