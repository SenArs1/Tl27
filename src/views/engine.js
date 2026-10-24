import { html, raw, rub, field } from './html.js';
import { whenOf } from '../lib/hourly.js';
import { icon } from './icons.js';
import { engineLayout } from './layout.js';
import { addDays, fmtDate, nightsLabel, today, plural } from '../lib/dates.js';

const MEAL = { none: 'Без питания', breakfast: 'Завтрак включён', half: 'Завтрак и ужин' };
const STATUS = { confirmed: 'Подтверждена', checked_in: 'Гость заселён', checked_out: 'Гость выехал', cancelled: 'Отменена', no_show: 'Незаезд' };

export function statusBadge(s) {
  return html`<span class="badge badge--${s}">${STATUS[s] || s}</span>`;
}

function qs(query, extra = {}) {
  const p = new URLSearchParams({ checkin: query.checkin, checkout: query.checkout, adults: query.adults, children: query.children, ...(query.children && query.ages && query.ages.length ? { ages: query.ages.join(',') } : {}), ...(query.promo ? { promo: query.promo } : {}), ...extra });
  return p.toString();
}

export function searchForm(hotel, query, errors = {}) {
  const t = today();
  return html`<form class="search-bar card" method="get" action="/h/${hotel.slug}/rooms" novalidate data-search>
    ${field({ name: 'checkin', label: 'Заезд', type: 'date', value: query.checkin, error: errors.checkin, attrs: `min="${t}" required` })}
    ${field({ name: 'checkout', label: 'Выезд', type: 'date', value: query.checkout, error: errors.checkout, attrs: `min="${addDays(t, 1)}" required` })}
    ${field({ name: 'adults', label: 'Взрослые', type: 'number', value: query.adults, error: errors.adults, attrs: 'min="1" max="12" inputmode="numeric"' })}
    ${field({ name: 'children', label: `Дети до ${hotel.child_max_age ?? 12} лет`, type: 'number', value: query.children, error: errors.children, attrs: 'min="0" max="8" inputmode="numeric" data-children' })}
    <div data-ages-box ${query.children > 0 || errors.ages ? '' : raw('data-hidden-ages')}>${field({ name: 'ages', label: 'Возраст детей', value: (query.ages || []).join(', '), error: errors.ages, attrs: 'inputmode="numeric" autocomplete="off" placeholder="например: 4, 9"', hint: 'Через запятую, полных лет на дату заезда' })}</div>
    ${field({ name: 'promo', label: 'Промокод', value: query.promo, attrs: 'autocomplete="off" maxlength="32"' })}
    <button class="btn btn--accent btn--lg" type="submit">Найти номера</button>
  </form>`;
}

export function hotelPage(hotel, rooms, query, errors, hourly = { types: [], q: {} }, levels = []) {
  return engineLayout({
    title: 'Бронирование',
    hotel,
    body: html`<section class="engine-hero">
      <h1>${hotel.name}</h1>
      <p class="lead">${hotel.description}</p>
      <p class="muted">${hotel.city} · заезд с ${hotel.checkin_time}, выезд до ${hotel.checkout_time}</p>
    </section>
    ${searchForm(hotel, query, errors)}
    <section class="section-sm"><h2>Номера</h2>
      ${rooms.length || hourly.types.length ? '' : html`<div class="card empty"><p>Отель ещё не открыл онлайн-продажи. Позвоните нам: ${hotel.phone || 'телефон уточняется'}</p></div>`}
      <div class="cards cards--2">${rooms.map((r) => html`<article class="card room-mini"><div class="room-img room-img--${r.image}" role="img" aria-label="Иллюстрация номера"></div><div><h3>${r.name}</h3><p class="muted">${r.area_m2} м² · ${capacityText(r)}</p><p>от ${rub(r.base_price)} за ночь</p></div></article>`)}</div>
    </section>
    ${hourlySection(hotel, hourly.types, hourly.q)}
    ${loyaltySection(hotel, levels)}`,
  });
}

