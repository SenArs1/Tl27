import { html } from './html.js';
import { bare } from './layout.js';
import { LOGO } from './icons.js';
import { BRAND } from '../content.js';

// Platform team area: every tenant and the sales leads from the marketing site.
export function adminPage({ hotels, leads }) {
  return bare({
    title: 'Платформа',
    body: html`<div class="admin container">
      <header class="admin__head"><a class="logo" href="/">${LOGO}<span>${BRAND.name}</span></a><span class="muted">Кабинет команды платформы</span><a href="/app">← В кабинет объекта</a></header>
      <section class="card"><h1 class="h2">Объекты на платформе: ${hotels.length}</h1>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Объекты"><table class="table">
          <thead><tr><th scope="col">ID</th><th scope="col">Объект</th><th scope="col">Город</th><th scope="col">Номеров</th><th scope="col">Броней</th><th scope="col">Сотрудников</th><th scope="col">Создан</th></tr></thead>
          <tbody>${hotels.map((h) => html`<tr><td>${h.id}</td><td>${h.name}<small class="muted">/h/${h.slug}</small></td><td>${h.city}</td><td>${h.rooms}</td><td>${h.bookings}</td><td>${h.users}</td><td>${h.created_at.slice(0, 10)}</td></tr>`)}</tbody>
        </table></div></section>
      <section class="card"><h2 class="h2">Заявки с сайта</h2>
        ${leads.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Заявки"><table class="table">
          <thead><tr><th scope="col">Когда</th><th scope="col">Имя</th><th scope="col">Телефон</th><th scope="col">Почта</th><th scope="col">Объект</th><th scope="col">Номеров</th><th scope="col">Сообщение</th></tr></thead>
          <tbody>${leads.map((l) => html`<tr><td>${l.created_at}</td><td>${l.name}</td><td>${l.phone}</td><td>${l.email}</td><td>${l.property_type}</td><td>${l.rooms ?? ''}</td><td>${l.message}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">Заявок пока нет.</p>`}
      </section>
    </div>`,
  });
}
