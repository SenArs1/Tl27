// Price constructor for the marketing site. Stayra's own price list.
export const PROPERTY_TYPES = [
  { id: 'hotel', name: 'Городской отель', k: 1 },
  { id: 'mini', name: 'Мини-отель или хостел', k: 0.8 },
  { id: 'apartments', name: 'Апартаменты', k: 0.9 },
  { id: 'resort', name: 'Загородный отель или база отдыха', k: 1 },
  { id: 'glamping', name: 'Глэмпинг', k: 0.8 },
  { id: 'sanatorium', name: 'Санаторий', k: 1.2 },
];

// monthly: fixed fee per month; perRoom: fee per room per month; commission: % of stays
export const TOOLS = [
  { id: 'engine', product: 'booking-engine', name: 'Модуль онлайн-бронирования', commission: 3.5, monthly: 0, perRoom: 0, required: true },
  { id: 'channels', product: 'channel-manager', name: 'Менеджер каналов', monthly: 1900, perRoom: 25 },
  { id: 'pms', product: 'pms', name: 'Облачная PMS', monthly: 2900, perRoom: 45 },
  { id: 'site', product: 'website', name: 'Сайт отеля под ключ', monthly: 1500, perRoom: 0, setup: 29000 },
  { id: 'pricewatch', product: 'price-watch', name: 'Мониторинг цен конкурентов', monthly: 2400, perRoom: 0 },
  { id: 'reviews', product: 'reviews', name: 'Отзывы в одном окне', monthly: 1700, perRoom: 0 },
  { id: 'loyalty', product: 'loyalty', name: 'Клуб постоянных гостей', monthly: 0, perRoom: 0, included: true },
];

export const MAX_ROOMS = 2000;

export function quote({ type, rooms, tools }) {
  const pt = PROPERTY_TYPES.find((p) => p.id === type);
  const n = Number.parseInt(rooms, 10);
  if (!pt) return { ok: false, error: 'Выберите тип объекта' };
  if (!Number.isInteger(n) || n < 1 || n > MAX_ROOMS) return { ok: false, error: `Укажите от 1 до ${MAX_ROOMS} номеров` };
  const chosen = TOOLS.filter((t) => t.required || tools.includes(t.id));
  const lines = chosen.map((t) => {
    const monthly = Math.round((t.monthly + t.perRoom * n) * pt.k / 10) * 10;
    return { id: t.id, name: t.name, monthly, setup: t.setup || 0, commission: t.commission || 0, included: Boolean(t.included) };
  });
  // Bundle discount: 10% off the monthly part with 3+ paid tools.
  const paid = lines.filter((l) => l.monthly > 0);
  const gross = paid.reduce((s, l) => s + l.monthly, 0);
  const discount = paid.length >= 3 ? Math.round(gross * 0.1 / 10) * 10 : 0;
  return {
    ok: true,
    lines,
    monthly: gross - discount,
    discount,
    setup: lines.reduce((s, l) => s + l.setup, 0),
    commission: lines.reduce((s, l) => s + l.commission, 0),
  };
}
