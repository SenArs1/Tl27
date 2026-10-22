import { test, expect, axe } from './fixtures.js';

test('home: hero, tabs, faq, menu, axe', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Продавайте номера напрямую');
  await page.getByRole('tab', { name: 'Санаторий' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Длинные заезды');
  await page.getByText('Можно попробовать бесплатно?').click();
  await expect(page.getByText('откроем демо-кабинет')).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Продукты' }).click();
  await page.getByRole('link', { name: /Менеджер каналов/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Менеджер каналов' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: `replica/clone-screens/S01-S03-${isMobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
});

test('F07: price constructor updates live', async ({ page }) => {
  await page.goto('/price');
  const total = page.locator('[data-total]');
  const before = await total.textContent();
  await page.getByLabel('Сколько номеров').fill('60');
  await expect(total).not.toHaveText(before);
  await page.getByLabel('Отзывы в одном окне').check();
  await expect(page.getByText('Скидка за набор')).toBeVisible();
  await page.getByLabel('Сколько номеров').fill('0');
  await expect(page.getByText('Укажите от 1 до 2000 номеров')).toBeVisible();
  await axe(page);
});

test('F06: demo request with validation', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByText('Представьтесь, пожалуйста')).toBeVisible();
  await page.getByLabel('Имя').fill('Елена');
  await page.getByLabel('Телефон').fill('+7 911 000 11 22');
  await page.getByLabel('Номеров').fill('15');
  await page.getByLabel(/Согласен на обработку/).check();
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка отправлена' })).toBeVisible();
  await axe(page);
});

test('knowledge base search', async ({ page }) => {
  await page.goto('/support');
  await page.getByLabel('Поиск по статьям').fill('шахматк');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page.getByRole('link', { name: 'Как закрыть продажи на даты' })).toBeVisible();
  await page.getByLabel('Поиск по статьям').fill('квазар');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page.getByText('ничего нет')).toBeVisible();
});
