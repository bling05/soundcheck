export interface RouteProblem {
  framework: 'django' | 'nextjs' | 'express';
  /** The view, handler, or address, like `TagDetail.delete` or `/api/orders/[id]`. */
  route: string;
  /** What the route loads, like `RecipeTag` or `orders`. */
  thing: string;
  /** True when the route changes or deletes the record, not just reads it. */
  write: boolean;
  place: { path: string; line: number };
}
