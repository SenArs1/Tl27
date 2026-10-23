import { test, expect, axe, day, signIn } from './fixtures.js';

test('group booking: create, pay once, split a member bill, deposit', async ({ page, isMobile }) => {
  await signIn(page);
  const name = `Группа ${isMobile ? 'М' : 'Д'}`;
  const from = day(isMobile ? 210 : 200);
  await page.goto('/app/groups');
  await page.getByText('+ Новая группа').click();
  await axe(page);
  await page.getByLabel('Название группы').fill(name);
  await page.getByLabel('Контактное лицо').fill('Ольга Северная');
  await page.getByLabel('Телефон').fill('+7 900 555-44-33');
  await page.getByLabel('Заезд', { exact: true }).fill(from);
  await page.getByLabel('Выезд', { exact: true }).fill(day(isMobile ? 212 : 202));
  await page.getByLabel(/^Стандарт: номеров/).fill('2');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByText(/Группа создана: 2/)).toBeVisible();
  await expect(page.getByRole('heading', { name: `Группа «${name}»` })).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Принять оплату' }).click();
  await expect(page.getByText('Группа оплачена')).toBeVisible();

  // Open the first member and split its bill.
  await page.locator('table a[href^="/app/bookings/"]').first().click();
  await page.getByRole('link', { name: 'Счёт и платежи' }).click();
  await page.getByText('Разделить счёт').click();
  await page.getByRole('checkbox', { name: /Проживание/ }).check();
  await page.getByLabel('Плательщик').fill('ООО Север');
  await page.getByRole('button', { name: 'Выставить счёт' }).click();
  await expect(page.getByText('Отдельный счёт выставлен')).toBeVisible();
  await expect(page.getByRole('heading', { name: /основной/ })).toBeVisible();
  await expect(page.getByText('ООО Север').first()).toBeVisible();

  // Deposit: take and return.
  await page.getByText('Принять залог').click();
  await page.locator('#dp-amount').fill('2000');
  await page.getByRole('button', { name: 'Принять', exact: true }).click();
  await expect(page.getByText('на руках 2 000 ₽')).toBeVisible();
  await axe(page);
  await page.getByText('Вернуть залог').click();
  await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await expect(page.getByText('Залог возвращён')).toBeVisible();
});

test('housekeeping role sees only the cleaning board', async ({ page, browser, isMobile }) => {
  await signIn(page);
  const email = `maid-${isMobile ? 'm' : 'd'}-${Date.now()}@example.com`;
  await page.goto('/app/settings/team');
  await page.getByLabel('Имя').fill('Горничная Тест');
  await page.getByLabel('Почта').fill(email);
  await page.getByLabel('Роль', { exact: true }).selectOption('housekeeping');
  await page.getByRole('button', { name: /Добавить|Пригласить/ }).click();
  const pw = new URL(page.url()).searchParams.get('pw');
  expect(pw).toBeTruthy();
  const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const maid = await ctx.newPage();
  await maid.goto('/app/login');
  await maid.getByLabel('Почта').fill(email);
  await maid.getByLabel('Пароль').fill(pw);
  await maid.getByRole('button', { name: 'Войти' }).click();
  await expect(maid).toHaveURL(/\/app\/housekeeping/);
  await expect(maid.getByRole('heading', { name: 'Уборка' })).toBeVisible();
  await axe(maid);
  await maid.goto('/app/bookings');
  await expect(maid).toHaveURL(/\/app\/housekeeping/);
  await ctx.close();
});
