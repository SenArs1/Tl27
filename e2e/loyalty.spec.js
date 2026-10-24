import { test, expect, axe, day, signIn } from './fixtures.js';

test('guest joins the program, books with the card and points; staff finds the member', async ({ page, isMobile }) => {
  const email = `loyal-${isMobile ? 'm' : 'd'}-${Date.now()}@example.com`;
  await page.goto('/h/severny-bereg');
  const join = page.locator('form[action$="/loyalty/join"]');
  await join.scrollIntoViewIfNeeded();
  await axe(page);
  await join.getByLabel('Имя и фамилия').fill('Вера Постоянная');
  await join.getByLabel('Почта').fill(email);
  await join.getByLabel(/Согласен/).check();
  await join.getByRole('button', { name: 'Получить карту' }).click();
  await expect(page.getByText('Добро пожаловать в программу')).toBeVisible();
  const card = (await page.locator('[data-card]').textContent()).trim();
  expect(card).toMatch(/^\d{8}$/);
  await expect(page.getByText(/500/).first()).toBeVisible();
  await axe(page);

  // Book a stay with the card: 200 points go towards it.
  const from = day(isMobile ? 61 : 60);
  await page.goto(`/h/severny-bereg/rooms?checkin=${from}&checkout=${day(isMobile ? 63 : 62)}&adults=2&children=0`);
  await page.getByRole('link', { name: /Выбрать|Забронировать/ }).first().click();
  await page.getByLabel('Имя и фамилия').fill('Вера Постоянная');
  await page.getByLabel('Почта').fill(email);
  await page.getByLabel('Телефон').fill('+7 900 222-33-44');
  await page.getByLabel('Номер карты (необязательно)').fill(card);
  await page.getByLabel('Оплатить баллами (необязательно)').fill('200');
  await page.getByLabel(/Согласен с условиями тарифа/).check();
  await axe(page);
  await page.getByRole('button', { name: 'Забронировать' }).click();
  await expect(page.getByText(/200 ₽ баллами/)).toBeVisible();

  // Staff: the member is in the list with 300 points left.
  await signIn(page);
  await page.goto(`/app/loyalty?q=${card}`);
  await axe(page);
  await page.getByRole('link', { name: 'Вера Постоянная' }).click();
  await expect(page.getByText('оплата брони')).toBeVisible();
  await expect(page.locator('.stat-tile', { hasText: 'Баллы' })).toContainText('300');
  await axe(page);
});
