import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Fails a test on console errors and 5xx responses.
export const test = base.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: .* status of 4\d\d/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
    await use(page);
    expect(problems, problems.join('\n')).toEqual([]);
  },
});
export { expect };

export async function axe(page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
}

export function day(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export async function signIn(page) {
  await page.goto('/app/login');
  await page.getByLabel('Почта').fill('demo@stayra.example');
  await page.getByLabel('Пароль').fill('demo12345');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Сводка' })).toBeVisible();
}
