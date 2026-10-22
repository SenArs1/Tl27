import { test, expect, axe, day, signIn } from './fixtures.js';

test('F01+F03+F02: guest books with promo and extras, hotelier sees it, guest cancels', async ({ page, isMobile }) => {
  const offset = isMobile ? 60 : 45;
  await page.goto('/h/severny-bereg');
  await axe(page);
  await page.getByLabel('Заезд').fill(day(offset));
  await page.getByLabel('Выезд').fill(day(offset + 2));
  await page.getByLabel('Промокод').fill('onego10');
  await page.getByRole('button', { name: 'Найти номера' }).click();
  await expect(page.getByText('Промокод ONEGO10 применён')).toBeVisible();
  await axe(page);
  await page.screenshot({ path: `replica/clone-screens/S11-${isMobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
  await page.getByRole('link', { name: 'Выбрать: Стандарт с видом на озеро, Гибкий с завтраком' }).click();

  await expect(page.getByRole('heading', { name: 'Почти готово' })).toBeVisible();
  await page.getByRole('button', { name: 'Забронировать' }).click();
  await expect(page.getByText('Как к вам обращаться?')).toBeVisible();
  const before = await page.locator('[data-grand]').textContent();
  await page.getByLabel('Имя и фамилия').fill('Тестовый Гость');
  await page.getByLabel('Почта').fill('guest@example.com');
  await page.getByLabel('Телефон').fill('+7 900 123-45-67');
  await page.getByLabel(/Трансфер с вокзала/).check();
  await expect(page.locator('[data-grand]')).not.toHaveText(before);
  await page.getByLabel(/Согласен с условиями/).check();
  await axe(page);
  await page.getByRole('button', { name: 'Забронировать' }).click();

  await expect(page.getByRole('heading', { name: 'Номер забронирован' })).toBeVisible();
  const code = (await page.locator('[data-code]').textContent()).trim();
  expect(code).toMatch(/^SR-[0-9A-F]{8}$/);
  await axe(page);
  await page.screenshot({ path: `replica/clone-screens/S13-${isMobile ? 'mobile' : 'desktop'}.png`, fullPage: true });

  await signIn(page);
  await page.goto('/app/bookings');
  await page.getByRole('link', { name: code }).click();
  await expect(page.getByText('Тестовый Гость')).toBeVisible();
  await expect(page.getByText('Трансфер с вокзала × 1')).toBeVisible();

  await page.goto('/h/severny-bereg/manage');
  await page.getByLabel('Номер брони').fill(code);
  await page.getByLabel('Почта, указанная при бронировании').fill('guest@example.com');
  await page.getByRole('button', { name: 'Найти' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Отменить бронь' }).click();
  await expect(page.getByRole('heading', { name: 'Бронь отменена' })).toBeVisible();
});

test('no rooms: closed dates show empty state with shift button', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/grid');
  await page.getByLabel('Категория', { exact: true }).selectOption('all');
  await page.locator('form.bulk').getByLabel('С', { exact: true }).fill(day(70));
  await page.getByLabel('По (включительно)').fill(day(71));
  await page.getByLabel('Действие').selectOption('close');
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByText(/Готово: изменено/)).toBeVisible();
  await page.goto(`/h/severny-bereg/rooms?checkin=${day(70)}&checkout=${day(72)}&adults=2&children=0`);
  await expect(page.getByRole('heading', { name: 'На эти даты свободных номеров нет' })).toBeVisible();
});
