import { expect, test } from '@playwright/test';

// PM scaffold check that the harness boots both servers. The Tester replaces or extends this.
test('the app loads and the API answers through the proxy', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Fleet Floor Simulator');
  const res = await request.get('/api/floors/main');
  expect(res.status()).toBe(200);
});
