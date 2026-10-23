import { test, expect, axe, day, signIn } from './fixtures.js';

test('staff: hourly board, create from an empty cell, change time in the card', async ({ page, isMobile }) => {
  await signIn(page);
  const date = day(isMobile ? 31 : 30);
  const name = `Дневной ${isMobile ? 'М' : 'Д'}`;
  await expect(page.locator('a[href="/app/hourly"]')).toHaveCount(1);
  await page.goto(`/app/hourly?date=${date}`);
  await expect(page.getByRole('heading', { name: 'Почасовые брони' })).toBeVisible();
  await axe(page);
  await page.getByText('+ Почасовая бронь').click();
  await page.getByLabel('Начало').selectOption('10:00');
  await page.getByLabel('Часов', { exact: true }).fill('3');
  await page.getByLabel('Имя гостя').fill(name);
  await page.getByLabel('Телефон').fill('+7 900 444-55-66');
  await page.getByRole('button', { name: 'Создать бронь' }).click();
  await expect(page.getByText(/создана: 10:00–13:00/)).toBeVisible();
  const bar = page.locator('.hb__bar', { hasText: name });
  await bar.scrollIntoViewIfNeeded();
  await expect(bar).toContainText('10:00–13:00');
  await axe(page);
  await bar.click();
  await expect(page.getByText(/по часам: .*10:00–13:00, 3 ч/)).toBeVisible();
  await page.getByLabel('Часов', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Изменить время' }).click();
  await expect(page.getByText('Время изменено: 10:00–14:00')).toBeVisible();
  await axe(page);
});

test('guest: book a day-use room by the hour on the hotel site', async ({ page, isMobile }) => {
  const date = day(isMobile ? 33 : 32);
  await page.goto('/h/severny-bereg');
  await expect(page.getByRole('heading', { name: 'По часам' })).toBeVisible();
  await page.locator('#hr-date').fill(date);
  await page.locator('#hr-start').selectOption('15:00');
  await page.locator('#hr-hours').fill('2');
  await page.getByRole('button', { name: 'Найти по часам' }).click();
  await expect(page.getByRole('heading', { name: /15:00–17:00, 2 ч/ })).toBeVisible();
  await axe(page);
  await page.getByRole('link', { name: 'Выбрать' }).first().click();
  await page.getByLabel('Имя и фамилия').fill('Олег Путник');
  await page.getByLabel('Почта').fill('oleg@example.com');
  await page.getByLabel('Телефон').fill('+7 900 777-66-55');
  await page.getByLabel(/Согласен/).check();
  await axe(page);
  await page.getByRole('button', { name: 'Забронировать' }).click();
  await expect(page.getByText(/15:00–17:00, 2 ч/)).toBeVisible();
});
