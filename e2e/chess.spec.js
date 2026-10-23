import { test, expect, axe, day, signIn } from './fixtures.js';

async function newBooking(page, { category, from, to, name }) {
  await page.goto('/app/bookings/new');
  await page.getByLabel('Категория').selectOption({ label: category });
  await page.getByLabel('Заезд', { exact: true }).fill(from);
  await page.getByLabel('Выезд', { exact: true }).fill(to);
  await page.getByLabel('ФИО гостя').fill(name);
  await page.getByLabel('Телефон').fill('+7 900 333-22-11');
  await page.getByRole('button', { name: 'Создать бронь' }).click();
  await expect(page.getByText(/создана/)).toBeVisible();
}

test('side panel: check in with payment without leaving the chessboard', async ({ page, isMobile }) => {
  await signIn(page);
  const name = `Панелькин ${isMobile ? 'М' : 'Д'}`;
  await newBooking(page, { category: 'Стандарт с видом на озеро (до 2 + 1 доп.)', from: day(isMobile ? 4 : 3), to: day(isMobile ? 5 : 4), name });
  await page.goto('/app/chess?days=7&sort=category');
  await axe(page);
  const bar = page.locator('.chess__bar', { hasText: name });
  await bar.scrollIntoViewIfNeeded();
  await bar.click();
  const panel = page.locator('[data-peek]');
  await expect(panel.getByRole('heading', { name })).toBeVisible();
  await panel.getByLabel(/Принять оплату/).check();
  await panel.getByRole('button', { name: 'Заселить' }).click();
  await expect(page).toHaveURL(/\/app\/chess/);
  await expect(page.getByText(new RegExp(`${name} заселён, оплата .* принята`))).toBeVisible();
  await expect(page.locator('.chess__bar--checked_in', { hasText: name })).toHaveCount(1);
});

test('drag to other days: preview, keep price, apply', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drag and drop is a desktop gesture');
  await signIn(page);
  const name = 'Сдвигов Антон';
  await newBooking(page, { category: 'Люкс с сауной (до 2 + 1 доп.)', from: day(150), to: day(152), name });
  await page.goto(`/app/chess?from=${day(148)}&days=14&sort=category`);
  const bar = page.locator('.chess__bar', { hasText: name });
  await bar.scrollIntoViewIfNeeded();
  const row = bar.locator('xpath=..');
  const box = await bar.boundingBox();
  // grab at the first night (day 150) and drop on day 153: three days later, same room
  const grab = await row.locator(`.chess__cell[data-date="${day(150)}"]`).boundingBox();
  const drop = await row.locator(`.chess__cell[data-date="${day(153)}"]`).boundingBox();
  await bar.dragTo(row.locator(`.chess__cell[data-date="${day(153)}"]`), {
    sourcePosition: { x: grab.x + grab.width * 0.75 - box.x, y: box.height / 2 },
    targetPosition: { x: drop.width * 0.75, y: drop.height / 2 },
  });
  const dlg = page.locator('[data-move-dialog]');
  await expect(dlg.getByText(/Было:/)).toBeVisible();
  const ru = (d) => d.split('-').reverse().join('.');
  await expect(dlg.getByText(new RegExp(`Станет: ${ru(day(153))} — ${ru(day(155))}`))).toBeVisible();
  await expect(dlg.getByLabel('Не менять цену проживания')).toBeChecked();
  await axe(page);
  await dlg.getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByText('Бронь перенесена')).toBeVisible();
  await expect(page.locator('.chess__bar', { hasText: name })).toHaveAttribute('data-checkin', day(153));
});

test('filters, search and collapsed categories', async ({ page, isMobile }) => {
  await signIn(page);
  const name = `Искомый ${isMobile ? 'М' : 'Д'}`;
  await newBooking(page, { category: 'Стандарт (до 2)', from: day(2), to: day(3), name });
  await page.goto('/app/chess?days=7&sort=category');
  await page.getByLabel('Найти бронь').fill(name.toLowerCase());
  await expect(page.locator('.chess__bar.is-hit', { hasText: name })).toHaveCount(1);
  await expect(page.getByText(/Показано \d+ из \d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить' }).click();
  await page.locator('label.chip', { hasText: 'каналы' }).click();
  await expect(page.locator('.chess__bar', { hasText: name })).toHaveClass(/is-dim/);
  await page.getByRole('button', { name: 'Сбросить' }).click();
  // collapse "Стандарт": its rooms hide, the category row stays
  const toggle = page.getByRole('button', { name: 'Стандарт', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-room-number="201"]')).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-room-number="201"]')).toBeHidden(); // remembered
  await page.getByRole('button', { name: 'Стандарт', exact: true }).click();
  await expect(page.locator('[data-room-number="201"]')).toBeVisible();
});
