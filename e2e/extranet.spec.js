import { test, expect, axe, day, signIn } from './fixtures.js';

test('F04: prices & availability cell edit is reflected in engine', async ({ page }) => {
  await signIn(page);
  await axe(page);
  await page.goto(`/app/prices?from=${day(80)}`);
  await page.getByRole('button', { name: /^Люкс с сауной, .*: свободно 2/ }).first().click();
  await page.getByLabel('Цена за ночь, ₽').fill('15500');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.cell__btn[data-price="15500"]')).toHaveCount(1);
  await axe(page);
  const j = await (await page.request.get(`/api/h/severny-bereg/offers?checkin=${day(80)}&checkout=${day(81)}&adults=2`)).json();
  // 15 500 ₽ + 2% tourist tax
  expect(j.offers.find((o) => o.room.name === 'Люкс с сауной').rates[0].total).toBe(15810);
});

test('chessboard: click an empty cell to book, drag the booking to another room', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drag and drop is a desktop gesture; mobile uses the move form in the booking card');
  await signIn(page);
  await page.goto(`/app/chess?from=${day(90)}&days=14&sort=category`);
  await axe(page);
  const row = page.locator('[data-room-number="402"]');
  await row.locator('.chess__cell').nth(2).click({ force: true });
  await expect(page.getByRole('heading', { name: 'Новая бронь' })).toBeVisible();
  await expect(page.getByLabel('Номер', { exact: true })).toHaveValue(/\d+/);
  await page.getByLabel('Выезд').fill(day(94));
  await page.getByLabel('ФИО гостя').fill('Шахматов Пётр');
  await page.getByLabel('Телефон').fill('+7 900 555-44-33');
  await page.getByRole('button', { name: 'Создать бронь' }).click();
  await expect(page.getByText(/Бронь SR-[0-9A-F]+ создана/)).toBeVisible();
  await expect(page.locator('dd', { hasText: '№ 402' })).toBeVisible();

  await page.goto(`/app/chess?from=${day(90)}&days=14&sort=category`);
  const bar = page.locator('.chess__bar', { hasText: 'Шахматов Пётр' });
  await expect(page.locator('[data-room-number="402"]').locator('.chess__bar')).toHaveCount(1);
  await bar.scrollIntoViewIfNeeded();
  // drop on the same days of room 404: only the room changes
  const startCell = page.locator('[data-room-number="404"]').locator(`.chess__cell[data-date="${day(92)}"]`);
  const box = await bar.boundingBox();
  await bar.dragTo(startCell, { sourcePosition: { x: 24, y: box.height / 2 }, targetPosition: { x: 24, y: 20 } });
  const dlg = page.locator('[data-move-dialog]');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText(/Станет:.*№ 404/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByText('Бронь перенесена')).toBeVisible();
  await expect(page.locator('[data-room-number="404"]').locator('.chess__bar', { hasText: 'Шахматов Пётр' })).toHaveCount(1);
  await page.screenshot({ path: 'replica/clone-screens/S24-chess-desktop.png', fullPage: false });
});

test('booking card: move via form, take payment, check in', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/bookings/new');
  await page.getByLabel('Категория').selectOption({ label: 'Семейный (до 4 + 1 доп.)' });
  await page.getByLabel('Заезд', { exact: true }).fill(day(0));
  await page.getByLabel('Выезд', { exact: true }).fill(day(1));
  await page.getByLabel('ФИО гостя').fill('Кассов Иван');
  await page.getByLabel('Телефон').fill('+7 900 555-00-11');
  await page.getByRole('button', { name: 'Создать бронь' }).click();
  await expect(page.getByText(/создана/)).toBeVisible();
  await page.getByRole('button', { name: 'Принять оплату' }).click();
  await expect(page.getByText('Оплачено полностью')).toBeVisible();
  await page.getByRole('button', { name: 'Заселить' }).click();
  await expect(page.getByText('Кассов Иван заселён')).toBeVisible();
  await axe(page);
});