export function resultsPage(hotel, query, result) {
  const { offers, nights, guests, promo, promoInvalid } = result;
  const anyAvailable = offers.some((o) => o.available);
  return engineLayout({
    title: 'Выбор номера',
    hotel,
    body: html`${searchForm(hotel, query)}
    <ol class="progress" aria-label="Шаги бронирования"><li aria-current="step">Номер</li><li>Данные гостя</li><li>Готово</li></ol>
    <h1 class="h2">${fmtDate(query.checkin)} — ${fmtDate(query.checkout)}, ${nightsLabel(nights)}, ${guests} ${plural(guests, 'гость', 'гостя', 'гостей')}${query.ages && query.ages.length ? ` (дети: ${query.ages.join(', ')} ${plural(query.ages[query.ages.length - 1], 'год', 'года', 'лет')})` : ''}</h1>
    ${promo ? html`<p class="flash flash--success" role="status">Промокод ${promo.code} применён: −${promo.discount_pct}% на проживание</p>` : ''}
    ${promoInvalid ? html`<p class="flash flash--error" role="status">Промокод «${query.promo}» не найден — показываем цены без скидки</p>` : ''}
    ${anyAvailable ? '' : html`<div class="empty card"><h2 class="h3">На эти даты свободных номеров нет</h2><p>Попробуйте сдвинуть даты или позвоните нам: ${hotel.phone}</p>
      <p><a class="btn btn--secondary" href="/h/${hotel.slug}/rooms?${qs({ ...query, checkin: addDays(query.checkin, 1), checkout: addDays(query.checkout, 1) })}">Сдвинуть на день вперёд</a></p></div>`}
    <div class="offers">${offers.map((o) => offerCard(hotel, query, o, nights))}</div>`,
  });
}

function offerCard(hotel, query, o, nights) {
  const r = o.room;
  const reasonText = { capacity: `Вмещает ${capacityText(r)}`, sold_out: 'Нет свободных номеров на эти даты', min_stay: `Минимум ${nightsLabel(o.minStay)} на эти даты`, cta: 'В этот день заезд не принимается — попробуйте другую дату', ctd: 'В этот день выезд не принимается — попробуйте другую дату' }[o.reason];
  return html`<article class="card offer ${o.available ? '' : 'offer--off'}" aria-label="${r.name}">
    <div class="room-img room-img--${r.image}" role="img" aria-label="Иллюстрация номера"></div>
    <div class="offer__body">
      <h2 class="h3">${r.name}</h2>
      <p class="muted">${r.area_m2} м² · ${r.beds} · ${capacityText(r)}</p>
      <p>${r.description}</p>
      ${o.available && o.left <= 2 ? html`<p class="badge badge--warn">Осталось ${o.left} ${plural(o.left, 'номер', 'номера', 'номеров')}</p>` : ''}
      ${o.available ? html`<ul class="rates">${o.rates.map(({ rate, price }) => html`<li class="rate">
          <div><strong>${rate.name}</strong><span class="muted">${MEAL[rate.meal]} · ${rate.refundable ? 'бесплатная отмена' : 'без возврата'}</span>
          ${rate.description ? html`<small class="muted">${rate.description}</small>` : ''}</div>
          <div class="rate__price">${price.rateDiscount + price.promoDiscount ? html`<s class="muted">${rub(price.total + price.rateDiscount + price.promoDiscount)}</s>` : ''}<strong>${rub(price.total)}</strong><small class="muted">за ${nightsLabel(nights)}${price.extraAdults + price.extraChildren ? `, вкл. доп. места` : ''}${price.tax ? ', с налогом' : ''}</small></div>
          <a class="btn btn--primary" href="/h/${hotel.slug}/checkout?${qs(query, { room: r.id, rate: rate.id })}" aria-label="Выбрать: ${r.name}, ${rate.name}">Выбрать</a>
        </li>`)}</ul>`
        : html`<p class="badge badge--off">${reasonText}</p>`}
    </div>
  </article>`;
}

