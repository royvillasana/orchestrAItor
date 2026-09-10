/**
 * Playwright resolves `waitForFunction` as soon as the predicate returns a
 * truthy value, and a Promise is always truthy — so an async predicate passes
 * immediately without ever waiting for what it asks about. These helpers poll
 * explicitly instead.
 */
export async function until(page, read, predicate, { timeout = 30000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(read);
    if (predicate(value)) return value;
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(value)?.slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
/** Polls a snapshot field, which is how every asynchronous state here is read. */
export const untilSnapshot = (page, select, predicate, options) =>
  until(
    page,
    async () => await window.orchestra.snapshot({}),
    (snapshot) => predicate(select(snapshot)),
    options,
  ).then(select);

/** Polls a locator's own enabled state, which no single snapshot can promise. */
export async function untilEnabled(locator, { timeout = 20000, label = 'control' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    await locator.waitFor({ timeout: Math.max(1000, deadline - Date.now()) });
    if (!(await locator.isDisabled())) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label} to become enabled`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