test('F05/F08: channel test booking lands in the journal; add category, rooms and cancel a form', async ({ page, isMobile }) => {
  await signIn(page);
  await page.goto('/app/channels');
  const row = page.getByRole('row', { name: /TripGo/ });
  await row.getByRole('button', { name: 'Тестовая бронь' }).click();
  await expect(page.getByText(/Пришла бронь SR-.* из TripGo/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'TripGo' }).first()).toBeVisible();
  await axe(page);

  await page.goto('/app/rooms');
  // Cancel closes the add form
  await page.getByText('Добавить тариф').click();
  const rateForm = page.locator('#rates details.add form');
  await expect(rateForm).toBeVisible();
  await rateForm.getByRole('link', { name: 'Отмена' }).click();
  await expect(rateForm).toBeHidden();

  const name = `Шале ${isMobile ? 'M' : 'D'}`;
  await page.getByText('Добавить категорию').click();
  const add = page.locator('#types details.add');
  await add.getByLabel('Название').fill(name);
  await add.getByLabel('Основных мест').fill('4');
  await add.getByLabel('Дополнительных мест').fill('2');
  await add.getByLabel('Цена за ночь, ₽').fill('8800');
  await add.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(`Категория «${name}» добавлена`)).toBeVisible();
  await page.getByText('Добавить номера').click();
  const stock = page.locator('#stock details.add');
  await stock.getByLabel('Категория').selectOption({ label: name });
  await stock.getByLabel('Номера').fill(isMobile ? '701-702' : '601-603');
  await stock.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText(`Добавлено номеров: ${isMobile ? 2 : 3}`)).toBeVisible();
  await axe(page);

  const groupAdd = page.locator('details.add', { has: page.locator('summary', { hasText: 'Создать группу' }) });
  await groupAdd.locator('summary').click();
  await groupAdd.getByLabel('Название группы').fill(`Питание ${isMobile ? 'M' : 'D'}`);
  await groupAdd.getByRole('button', { name: 'Создать' }).click();
  await expect(page.getByText(/Группа «Питание .» создана/)).toBeVisible();

  for (const p of ['/app/bookings', '/app/reports', '/app/reports?tab=sales', '/app/reports?tab=lists', '/app/settings', '/app/settings/booking', '/app/settings/team', '/app/settings/properties']) {
    await page.goto(p);
    await axe(page);
  }
  await page.goto('/app');
  await page.screenshot({ path: `replica/clone-screens/S21-${isMobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
});

test('sign up a new property and land in an empty cabinet', async ({ page, isMobile }) => {
  await page.goto('/signup');
  await axe(page);
  await page.getByLabel('Название объекта').fill(`Гостевой дом ${isMobile ? 'М' : 'Д'}`);
  await page.getByLabel('Ваше имя').fill('Новый Владелец');
  await page.getByLabel('Почта для входа').fill(`owner-${isMobile ? 'm' : 'd'}-${Date.now()}@example.com`);
  await page.getByLabel(/Пароль/).fill('password123');
  await page.getByLabel(/Принимаю условия/).check();
  await page.getByRole('button', { name: 'Создать кабинет' }).click();
  await expect(page.getByText('Кабинет создан')).toBeVisible();
  await expect(page.getByText('Категорий пока нет')).toBeVisible();
  await page.goto('/app/chess');
  await expect(page.getByRole('heading', { name: 'Номеров пока нет' })).toBeVisible();
});

test('widget renders on a third-party page', async ({ page }) => {
  await page.goto('/widget-demo');
  await expect(page.locator('#stayra-booking').getByRole('button', { name: 'Найти номера' })).toBeVisible();
});

test('chessboard: drag the right edge of a booking to extend the stay', async ({ page, isMobile }) => {
  test.skip(isMobile, 'edge dragging is a desktop gesture; mobile uses the date form in the booking card');
  await signIn(page);
  await page.goto('/app/bookings/new');
  await page.getByLabel('Категория').selectOption({ label: 'Люкс с сауной (до 2 + 1 доп.)' });
  await page.getByLabel('Заезд', { exact: true }).fill(day(100));
  await page.getByLabel('Выезд', { exact: true }).fill(day(102));
  await page.getByLabel('ФИО гостя').fill('Растяжкин Олег');
  await page.getByLabel('Телефон').fill('+7 900 111-22-33');
  await page.getByRole('button', { name: 'Создать бронь' }).click();
  await expect(page.getByText(/создана/)).toBeVisible();

  await page.goto(`/app/chess?from=${day(99)}&days=14&sort=category`);
  const bar = page.locator('.chess__bar', { hasText: 'Растяжкин Олег' });
  const handle = bar.locator('.chess__handle--r');
  await handle.scrollIntoViewIfNeeded();
  const row = bar.locator('xpath=..');
  const target = row.locator(`.chess__cell[data-date="${day(104)}"]`);
  const h = await handle.boundingBox();
  const t = await target.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText(/Даты изменены: .* — .*/)).toBeVisible();
  await expect(page.locator('.chess__bar', { hasText: 'Растяжкин Олег' })).toHaveAttribute('data-checkout', day(104));
  await page.screenshot({ path: 'replica/clone-screens/S24-chess-resize-desktop.png' });
});

test('booking card: split the stay and change dates with the form', async ({ page, isMobile }) => {
  const o = isMobile ? 20 : 0;
  await signIn(page);
  await page.goto('/app/bookings/new');
  await page.getByLabel('Категория').selectOption({ label: 'Стандарт (до 2)' });
  await page.getByLabel('Заезд', { exact: true }).fill(day(110 + o));
  await page.getByLabel('Выезд', { exact: true }).fill(day(114 + o));
  await page.getByLabel('ФИО гостя').fill('Делёнкин Ян');
  await page.getByLabel('Телефон').fill('+7 900 777-66-55');
  await page.getByRole('button', { name: 'Создать бронь' }).click();
  await expect(page.getByText(/создана/)).toBeVisible();

  await page.getByLabel('Переселить с даты').fill(day(112 + o));
  await page.getByLabel('в номер', { exact: true }).selectOption({ label: '№ 305 — Стандарт с видом на озеро' });
  await page.getByRole('button', { name: 'Разделить проживание' }).click();
  await expect(page.getByText(/гость живёт в номере 305/)).toBeVisible();
  await expect(page.locator('dd', { hasText: '→ № 305' })).toBeVisible();
  await expect(page.locator('.segments li')).toHaveCount(2);
  await axe(page);

  await page.locator('#dt-checkout').fill(day(115 + o));
  await page.getByRole('button', { name: 'Изменить даты' }).click();
  await expect(page.getByText(/Даты изменены/)).toBeVisible();
});

test('prices: arrival ban set in the cell shows up and blocks the guest search', async ({ page }) => {
  await signIn(page);
  await page.goto(`/app/prices?from=${day(120)}`);
  await page.getByRole('button', { name: /^Семейный, .*: свободно/ }).first().click();
  await page.getByLabel('Запрет заезда в этот день').check();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.inv-flags', { hasText: 'нз' })).toHaveCount(1);
  await page.goto(`/h/severny-bereg/rooms?checkin=${day(120)}&checkout=${day(122)}&adults=2&children=0`);
  await expect(page.getByText('В этот день заезд не принимается')).toBeVisible();
});

test('rates: a derived rate is shown with its formula', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/rooms#rates');
  await expect(page.getByRole('cell', { name: /−12% от «Гибкий», округл. до 10 ₽/ })).toBeVisible();
});