export function checkoutPage(hotel, { query, room, rate, price, extras, chosen = [], values = {}, errors = {}, idemKey, nights, formError }) {
  const exSum = extras.filter((e) => chosen.includes(e.id));
  return engineLayout({
    title: 'Данные гостя',
    hotel,
    body: html`<ol class="progress" aria-label="Шаги бронирования"><li><a href="/h/${hotel.slug}/rooms?${qs(query)}">Номер</a></li><li aria-current="step">Данные гостя</li><li>Готово</li></ol>
    <h1 class="h2">Почти готово</h1>
    ${formError ? html`<div class="flash flash--error" role="alert">${formError} <a href="/h/${hotel.slug}/rooms?${qs(query)}">Посмотреть другие номера</a></div>` : ''}
    <div class="checkout">
      <form class="card form" method="post" action="/h/${hotel.slug}/book" novalidate data-checkout-form>
        <input type="hidden" name="checkin" value="${query.checkin}"><input type="hidden" name="checkout" value="${query.checkout}">
        <input type="hidden" name="adults" value="${query.adults}"><input type="hidden" name="children" value="${query.children}"><input type="hidden" name="ages" value="${(query.ages || []).join(',')}">
        <input type="hidden" name="promo" value="${query.promo}"><input type="hidden" name="room" value="${room.id}"><input type="hidden" name="rate" value="${rate.id}">
        <input type="hidden" name="idem" value="${idemKey}">
        <h2 class="h3">Кто приедет</h2>
        ${field({ name: 'guest_name', label: 'Имя и фамилия', value: values.guest_name, error: errors.guest_name, attrs: 'autocomplete="name" required' })}
        ${field({ name: 'guest_email', label: 'Почта', type: 'email', value: values.guest_email, error: errors.guest_email, attrs: 'autocomplete="email" required', hint: 'Пришлём подтверждение и ссылку на бронь' })}
        ${field({ name: 'guest_phone', label: 'Телефон', type: 'tel', value: values.guest_phone, error: errors.guest_phone, attrs: 'autocomplete="tel" required' })}
        ${field({ name: 'comment', label: 'Пожелания (необязательно)', type: 'textarea', value: values.comment })}
        ${extras.length ? html`<fieldset class="extras"><legend class="h3">Добавить к брони</legend>
          ${groupExtras(extras).map(([group, list]) => html`${group ? html`<p class="extras__group">${group}</p>` : ''}${list.map((e) => html`<label class="check extra"><input type="checkbox" name="extras" value="${e.id}" data-price="${e.price}" data-per="${e.per}" ${chosen.includes(e.id) ? raw('checked') : ''}>
            <span><strong>${e.name}</strong> — ${rub(e.price)} ${e.per === 'stay' ? 'за всё' : e.per === 'night' ? 'за ночь' : 'за гостя в ночь'}<small class="muted">${e.description}</small></span></label>`)}`)}
        </fieldset>` : ''}
        ${hotel.loyalty_on ? html`<fieldset class="loyalty-box"><legend class="h3">Участник программы «${hotel.loyalty_name}»?</legend>
          <p class="muted">Укажите номер карты — скидка вашего уровня применится к проживанию, а баллами можно оплатить до ${hotel.loyalty_redeem_pct}% брони. Почта должна совпадать с почтой участника. Нет карты? <a href="/h/${hotel.slug}#loyalty">Вступить в программу</a></p>
          ${field({ name: 'card_no', label: 'Номер карты (необязательно)', value: values.card_no, error: errors.card_no, attrs: 'inputmode="numeric" autocomplete="off" maxlength="12"' })}
          ${field({ name: 'points', label: 'Оплатить баллами (необязательно)', type: 'number', value: values.points, error: errors.points, attrs: 'min="0" inputmode="numeric"' })}
        </fieldset>` : ''}
        <fieldset><legend class="h3">Оплата</legend>
          ${hotel.pay_at_hotel ? html`<label class="check"><input type="radio" name="payment" value="hotel" ${values.payment !== 'card' ? raw('checked') : ''}><span>При заселении</span></label>` : ''}
          ${hotel.pay_card ? html`<label class="check"><input type="radio" name="payment" value="card" ${values.payment === 'card' || !hotel.pay_at_hotel ? raw('checked') : ''}><span>Картой сейчас${hotel.prepay_pct && hotel.prepay_pct < 100 ? ` — предоплата ${hotel.prepay_pct}%` : ''} <small class="muted">(тестовый режим, деньги не списываются)</small></span></label>` : ''}
        </fieldset>
        ${hotel.cancel_policy ? html`<p class="muted"><strong>Условия отмены.</strong> ${hotel.cancel_policy}</p>` : ''}
        <label class="check"><input type="checkbox" name="agree" ${values.agree ? raw('checked') : ''} required><span>Согласен с условиями тарифа и обработкой персональных данных</span></label>
        ${errors.agree ? html`<p class="field-error">${errors.agree}</p>` : ''}
        <button class="btn btn--accent btn--lg btn--block" type="submit" data-submit>Забронировать</button>
      </form>
      <aside class="card summary" aria-label="Ваша бронь">
        <div class="room-img room-img--${room.image}" role="img" aria-label="Иллюстрация номера"></div>
        <h2 class="h3">${room.name}</h2>
        <p>${rate.name} · ${MEAL[rate.meal]} · ${rate.refundable ? 'бесплатная отмена' : 'без возврата'}</p>
        <dl class="kv"><dt>Заезд</dt><dd>${fmtDate(query.checkin)}, с ${hotel.checkin_time}</dd><dt>Выезд</dt><dd>${fmtDate(query.checkout)}, до ${hotel.checkout_time}</dd><dt>Гости</dt><dd>${query.adults} взр.${query.children ? `, ${query.children} дет.` : ''}</dd></dl>
        <ul class="quote" data-summary data-nights="${nights}" data-guests="${query.adults + query.children}" data-stay="${price.total}">
          <li><span>Проживание, ${nightsLabel(nights)}</span><span>${rub(price.base)}</span></li>
          ${price.extraBeds ? html`<li><span>Доп. места: ${price.extraAdults ? `${price.extraAdults} взр.` : ''}${price.extraAdults && price.extraChildren ? ', ' : ''}${price.extraChildren ? `${price.extraChildren} дет.` : ''}</span><span>${rub(price.extraBeds)}</span></li>` : ''}
          ${price.meals ? html`<li><span>Питание</span><span>${rub(price.meals)}</span></li>` : ''}
          ${price.rateDiscount ? html`<li><span>Скидка тарифа</span><span>−${rub(price.rateDiscount)}</span></li>` : ''}
          ${price.promoDiscount ? html`<li><span>Промокод ${query.promo}</span><span>−${rub(price.promoDiscount)}</span></li>` : ''}
          ${price.tax ? html`<li><span>Туристический налог</span><span>${rub(price.tax)}</span></li>` : ''}
          ${exSum.map((e) => html`<li><span>${e.name}</span><span></span></li>`)}
        </ul>
        <p class="quote__total"><span>Итого</span><strong data-grand>${rub(price.total)}</strong></p>
      </aside>
    </div>`,
  });
}

