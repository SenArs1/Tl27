import { test, expect, axe, day, signIn } from './fixtures.js';

test('guest search with children: ages field appears and prices follow the age groups', async ({ page, isMobile }) => {
  const o = isMobile ? 140 : 130;
  await page.goto('/h/severny-bereg');
  await expect(page.getByLabel('Возраст детей')).toBeHidden();
  await page.getByLabel('Заезд').fill(day(o));
  await page.getByLabel('Выезд').fill(day(o + 2));
  await page.getByLabel(/Дети до \d+ лет/).fill('2');
  await expect(page.getByLabel('Возраст детей')).toBeVisible();
  await page.getByRole('button', { name: 'Найти номера' }).click();
  await expect(page.getByText(/Укажите возраст каждого ребёнка/)).toBeVisible();
  await page.getByLabel('Возраст детей').fill('1, 5');
  await page.getByRole('button', { name: 'Найти номера' }).click();
  await expect(page.getByRole('heading', { name: /дети: 1, 5/ })).toBeVisible();
  // Standard has no extra bed: a 5-year-old needs one, the baby does not
  await expect(page.getByRole('article', { name: 'Стандарт', exact: true }).getByText(/Вмещает/)).toBeVisible();
  await axe(page);
  await page.getByRole('link', { name: 'Выбрать: Стандарт с видом на озеро, Гибкий', exact: true }).click();
  await expect(page.getByText('Доп. места: 1 дет.')).toBeVisible();
});

test('owner adds an age group; the rate form gets a price field for it', async ({ page, isMobile }) => {
  await signIn(page);
  await page.goto('/app/settings/booking#ages');
  await expect(page.getByRole('cell', { name: 'Малыши' })).toBeVisible();
  const age = isMobile ? 16 : 17;
  await page.locator('#ages details.add summary').click();
  const add = page.locator('#ages details.add form');
  await add.getByLabel('Название').fill(`Подростки ${age}`);
  await add.getByLabel('До, лет (не включая)').fill(String(age));
  await add.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(`Группа «Подростки ${age}» добавлена`)).toBeVisible();
  await axe(page);
  await page.goto('/app/rooms#rates');
  await page.getByText('Добавить тариф').click();
  await expect(page.locator('#rates details.add').getByLabel(new RegExp(`Подростки ${age}`))).toBeVisible();
});

test('booking card: add guest documents, print card, mark sent in the MVD list', async ({ page, isMobile }) => {
  const o = isMobile ? 1 : 0;
  await signIn(page);
  await page.goto('/app/bookings/new');
  await page.getByLabel('Категория').selectOption({ label: 'Семейный (до 4 + 1 доп.)' });
  await page.getByLabel('Заезд', { exact: true }).fill(day(o));
  await page.getByLabel('Выезд', { exact: true }).fill(day(o + 2));
  await page.getByLabel('Взрослые').fill('1');
  await page.getByLabel('ФИО гостя').fill(`Смирнова Ольга ${isMobile ? 'М' : 'Д'}`);
  await page.getByLabel('Телефон').fill('+7 900 123-00-00');
  await page.getByRole('button', { name: 'Создать бронь' }).click();
  await expect(page.getByText(/создана/)).toBeVisible();

  await page.getByRole('link', { name: /Гости и МВД/ }).click();
  await page.locator('#guests details.add summary').click();
  const f = page.locator('#guests details.add form');
  await expect(f.getByLabel('Фамилия')).toHaveValue('Смирнова');
  await f.getByLabel('Дата рождения').fill('1988-04-12');
  await f.getByLabel('Серия').fill('4011');
  await f.getByLabel('Номер', { exact: true }).fill('112233');
  await f.getByLabel('Адрес регистрации (постоянный)').fill('г. Тестовск, ул. Примерная, 5');
  await f.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(/добавлен\(а\)/)).toBeVisible();
  await expect(page.locator('.guest-list small', { hasText: '4011 ••••33' })).toBeVisible();
  await axe(page);

  const [card] = await Promise.all([page.waitForEvent('popup'), page.getByRole('link', { name: 'Анкета для печати' }).click()]);
  await expect(card.getByRole('heading', { name: 'Анкета гостя' })).toBeVisible();
  await expect(card.getByText('4011 112233')).toBeVisible();
  await card.close();

  await page.goto(`/app/reports?tab=mvd&from=${day(-7)}&to=${day(2)}`);
  const row = page.getByRole('row', { name: new RegExp(`Смирнова Ольга ${isMobile ? 'М' : 'Д'}`) });
  await expect(row).toBeVisible();
  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Отметить выбранных: отправлено' }).click();
  await expect(page.getByText(/Отмечено гостей: 1/)).toBeVisible();
  await axe(page);
});
