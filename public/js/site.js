// Progressive enhancements. Every page works without this file.
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // Mobile nav / app sidebar toggles
  $$('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.toggle);
      const open = target.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  // Mega-menu: click/keyboard open, Escape and outside click close
  $$('[data-menu]').forEach((btn) => {
    const menu = btn.parentElement;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !menu.classList.contains('open');
      $$('.menu.open').forEach((m) => { m.classList.remove('open'); $('[data-menu]', m).setAttribute('aria-expanded', 'false'); });
      menu.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', (e) => {
    $$('.menu.open').forEach((m) => { if (!m.contains(e.target)) { m.classList.remove('open'); $('[data-menu]', m).setAttribute('aria-expanded', 'false'); } });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $$('.menu.open').forEach((m) => { m.classList.remove('open'); const b = $('[data-menu]', m); b.setAttribute('aria-expanded', 'false'); b.focus(); });
  });

  // Tabs with arrow-key navigation
  $$('[data-tabs]').forEach((root) => {
    const tabs = $$('[role="tab"]', root);
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        const n = tabs[(i + d + tabs.length) % tabs.length];
        select(n);
        n.focus();
      });
    });
  });

  // Price constructor: live recalculation
  const calc = $('[data-calc]');
  if (calc) {
    const out = $('[data-calc-result]');
    let timer;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const params = new URLSearchParams(new FormData(calc));
        try {
          const r = await fetch('/api/quote?' + params);
          const j = await r.json();
          out.innerHTML = j.html;
          history.replaceState(null, '', '/price?' + params);
        } catch { /* keep last result */ }
      }, 150);
    };
    calc.addEventListener('input', update);
    calc.addEventListener('change', update);
  }

  // Search form: keep checkout after checkin
  const search = $('[data-search]');
  if (search) {
    const ci = search.elements.checkin, co = search.elements.checkout;
    ci.addEventListener('change', () => {
      if (!ci.value) return;
      const d = new Date(ci.value + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      const min = d.toISOString().slice(0, 10);
      co.min = min;
      if (!co.value || co.value <= ci.value) co.value = min;
    });
  }

  // Checkout: live total with extras, block double submit
  const checkout = $('[data-checkout]');
  if (checkout) {
    const sum = $('[data-summary]');
    const grand = $('[data-grand]');
    const nights = +sum.dataset.nights, guests = +sum.dataset.guests, stay = +sum.dataset.stay;
    const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n).replace(/ /g, ' ') + ' ₽';
    const recalc = () => {
      let total = stay;
      $$('input[name="extras"]', checkout).forEach((x) => {
        if (!x.checked) return;
        const p = +x.dataset.price;
        total += x.dataset.per === 'stay' ? p : x.dataset.per === 'night' ? p * nights : p * nights * guests;
      });
      grand.textContent = fmt(total);
    };
    checkout.addEventListener('change', recalc);
    recalc();
    checkout.addEventListener('submit', () => {
      const b = $('[data-submit]', checkout);
      setTimeout(() => { b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Бронируем…'; }, 0);
    });
  }

  // Confirm dialogs on destructive forms
  $$('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));

  // Copy embed code
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Скопировано'; } catch { b.textContent = 'Выделите код и скопируйте вручную'; }
  }));

  // Selects that apply themselves (filters, hotel switcher)
  $$('[data-autosubmit]').forEach((el) => el.addEventListener('change', () => el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit()));

  // "Отмена" inside an add/edit block closes it without reloading
  $$('[data-close-details]').forEach((a) => a.addEventListener('click', (e) => {
    const d = a.closest('details');
    if (!d) return;
    e.preventDefault();
    const f = a.closest('form');
    if (f) f.reset();
    d.open = false;
    const s = d.querySelector('summary');
    if (s) s.focus();
  }));

  // Chessboard: drag a booking onto another room row to move it
  const chess = $('[data-chess]');
  if (chess) {
    const csrfToken = $('[data-csrf]').dataset.csrf;
    let dragged = null;
    chess.addEventListener('dragstart', (e) => {
      const bar = e.target.closest('[data-booking]');
      if (!bar) return;
      dragged = bar;
      bar.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', bar.dataset.booking);
    });
    chess.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging');
      $$('.drop-ok', chess).forEach((r) => r.classList.remove('drop-ok'));
      dragged = null;
    });
    chess.addEventListener('dragover', (e) => {
      const row = e.target.closest('[data-room]');
      if (!row || !dragged) return;
      e.preventDefault();
      $$('.drop-ok', chess).forEach((r) => r !== row && r.classList.remove('drop-ok'));
      row.classList.add('drop-ok');
    });
    chess.addEventListener('drop', async (e) => {
      const row = e.target.closest('[data-room]');
      if (!row || !dragged) return;
      e.preventDefault();
      const id = dragged.dataset.booking;
      const room = row.dataset.room === '0' ? '' : row.dataset.room;
      if (dragged.parentElement === row) return;
      const r = await fetch(`/app/bookings/${id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ room_id: room }),
      });
      const j = await r.json().catch(() => ({ error: 'Не удалось переселить' }));
      const url = new URL(location.href);
      url.searchParams.set('m', j.message || j.error);
      if (!r.ok) url.searchParams.set('e', '1'); else url.searchParams.delete('e');
      location.href = url.toString();
    });
  }

  // Availability grid: edit a cell in a dialog, save via JSON
  const grid = $('[data-grid]');
  if (grid) {
    const dialog = $('[data-cell-dialog]');
    const form = $('[data-cell-form]');
    const err = $('[data-cell-error]');
    const csrf = $('[data-csrf]').dataset.csrf;
    let current;
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.cell__btn');
      if (!btn) return;
      current = btn;
      $('#cell-title').textContent = `${btn.dataset.roomName}, ${btn.dataset.date.split('-').reverse().join('.')}`;
      form.elements.price.value = btn.dataset.price;
      form.elements.available.value = btn.dataset.available;
      form.elements.min_stay.value = btn.dataset.minstay;
      form.elements.open.checked = btn.dataset.closed !== '1';
      err.hidden = true;
      dialog.showModal();
    });
    form.addEventListener('submit', async (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      const body = {
        room: current.dataset.room, date: current.dataset.date,
        price: form.elements.price.value, available: form.elements.available.value,
        min_stay: form.elements.min_stay.value, open: form.elements.open.checked,
      };
      const r = await fetch('/app/prices', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ error: 'Ошибка сохранения' }));
      if (!r.ok) { err.textContent = j.error; err.hidden = false; return; }
      const c = j.cell;
      Object.assign(current.dataset, { price: c.price, available: c.available, closed: c.closed, minstay: c.min_stay });
      $('.cell__avail', current).textContent = c.closed ? '✕' : c.available;
      $('.cell__price', current).textContent = c.price;
      const td = current.parentElement;
      td.classList.toggle('cell--closed', !!c.closed);
      td.classList.toggle('cell--full', !c.closed && c.available === 0);
      td.classList.add('cell--saved');
      setTimeout(() => td.classList.remove('cell--saved'), 1000);
      dialog.close();
      current.focus();
    });
  }
})();