export function confirmationPage(hotel, b, room, rate, { justBooked = false, error, pointsPaid = 0, note } = {}) {
  const extras = JSON.parse(b.extras || '[]');
  const card = b.paid_amount - pointsPaid;
  const payParts = [card > 0 ? `${rub(card)} картой (тест)` : '', pointsPaid > 0 ? `${rub(pointsPaid)} баллами «${hotel.loyalty_name}»` : ''].filter(Boolean);
  return engineLayout({
    title: `Бронь ${b.code}`,
    hotel,
    body: html`${justBooked ? html`<ol class="progress" aria-label="Шаги бронирования"><li>Номер</li><li>Данные гостя</li><li aria-current="step">Готово</li></ol>` : ''}
    <div class="card confirm">
      ${b.status === 'cancelled'
        ? html`<h1 class="h2">Бронь отменена</h1>`
        : html`<span class="card__icon card__icon--ok">${icon('check', 28)}</span><h1 class="h2">${justBooked ? 'Номер забронирован' : 'Ваше бронирование'}</h1>`}
      <p class="confirm__code">Номер брони: <strong data-code>${b.code}</strong> ${statusBadge(b.status)}</p>
      ${error ? html`<p class="flash flash--error" role="alert">${error}</p>` : ''}
      ${note ? html`<p class="flash flash--success" role="status">${note}</p>` : ''}
      <dl class="kv">
        <dt>Гость</dt><dd>${b.guest_name}</dd>
        <dt>Номер</dt><dd>${room.name}</dd>
        <dt>Тариф</dt><dd>${rate.name}</dd>
        ${b.start_at ? html`<dt>Время</dt><dd>${whenOf(b)}</dd>` : html`<dt>Заезд</dt><dd>${fmtDate(b.checkin)}, с ${hotel.checkin_time}</dd>
        <dt>Выезд</dt><dd>${fmtDate(b.checkout)}, до ${hotel.checkout_time}</dd>`}
        <dt>Гости</dt><dd>${b.adults} взр.${b.children ? `, ${b.children} дет.` : ''}</dd>
        ${extras.length ? html`<dt>Допуслуги</dt><dd>${extras.map((e) => `${e.name} × ${e.qty}`).join(', ')}</dd>` : ''}
        <dt>Сумма</dt><dd><strong>${rub(b.total)}</strong>${b.discount_total ? html` <span class="muted">(скидка ${rub(b.discount_total)})</span>` : ''}</dd>
        ${b.tax_total ? html`<dt>в т.ч. тур. налог</dt><dd>${rub(b.tax_total)}</dd>` : ''}
        ${b.loyalty_discount ? html`<dt>Скидка участника</dt><dd>${rub(b.loyalty_discount)}</dd>` : ''}
        <dt>Оплата</dt><dd>${b.paid_amount ? `Оплачено ${payParts.join(' и ')}${b.paid_amount < b.total ? `, остаток ${rub(b.total - b.paid_amount)} при заселении` : ''}` : 'При заселении'}</dd>
      </dl>
      ${b.status === 'confirmed' ? html`<form method="post" action="/h/${hotel.slug}/booking/${b.code}/cancel" data-confirm="${rate.refundable ? 'Отменить бронь?' : 'Тариф невозвратный: оплата не вернётся. Всё равно отменить?'}">
        <input type="hidden" name="email" value="${b.guest_email}">
        ${rate.refundable ? '' : html`<p class="muted">Тариф без возврата: при отмене оплата не возвращается.</p>`}
        <button class="btn btn--danger" type="submit">Отменить бронь</button>
      </form>` : ''}
      <p class="muted">Сохраните номер брони. Найти её снова можно на странице <a href="/h/${hotel.slug}/manage">«Моё бронирование»</a>.</p>
    </div>`,
  });
}

