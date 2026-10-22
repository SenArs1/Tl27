import { test, expect, axe, day, signIn } from './fixtures.js';

test('F04: grid cell edit via dialog is reflected in engine', async ({ page, isMobile }) => {
  await signIn(page);
  await axe(page);
  await page.goto(`/app/grid?from=${day(80)}`);
  await page.getByRole('button', { name: new RegExp(`^Люкс с сауной, .*: свободно 2`) }).first().click();
  await page.getByLabel('Цена за ночь, ₽').fill('15500');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.cell__btn[data-price="15500"]')).toHaveCount(1);
  await axe(page);
  await page.screenshot({ path: `replica/clone-screens/S24-${isMobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
  const res = await page.request.get(`/api/h/severny-bereg/offers?checkin=${day(80)}&checkout=${day(81)}&adults=2`);
  const j = await res.json();
  expect(j.offers.find((o) => o.room.name === 'Люкс с сауной').rates[0].total).toBe(15500);
});

test('F05/F08: connect channel, add room type, pages pass axe', async ({ page, isMobile }) => {
  await signIn(page);
  await page.goto('/app/channels');
  const row = page.getByRole('row', { name: /RoomHub/ });
  const btn = row.getByRole('button', { name: /Подключить|Отключить/ });
  const label = await btn.textContent();
  await btn.click();
  await expect(page.getByText(label.includes('Подключить') ? 'RoomHub подключён' : 'RoomHub отключён')).toBeVisible();
  await axe(page);
  await page.goto('/app/rooms');
  await page.getByText('Добавить категорию').click();
  const add = page.locator('details.add').first();
  const name = `Шале ${isMobile ? 'M' : 'D'}`;
  await add.getByLabel('Название').fill(name);
  await add.getByLabel('Мест').fill('4');
  await add.getByLabel('Номеров').fill('2');
  await add.getByLabel('Цена за ночь, ₽').fill('8800');
  await add.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(`Категория «${name}» добавлена`)).toBeVisible();
  await axe(page);
  for (const p of ['/app/bookings', '/app/reports', '/app/leads', '/app/settings']) {
    await page.goto(p);
    await axe(page);
  }
  await page.goto('/app');
  await page.screenshot({ path: `replica/clone-screens/S21-${isMobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
});

test('widget renders on a third-party page', async ({ page }) => {
  await page.goto('/widget-demo');
  const host = page.locator('#stayra-booking');
  await expect(host.getByRole('button', { name: 'Найти номера' })).toBeVisible();
});
