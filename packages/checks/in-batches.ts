/** Runs `task` on every item, a few at a time, keeping the order. */
export async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, worker),
  );
  return results;
}