export function managePage(hotel, { values = {}, error }) {
  return engineLayout({
    title: 'Моё бронирование',
    hotel,
    body: html`<div class="container--narrow"><h1 class="h2">Найти бронирование</h1>
      <form class="card form" method="post" action="/h/${hotel.slug}/manage" novalidate>
        ${error ? html`<p class="flash flash--error" role="alert">${error}</p>` : ''}
        ${field({ name: 'code', label: 'Номер брони', value: values.code, attrs: 'required autocomplete="off" placeholder="SR-XXXXXXXX"' })}
        ${field({ name: 'email', label: 'Почта, указанная при бронировании', type: 'email', value: values.email, attrs: 'required autocomplete="email"' })}
        <button class="btn btn--primary btn--block" type="submit">Найти</button>
      </form></div>`,
  });
}

function capacityText(r) {
  return `до ${r.capacity} ${plural(r.capacity, 'гостя', 'гостей', 'гостей')}${r.extra_beds ? ` + ${r.extra_beds} доп. ${plural(r.extra_beds, 'место', 'места', 'мест')}` : ''}`;
}

function groupExtras(extras) {
  const m = new Map();
  for (const e of extras) {
    const k = e.group_name || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return [...m.entries()];
}

// ---------- hourly stays ----------
const hqs = (q, extra = {}) => new URLSearchParams({ date: q.date, start: q.start, hours: q.hours, adults: q.adults || 1, ...extra }).toString();

function hourTimes(types) {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const from = Math.min(...types.map((t) => toMin(t.open_from)));
  const to = Math.max(...types.map((t) => toMin(t.open_to)));
  const out = [];
  for (let m = from; m < to; m += 30) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return out;
}

export function hourlySearchForm(hotel, types, q, errors = {}) {
  const t = today();
  return html`<form class="search-bar card" method="get" action="/h/${hotel.slug}/hourly" novalidate>
    ${field({ prefix: 'hr', name: 'date', label: 'Дата', type: 'date', value: q.date, error: errors.date, attrs: `min="${t}" required` })}
    ${field({ prefix: 'hr', name: 'start', label: 'Начало', type: 'select', value: q.start, error: errors.start, options: hourTimes(types).map((x) => [x, x]) })}
    ${field({ prefix: 'hr', name: 'hours', label: 'Часов', type: 'number', value: q.hours, error: errors.hours, attrs: 'min="1" max="24" inputmode="numeric" required' })}
    ${field({ prefix: 'hr', name: 'adults', label: 'Гостей', type: 'number', value: q.adults || 1, attrs: 'min="1" max="12" inputmode="numeric"' })}
    <button class="btn btn--accent btn--lg" type="submit">Найти по часам</button>
  </form>`;
}

export function hourlySection(hotel, types, q) {
  if (!types.length) return '';
  return html`<section class="section-sm" id="hourly"><h2>По часам</h2>
    <p class="muted">${types.map((t) => `${t.name} — ${rub(t.hour_price)} в час, от ${t.min_hours} ч`).join(' · ')}</p>
    ${hourlySearchForm(hotel, types, q)}</section>`;
}

export function hourlyResultsPage(hotel, types, q, offers, errors = null) {
  if (errors) {
    return engineLayout({ title: 'Почасовое бронирование', hotel, body: html`<h1 class="h2">Почасовое бронирование</h1>${hourlySearchForm(hotel, types, q, errors)}` });
  }
  return engineLayout({
    title: 'Почасовое бронирование',
    hotel,
    body: html`${hourlySearchForm(hotel, types, q)}
    <ol class="progress" aria-label="Шаги бронирования"><li aria-current="step">Номер</li><li>Данные гостя</li><li>Готово</li></ol>
    <h1 class="h2">${fmtDate(q.date)}, ${q.start}–${q.endAt.slice(11)}, ${q.hours} ч</h1>
    ${offers.some((o) => o.available) ? '' : html`<div class="empty card"><h2 class="h3">На это время свободных номеров нет</h2><p>Попробуйте другое время или позвоните нам: ${hotel.phone}</p></div>`}
    <div class="offers">${offers.map((o) => html`<article class="card offer ${o.available ? '' : 'offer--off'}" aria-label="${o.type.name}">
      <div class="room-img room-img--${o.type.image}" role="img" aria-label="Иллюстрация номера"></div>
      <div class="offer__body"><h2 class="h3">${o.type.name}</h2>
        <p class="muted">${o.type.description}</p>
        <p class="muted">${capacityText(o.type)} · ${rub(o.type.hour_price)} в час · от ${o.type.min_hours} до ${o.type.max_hours} ч · уборка ${o.type.buffer_min} мин между гостями</p>
        ${o.available ? html`<p class="offer__price"><strong>${rub(o.price)}</strong> за ${q.hours} ч</p>
          <a class="btn btn--accent" href="/h/${hotel.slug}/hourly/checkout?${hqs(q, { type: o.type.id })}">Выбрать</a>`
          : html`<p class="muted">${o.reason}</p>`}
      </div></article>`)}</div>`,
  });
}

export function hourlyCheckoutPage(hotel, { q, type, price, tax, values = {}, errors = {}, idemKey, formError }) {
  return engineLayout({
    title: 'Данные гостя',
    hotel,
    body: html`<ol class="progress" aria-label="Шаги бронирования"><li><a href="/h/${hotel.slug}/hourly?${hqs(q)}">Номер</a></li><li aria-current="step">Данные гостя</li><li>Готово</li></ol>
    <h1 class="h2">Почти готово</h1>
    ${formError ? html`<div class="flash flash--error" role="alert">${formError} <a href="/h/${hotel.slug}/hourly?${hqs(q)}">Выбрать другое время</a></div>` : ''}
    <div class="checkout">
      <form class="card form" method="post" action="/h/${hotel.slug}/hourly/book" novalidate>
        <input type="hidden" name="date" value="${q.date}"><input type="hidden" name="start" value="${q.start}"><input type="hidden" name="hours" value="${q.hours}">
        <input type="hidden" name="adults" value="${q.adults}"><input type="hidden" name="type" value="${type.id}"><input type="hidden" name="idem" value="${idemKey}">
        <h2 class="h3">Кто приедет</h2>
        ${field({ name: 'guest_name', label: 'Имя и фамилия', value: values.guest_name, error: errors.guest_name, attrs: 'autocomplete="name" required' })}
        ${field({ name: 'guest_email', label: 'Почта', type: 'email', value: values.guest_email, error: errors.guest_email, attrs: 'autocomplete="email" required', hint: 'Пришлём подтверждение и ссылку на бронь' })}
        ${field({ name: 'guest_phone', label: 'Телефон', type: 'tel', value: values.guest_phone, error: errors.guest_phone, attrs: 'autocomplete="tel" required' })}
        ${field({ name: 'comment', label: 'Пожелания (необязательно)', type: 'textarea', value: values.comment })}
        <p class="muted">Оплата — на месте.${hotel.cancel_policy ? ` ${hotel.cancel_policy}` : ''}</p>
        <label class="check"><input type="checkbox" name="agree" ${values.agree ? raw('checked') : ''} required><span>Согласен с условиями и обработкой персональных данных</span></label>
        ${errors.agree ? html`<p class="field-error">${errors.agree}</p>` : ''}
        <button class="btn btn--accent btn--lg btn--block" type="submit">Забронировать</button>
      </form>
      <aside class="card summary" aria-label="Ваша бронь">
        <div class="room-img room-img--${type.image}" role="img" aria-label="Иллюстрация номера"></div>
        <h2 class="h3">${type.name}</h2>
        <dl class="kv"><dt>Дата</dt><dd>${fmtDate(q.date)}</dd><dt>Время</dt><dd>${q.start}–${q.endAt.slice(11)}, ${q.hours} ч</dd><dt>Гости</dt><dd>${q.adults}</dd></dl>
        <ul class="quote"><li><span>${q.hours} ч × ${rub(type.hour_price)}</span><span>${rub(price)}</span></li>${tax ? html`<li><span>Туристический налог</span><span>${rub(tax)}</span></li>` : ''}</ul>
        <p class="quote__total"><span>Итого</span><strong>${rub(price + tax)}</strong></p>
      </aside>
    </div>`,
  });
}

// ---------- loyalty program on the hotel site ----------
export function loyaltySection(hotel, levels) {
  if (!hotel.loyalty_on) return '';
  return html`<section class="section-sm" id="loyalty"><h2>Программа «${hotel.loyalty_name}»</h2>
    <p>Бронируйте напрямую на этом сайте и копите баллы: они начисляются после выезда, 1 балл = 1 ₽. Баллами можно оплатить до ${hotel.loyalty_redeem_pct}% следующей брони.${hotel.loyalty_welcome ? ` За вступление — ${hotel.loyalty_welcome.toLocaleString('ru-RU')} баллов.` : ''}</p>
    ${levels.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Уровни программы"><table class="table table--compact">
      <thead><tr><th scope="col">Уровень</th><th scope="col">Когда</th><th scope="col">Скидка на проживание</th><th scope="col">Баллы с проживания</th></tr></thead>
      <tbody>${levels.map((l) => html`<tr><td>${l.name}</td><td>${l.min_spent ? `от ${rub(l.min_spent)} за проживания` : 'сразу'}</td><td>${l.discount_pct ? `${l.discount_pct}%` : '—'}</td><td>${l.earn_pct}%</td></tr>`)}</tbody></table></div>` : ''}
    <div class="cards cards--2">
      <form class="card form" method="post" action="/h/${hotel.slug}/loyalty/join" novalidate><h3>Вступить</h3>
        ${field({ prefix: 'lj', name: 'name', label: 'Имя и фамилия', attrs: 'required autocomplete="name"' })}
        ${field({ prefix: 'lj', name: 'email', label: 'Почта', type: 'email', attrs: 'required autocomplete="email"' })}
        ${field({ prefix: 'lj', name: 'phone', label: 'Телефон (необязательно)', type: 'tel', attrs: 'autocomplete="tel"' })}
        <label class="check"><input type="checkbox" name="agree" required><span>Согласен с условиями программы и обработкой персональных данных</span></label>
        <button class="btn btn--primary" type="submit">Получить карту</button></form>
      <form class="card form" method="post" action="/h/${hotel.slug}/loyalty/login" novalidate><h3>Уже участник</h3>
        ${field({ prefix: 'll', name: 'card_no', label: 'Номер карты', attrs: 'required inputmode="numeric" autocomplete="off"' })}
        ${field({ prefix: 'll', name: 'email', label: 'Почта', type: 'email', attrs: 'required autocomplete="email"' })}
        <button class="btn btn--secondary" type="submit">Открыть кабинет</button></form>
    </div></section>`;
}

const TX = { welcome: 'Приветственные баллы', earn: 'Начислено за проживание', redeem: 'Оплата брони', return: 'Возврат баллов', revert: 'Отмена начисления', adjust: 'Корректировка' };

export function loyaltyFormPage(hotel, { title, error, values = {}, join = false }) {
  return engineLayout({
    title,
    hotel,
    body: html`<div class="container--narrow"><h1 class="h2">${title}</h1>
      ${error ? html`<p class="flash flash--error" role="alert">${error}</p>` : ''}
      ${join ? html`<form class="card form" method="post" action="/h/${hotel.slug}/loyalty/join" novalidate>
        ${field({ prefix: 'lj', name: 'name', label: 'Имя и фамилия', value: values.name, attrs: 'required autocomplete="name"' })}
        ${field({ prefix: 'lj', name: 'email', label: 'Почта', type: 'email', value: values.email, attrs: 'required autocomplete="email"' })}
        ${field({ prefix: 'lj', name: 'phone', label: 'Телефон (необязательно)', type: 'tel', value: values.phone, attrs: 'autocomplete="tel"' })}
        <label class="check"><input type="checkbox" name="agree" ${values.agree ? raw('checked') : ''} required><span>Согласен с условиями программы и обработкой персональных данных</span></label>
        <button class="btn btn--primary btn--block" type="submit">Получить карту</button></form>`
      : html`<form class="card form" method="post" action="/h/${hotel.slug}/loyalty/login" novalidate>
        ${field({ prefix: 'll', name: 'card_no', label: 'Номер карты', value: values.card_no, attrs: 'required inputmode="numeric" autocomplete="off"' })}
        ${field({ prefix: 'll', name: 'email', label: 'Почта', type: 'email', value: values.email, attrs: 'required autocomplete="email"' })}
        <button class="btn btn--primary btn--block" type="submit">Открыть кабинет</button></form>`}
      <p class="muted"><a href="/h/${hotel.slug}#loyalty">О программе</a></p></div>`,
  });
}

export function loyaltyCardPage(hotel, { m, history, bookings, link, fresh = false }) {
  const pct = m.next ? Math.min(100, Math.round((m.spent / m.next.min_spent) * 100)) : 100;
  return engineLayout({
    title: `Карта ${m.card_no}`,
    hotel,
    body: html`<div class="container--narrow">
      ${fresh ? html`<p class="flash flash--success" role="status">Добро пожаловать в программу! Сохраните номер карты — по нему и почте вы входите в кабинет и получаете скидку при бронировании.</p>` : ''}
      <section class="card loyalty-card">
        <p class="muted">${hotel.name} · программа «${hotel.loyalty_name}»</p>
        <h1 class="h2">${m.name}</h1>
        <p class="loyalty-card__no">Карта <strong data-card>${m.card_no}</strong></p>
        <dl class="kv"><dt>Баллы</dt><dd><strong>${m.points.toLocaleString('ru-RU')}</strong> (1 балл = 1 ₽)</dd><dt>Уровень</dt><dd>${m.level.name}${m.level.discount_pct ? `, скидка ${m.level.discount_pct}% на проживание` : ''}, начисление ${m.level.earn_pct}%</dd>
          <dt>Проживаний</dt><dd>${m.stays}, на ${rub(m.spent)}</dd></dl>
        ${m.next ? html`<p>До уровня «${m.next.name}» — ${rub(m.toNext)} проживаний</p>
          <div class="meter" role="progressbar" aria-label="Путь до следующего уровня" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>` : html`<p>У вас высший уровень программы.</p>`}
        <p><a class="btn btn--accent" href="/h/${hotel.slug}">Забронировать со скидкой</a></p>
      </section>
      <section class="card"><h2 class="h3">История баллов</h2>
        ${history.length ? html`<ul class="mini-list">${history.map((t) => html`<li><span>${t.created_at.slice(0, 10).split('-').reverse().join('.')} · ${TX[t.kind] || t.kind}${t.code ? ` (${t.code})` : ''}</span><strong>${t.points > 0 ? '+' : '−'}${Math.abs(t.points).toLocaleString('ru-RU')}</strong></li>`)}</ul>` : html`<p class="muted">Пока пусто.</p>`}
      </section>
      <section class="card"><h2 class="h3">Мои брони</h2>
        ${bookings.length ? html`<ul class="mini-list">${bookings.map((b) => html`<li><span><a href="${b.link}">${b.code}</a> · ${b.start_at ? whenOf(b) : `${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}`}</span>${statusBadge(b.status)}</li>`)}</ul>` : html`<p class="muted">Броней пока нет.</p>`}
      </section>
      <form method="post" action="${link}/leave" data-confirm="Выйти из программы? Баллы сгорят, ваши данные участника будут удалены.">
        <button class="btn btn--ghost btn--sm" type="submit">Выйти из программы</button></form>
    </div>`,
  });
}
