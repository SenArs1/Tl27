import { html, raw, rub, field } from './html.js';
import { appLayout } from './layout.js';
import { csrf } from './app.js';
import { statusBadge } from './engine.js';
import { fmtDate } from '../lib/dates.js';

export const TX_KIND = { welcome: 'приветственные', earn: 'начислено за проживание', redeem: 'оплата брони', return: 'возврат баллов', revert: 'отмена начисления', adjust: 'вручную' };
const pts = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ru-RU')}`;

function loyaltyNav(req, active) {
  const tabs = [['/app/loyalty', 'Участники'], ['/app/loyalty/settings', 'Условия программы']];
  return html`<nav class="subnav" aria-label="Разделы программы лояльности">${tabs.map(([href, label]) => html`<a href="${href}" ${href === active ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>`;
}

export function levelBadge(level) {
  return html`<span class="badge badge--level">${level.name}${level.discount_pct ? ` · −${level.discount_pct}%` : ''}</span>`;
}

export function membersPage({ req, hotel, msg, members, q, totals }) {
  return appLayout({
    title: `Программа лояльности «${hotel.loyalty_name}»`,
    req,
    hotel,
    msg,
    body: html`${loyaltyNav(req, '/app/loyalty')}
    ${hotel.loyalty_on ? '' : html`<div class="flash flash--error" role="status">Программа выключена: гости не видят её на сайте, баллы не начисляются. Включите её в «Условиях программы».</div>`}
    <div class="tiles-stat">
      <div class="stat-tile"><span>Участников</span><strong>${totals.members}</strong></div>
      <div class="stat-tile"><span>Баллов на счетах</span><strong>${totals.points.toLocaleString('ru-RU')}</strong></div>
      <div class="stat-tile"><span>Броней участников за 30 дней</span><strong>${totals.bookings30}</strong></div>
    </div>
    <form class="filters card" method="get" action="/app/loyalty">
      ${field({ prefix: 'lq', name: 'q', label: 'Поиск', value: q, attrs: 'placeholder="Имя, почта, телефон или номер карты"' })}
      <button class="btn btn--primary" type="submit">Найти</button>
    </form>
    <details class="add card"><summary class="btn btn--secondary">+ Записать гостя в программу</summary>
      <form class="form form--grid" method="post" action="/app/loyalty">${csrf(req)}
        ${field({ prefix: 'ln', name: 'name', label: 'Имя и фамилия', attrs: 'required maxlength="120"' })}
        ${field({ prefix: 'ln', name: 'email', label: 'Почта', type: 'email', attrs: 'required' })}
        ${field({ prefix: 'ln', name: 'phone', label: 'Телефон', type: 'tel' })}
        <p class="muted span-all">Гость получит номер карты. Сообщите его гостю: по номеру карты и почте он входит в личный кабинет участника и получает скидку на сайте.</p>
        <div class="actions span-all"><button class="btn btn--primary" type="submit">Записать</button><a class="btn btn--ghost" href="/app/loyalty" data-close-details>Отмена</a></div>
      </form></details>
    ${members.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Участники программы"><table class="table">
      <thead><tr><th scope="col">Участник</th><th scope="col">Карта</th><th scope="col">Уровень</th><th scope="col">Баллы</th><th scope="col">Проживаний</th><th scope="col">Потрачено</th></tr></thead>
      <tbody>${members.map((m) => html`<tr><td><a href="/app/loyalty/${m.id}">${m.name}</a><small class="muted">${m.email}${m.phone ? ` · ${m.phone}` : ''}</small></td>
        <td>${m.card_no}</td><td>${levelBadge(m.level)}</td><td>${m.points.toLocaleString('ru-RU')}</td><td>${m.stays}</td><td>${rub(m.spent)}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty"><p>${q ? 'Никого не нашли.' : 'Участников пока нет. Гости записываются сами на странице бронирования или вы записываете их здесь и в карточке брони.'}</p></div>`}`,
  });
}

export function memberPage({ req, hotel, msg, m, history, bookings }) {
  return appLayout({
    title: m.name,
    req,
    hotel,
    msg,
    body: html`<p><a href="/app/loyalty">← Все участники</a></p>
    <div class="tiles-stat">
      <div class="stat-tile"><span>Баллы</span><strong>${m.points.toLocaleString('ru-RU')}</strong></div>
      <div class="stat-tile"><span>Уровень</span><strong>${m.level.name}</strong></div>
      <div class="stat-tile"><span>Скидка / начисление</span><strong>${m.level.discount_pct}% / ${m.level.earn_pct}%</strong></div>
      <div class="stat-tile"><span>${m.next ? `До уровня «${m.next.name}»` : 'Высший уровень'}</span><strong>${m.next ? rub(m.toNext) : '✓'}</strong></div>
    </div>
    <div class="app-cols">
      <section class="card"><h2 class="h3">Участник</h2>
        <dl class="kv"><dt>Карта</dt><dd>${m.card_no}</dd><dt>Почта</dt><dd>${m.email}</dd><dt>Телефон</dt><dd>${m.phone || '—'}</dd>
          <dt>В программе с</dt><dd>${fmtDate(m.created_at.slice(0, 10))}</dd><dt>Проживаний</dt><dd>${m.stays}, на ${rub(m.spent)}</dd></dl>
        <details class="add"><summary class="btn btn--secondary">Изменить контакты</summary>
          <form class="form form--grid" method="post" action="/app/loyalty/${m.id}">${csrf(req)}
            ${field({ prefix: 'me', name: 'name', label: 'Имя', value: m.name, attrs: 'required maxlength="120"' })}
            ${field({ prefix: 'me', name: 'email', label: 'Почта', type: 'email', value: m.email, attrs: 'required' })}
            ${field({ prefix: 'me', name: 'phone', label: 'Телефон', type: 'tel', value: m.phone })}
            <div class="actions span-all"><button class="btn btn--primary" type="submit">Сохранить</button><a class="btn btn--ghost" href="/app/loyalty/${m.id}" data-close-details>Отмена</a></div></form></details>
        <form class="member-delete" method="post" action="/app/loyalty/${m.id}/delete" data-confirm="Исключить ${m.name} из программы? Баллы и история сгорят, контакты участника будут удалены. Брони останутся.">${csrf(req)}
          <button class="btn btn--danger btn--sm" type="submit">Исключить из программы</button></form>
      </section>
      <section class="card"><h2 class="h3">Начислить или списать вручную</h2>
        <form class="form form--grid" method="post" action="/app/loyalty/${m.id}/adjust">${csrf(req)}
          ${field({ prefix: 'ad', name: 'points', label: 'Баллы', type: 'number', attrs: 'required', hint: 'Со знаком минус — списание' })}
          ${field({ prefix: 'ad', name: 'reason', label: 'Причина', attrs: 'required minlength="3" placeholder="например, компенсация за шум"' })}
          <div class="actions span-all"><button class="btn btn--primary" type="submit">Провести</button></div></form>
      </section>
    </div>
    <section class="card"><h2 class="h3">История баллов</h2>
      ${history.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="История баллов"><table class="table table--compact">
        <thead><tr><th scope="col">Когда (UTC)</th><th scope="col">Операция</th><th scope="col">Бронь</th><th scope="col">Баллы</th><th scope="col">Кто</th></tr></thead>
        <tbody>${history.map((t) => html`<tr><td>${t.created_at.slice(0, 16)}</td><td>${TX_KIND[t.kind] || t.kind}${t.kind !== 'welcome' ? html`<small class="muted">${t.note}</small>` : ''}</td>
          <td>${t.booking_id ? html`<a href="/app/bookings/${t.booking_id}">${t.code}</a>` : '—'}</td><td><strong>${pts(t.points)}</strong></td><td>${t.user_name || 'система'}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">Операций ещё не было.</p>`}
    </section>
    <section class="card"><h2 class="h3">Брони участника</h2>
      ${bookings.length ? html`<ul class="mini-list">${bookings.map((b) => html`<li><span><a href="/app/bookings/${b.id}">${b.code}</a> · ${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}</span><span class="actions">${rub(b.total)} ${statusBadge(b.status)}</span></li>`)}</ul>`
        : html`<p class="muted">Броней пока нет.</p>`}
    </section>`,
  });
}

export function loyaltySettingsPage({ req, hotel, msg, levels }) {
  const owner = req.user.role === 'owner';
  const dis = owner ? '' : 'disabled';
  return appLayout({
    title: `Программа лояльности «${hotel.loyalty_name}»`,
    req,
    hotel,
    msg,
    body: html`${loyaltyNav(req, '/app/loyalty/settings')}
    <div class="app-cols">
      <section class="card"><h2 class="h3">Условия</h2>
        <p class="muted">Гость копит баллы за проживание: процент от стоимости проживания (без услуг и налога) начисляется при выселении. 1 балл = 1 ₽. Баллами можно оплатить часть следующей брони — на сайте или на стойке. Чем больше гость потратил на проживание, тем выше уровень: больше скидка на бронирование на сайте и больше процент начисления.</p>
        <form class="form form--grid" method="post" action="/app/loyalty/settings">${csrf(req)}
          <label class="check span-all"><input type="checkbox" name="loyalty_on" ${hotel.loyalty_on ? raw('checked') : ''} ${raw(dis)}><span>Программа работает: видна на сайте, баллы начисляются</span></label>
          ${field({ prefix: 'ls', name: 'loyalty_name', label: 'Название программы', value: hotel.loyalty_name, attrs: `required maxlength="60" ${dis}` })}
          ${field({ prefix: 'ls', name: 'loyalty_welcome', label: 'Приветственные баллы', type: 'number', value: hotel.loyalty_welcome, attrs: `min="0" max="100000" ${dis}` })}
          ${field({ prefix: 'ls', name: 'loyalty_redeem_pct', label: 'Баллами — не больше, % брони', type: 'number', value: hotel.loyalty_redeem_pct, attrs: `min="0" max="100" ${dis}` })}
          ${owner ? html`<div class="actions span-all"><button class="btn btn--primary" type="submit">Сохранить</button></div>` : html`<p class="muted span-all">Менять условия может владелец.</p>`}
        </form>
      </section>
      <section class="card"><h2 class="h3">Уровни</h2>
        ${levels.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Уровни программы"><table class="table table--compact">
          <thead><tr><th scope="col">Уровень</th><th scope="col">С суммы проживаний</th><th scope="col">Скидка на сайте</th><th scope="col">Начисление</th>${owner ? html`<th scope="col"><span class="sr-only">Действия</span></th>` : ''}</tr></thead>
          <tbody>${levels.map((l) => html`<tr><td>${l.name}</td><td>${rub(l.min_spent)}</td><td>${l.discount_pct}%</td><td>${l.earn_pct}%</td>
            ${owner ? html`<td><details class="row-edit"><summary>Изменить</summary>${levelForm(req, l, `/app/loyalty/levels/${l.id}`)}
              <form method="post" action="/app/loyalty/levels/${l.id}/delete" data-confirm="Удалить уровень «${l.name}»?">${csrf(req)}<button class="linklike" type="submit">удалить</button></form></details></td>` : ''}</tr>`)}</tbody></table></div>`
          : html`<p class="muted">Уровней нет — при включении программы создадутся три: базовый, серебряный и золотой.</p>`}
        ${owner ? html`<details class="add"><summary class="btn btn--secondary">+ Уровень</summary>${levelForm(req, {}, '/app/loyalty/levels')}</details>` : ''}
      </section>
    </div>`,
  });
}

function levelForm(req, l, action) {
  const p = action.replace(/\W+/g, '-').replace(/^-/, '');
  return html`<form class="form form--grid" method="post" action="${action}">${csrf(req)}
    ${field({ prefix: p, name: 'name', label: 'Название', value: l.name, attrs: 'required maxlength="40"' })}
    ${field({ prefix: p, name: 'min_spent', label: 'С суммы проживаний, ₽', type: 'number', value: l.min_spent ?? 0, attrs: 'min="0" required' })}
    ${field({ prefix: p, name: 'discount_pct', label: 'Скидка на сайте, %', type: 'number', value: l.discount_pct ?? 0, attrs: 'min="0" max="50" required' })}
    ${field({ prefix: p, name: 'earn_pct', label: 'Начисление, % от проживания', type: 'number', value: l.earn_pct ?? 5, attrs: 'min="0" max="50" required' })}
    <div class="actions span-all"><button class="btn btn--primary" type="submit">Сохранить</button><a class="btn btn--ghost" href="/app/loyalty/settings" data-close-details>Отмена</a></div></form>`;
}

// Block in the booking card (details tab).
export function cardLoyaltyBlock({ req, hotel, b, member, limit, used, here }) {
  if (!hotel.loyalty_on && !member) return '';
  const live = !['cancelled', 'no_show'].includes(b.status);
  return html`<h2 class="h3 move-form">Программа «${hotel.loyalty_name}»</h2>
    ${member ? html`<p><a href="/app/loyalty/${member.id}">${member.name}</a>, карта ${member.card_no} · ${levelBadge(member.level)} · баллов: <strong>${member.points.toLocaleString('ru-RU')}</strong>
        ${used ? html`<br><small class="muted">Баллами оплачено ${rub(used)}</small>` : ''}${b.points_earned > 0 ? html`<br><small class="muted">За это проживание начислено ${b.points_earned.toLocaleString('ru-RU')} баллов</small>` : ''}</p>
      ${live && limit > 0 ? html`<form class="form form--inline" method="post" action="/app/bookings/${b.id}/loyalty">${csrf(req)}<input type="hidden" name="back" value="${here}"><input type="hidden" name="op" value="redeem">
        ${field({ prefix: 'lr', name: 'points', label: `Оплатить баллами (до ${limit.toLocaleString('ru-RU')})`, type: 'number', value: limit, attrs: `min="1" max="${limit}" required` })}
        <button class="btn btn--secondary" type="submit">Списать баллы</button></form>` : ''}
      ${live && member.level.discount_pct && !b.loyalty_discount ? html`<form method="post" action="/app/bookings/${b.id}/loyalty">${csrf(req)}<input type="hidden" name="back" value="${here}"><input type="hidden" name="op" value="discount">
        <button class="btn btn--ghost btn--sm" type="submit">Применить скидку уровня ${member.level.discount_pct}%</button></form>` : ''}
      ${!used && !b.points_earned ? html`<form method="post" action="/app/bookings/${b.id}/loyalty">${csrf(req)}<input type="hidden" name="back" value="${here}"><input type="hidden" name="op" value="unlink"><button class="linklike" type="submit">отвязать участника</button></form>` : ''}`
      : html`<form class="form form--inline" method="post" action="/app/bookings/${b.id}/loyalty">${csrf(req)}<input type="hidden" name="back" value="${here}"><input type="hidden" name="op" value="link">
          ${field({ prefix: 'll', name: 'find', label: 'Номер карты, почта или телефон участника', attrs: 'required autocomplete="off"' })}
          <button class="btn btn--secondary" type="submit">Привязать</button></form>
        ${b.guest_email ? html`<form method="post" action="/app/bookings/${b.id}/loyalty">${csrf(req)}<input type="hidden" name="back" value="${here}"><input type="hidden" name="op" value="enroll">
          <button class="btn btn--ghost btn--sm" type="submit">Записать гостя в программу</button></form>` : html`<p class="muted">Чтобы записать гостя в программу, укажите его почту.</p>`}`}`;
}
