import { html, raw, rub, field } from './html.js';
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

export function hotelPage(hotel, rooms, query, errors) {
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
      ${rooms.length ? '' : html`<div class="card empty"><p>Отель ещё не открыл онлайн-продажи. Позвоните нам: ${hotel.phone || 'телефон уточняется'}</p></div>`}
      <div class="cards cards--2">${rooms.map((r) => html`<article class="card room-mini"><div class="room-img room-img--${r.image}" role="img" aria-label="Иллюстрация номера"></div><div><h3>${r.name}</h3><p class="muted">${r.area_m2} м² · ${capacityText(r)}</p><p>от ${rub(r.base_price)} за ночь</p></div></article>`)}</div>
    </section>`,
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

export function confirmationPage(hotel, b, room, rate, { justBooked = false, error } = {}) {
  const extras = JSON.parse(b.extras || '[]');
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
      <dl class="kv">
        <dt>Гость</dt><dd>${b.guest_name}</dd>
        <dt>Номер</dt><dd>${room.name}</dd>
        <dt>Тариф</dt><dd>${rate.name}</dd>
        <dt>Заезд</dt><dd>${fmtDate(b.checkin)}, с ${hotel.checkin_time}</dd>
        <dt>Выезд</dt><dd>${fmtDate(b.checkout)}, до ${hotel.checkout_time}</dd>
        <dt>Гости</dt><dd>${b.adults} взр.${b.children ? `, ${b.children} дет.` : ''}</dd>
        ${extras.length ? html`<dt>Допуслуги</dt><dd>${extras.map((e) => `${e.name} × ${e.qty}`).join(', ')}</dd>` : ''}
        <dt>Сумма</dt><dd><strong>${rub(b.total)}</strong>${b.discount_total ? html` <span class="muted">(скидка ${rub(b.discount_total)})</span>` : ''}</dd>
        ${b.tax_total ? html`<dt>в т.ч. тур. налог</dt><dd>${rub(b.tax_total)}</dd>` : ''}
        <dt>Оплата</dt><dd>${b.paid_amount ? `Оплачено ${rub(b.paid_amount)} картой (тест)${b.paid_amount < b.total ? `, остаток ${rub(b.total - b.paid_amount)} при заселении` : ''}` : 'При заселении'}</dd>
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
