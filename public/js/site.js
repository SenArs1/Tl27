// Progressive enhancements. Every page works without this file.
(function () {
  document.documentElement.classList.add('js');
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
    // Ages field appears only when there are children
    const kids = $('[data-children]', search);
    const agesBox = $('[data-ages-box]', search);
    if (kids && agesBox) {
      const sync = () => {
        const n = Number(kids.value) || 0;
        agesBox.toggleAttribute('data-hidden-ages', n === 0);
        if (n === 0) agesBox.querySelector('input').value = '';
      };
      kids.addEventListener('input', sync);
    }
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
  const checkout = $('[data-checkout-form]');
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
  // Delegated, so it also covers forms loaded later (the chessboard side panel).
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-confirm]');
    if (f && !confirm(f.dataset.confirm)) e.preventDefault();
  });

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

  // ---------- Chessboard ----------
  const chess = $('[data-chess]');
  if (chess) {
    const csrfToken = $('[data-csrf]').dataset.csrf;
    const from = chess.dataset.from;
    const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const diff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
    const idxOf = (d) => diff(from, d);
    const ru = (d) => d.split('-').reverse().join('.');
    const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
    const cellAt = (x, y) => document.elementsFromPoint(x, y).find((el) => el.classList && el.classList.contains('chess__cell'));
    const go = (message, isError) => {
      const u = new URL(location.href);
      u.searchParams.set('m', message);
      if (isError) u.searchParams.set('e', '1'); else u.searchParams.delete('e');
      location.href = u.toString();
    };
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ error: 'Не удалось выполнить действие' }));
      return { ok: r.ok, ...j };
    };

    // Remembered "Сегодня" strip state
    $$('details[data-remember]').forEach((d) => {
      const k = `chess:${d.dataset.remember}`;
      if (store.get(k, true) === false) d.open = false;
      d.addEventListener('toggle', () => store.set(k, d.open));
    });

    // Collapse a category: its rooms hide, the free-rooms row stays — a compact availability table.
    const collapsed = new Set(store.get('chess:collapsed', []));
    const applyCollapse = () => {
      $$('[data-collapse]', chess).forEach((btn) => {
        const id = btn.dataset.collapse;
        const closed = collapsed.has(id);
        btn.setAttribute('aria-expanded', String(!closed));
        $$(`.chess__row[data-type="${id}"]`, chess).forEach((row) => { row.hidden = closed; });
      });
    };
    chess.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-collapse]');
      if (!btn) return;
      const id = btn.dataset.collapse;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      store.set('chess:collapsed', [...collapsed]);
      applyCollapse();
    });
    applyCollapse();

    // Filters and search: bookings that do not match fade out.
    const tools = $('[data-chess-tools]');
    tools.hidden = false;
    const findInput = $('[data-find-input]', tools);
    const saved = store.get('chess:filters', {});
    $$('[data-filter]', tools).forEach((c) => { c.checked = (saved[c.dataset.filter] || []).includes(c.value); });
    const applyFilters = () => {
      const groups = {};
      $$('[data-filter]', tools).forEach((c) => { if (c.checked) (groups[c.dataset.filter] = groups[c.dataset.filter] || []).push(c.value); });
      store.set('chess:filters', groups);
      const term = findInput.value.trim().toLowerCase();
      let shown = 0, total = 0, firstHit = null;
      $$('.chess__bar[data-booking]', chess).forEach((bar) => {
        total++;
        // A bar matches a group if one of its values is chosen; tags are a space-separated list.
        const ok = Object.entries(groups).every(([g, vals]) => (bar.dataset[g] || '').split(' ').some((v) => vals.includes(v)));
        const hit = term && bar.dataset.find.includes(term);
        const visible = ok && (!term || hit);
        bar.classList.toggle('is-dim', !visible);
        bar.classList.toggle('is-hit', Boolean(hit && ok));
        if (visible) shown++;
        if (hit && ok && !firstHit) firstHit = bar;
      });
      const active = Object.keys(groups).length || term;
      $('[data-filter-count]', tools).textContent = active ? `Показано ${shown} из ${total}` : '';
      if (firstHit && term) {
        const row = firstHit.closest('.chess__row');
        if (row && row.hidden) { collapsed.delete(row.dataset.type); store.set('chess:collapsed', [...collapsed]); applyCollapse(); }
        firstHit.scrollIntoView({ block: 'center', inline: 'center' });
      }
    };
    tools.addEventListener('change', applyFilters);
    let findTimer;
    findInput.addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(applyFilters, 200); });
    $('[data-filter-reset]', tools).addEventListener('click', () => { $$('[data-filter]', tools).forEach((c) => { c.checked = false; }); findInput.value = ''; applyFilters(); });
    applyFilters();

    // Side panel with the booking and quick actions.
    const peek = $('[data-peek]');
    const peekBody = $('[data-peek-body]');
    const openPeek = async (id) => {
      const r = await fetch(`/app/bookings/${id}/peek?back=${encodeURIComponent(location.pathname + location.search)}`);
      if (!r.ok) { location.href = `/app/bookings/${id}`; return; }
      peekBody.innerHTML = await r.text();
      peek.showModal();
    };
    peek.addEventListener('click', (e) => {
      if (e.target === peek || e.target.closest('[data-peek-close]')) peek.close();
    });
    peek.addEventListener('change', (e) => {
      const t = e.target.closest('[data-pay-toggle]');
      if (!t) return;
      const amount = t.closest('form').querySelector('[data-pay-amount]');
      amount.value = t.checked ? amount.dataset.payAmount : '0';
    });

    // Drag a bar to another room and/or other days. The server answers with before/after
    // (dry run); the change is applied only after the user confirms.
    let dragged = null, grabDate = null, resizing = null, swallowClick = false;
    const moveDialog = $('[data-move-dialog]');
    let pending = null;
    const describe = (s) => `${ru(s.checkin)} — ${ru(s.checkout)}, ${s.rooms.map((x) => (x.number ? `№ ${x.number}` : 'без номера') + ` (${x.type_name})`).join(' → ')}, ${s.total.toLocaleString('ru-RU')} ₽`;
    const preview = async () => {
      const r = await post(`/app/bookings/${pending.id}/relocate?dry=1`, { ...pending.body, keep_price: $('[data-keep-price]', moveDialog).checked });
      const err = $('[data-move-error]', moveDialog);
      if (!r.ok) { err.textContent = r.error; err.hidden = false; $('[data-move-apply]', moveDialog).disabled = true; $('[data-move-diff]', moveDialog).innerHTML = ''; return; }
      err.hidden = true;
      $('[data-move-apply]', moveDialog).disabled = false;
      const diff = $('[data-move-diff]', moveDialog);
      diff.innerHTML = '';
      for (const [k, v] of [['Было', r.before], ['Станет', r.after]]) {
        const p = document.createElement('p');
        const b = document.createElement('strong');
        b.textContent = `${k}: `;
        p.append(b, describe(v));
        diff.append(p);
      }
    };
    $('[data-keep-price]', moveDialog).addEventListener('change', preview);
    $('[data-move-cancel]', moveDialog).addEventListener('click', () => { moveDialog.close(); pending = null; });
    $('[data-move-apply]', moveDialog).addEventListener('click', async () => {
      const r = await post(`/app/bookings/${pending.id}/relocate`, { ...pending.body, keep_price: $('[data-keep-price]', moveDialog).checked });
      moveDialog.close();
      go(r.ok ? 'Бронь перенесена' : r.error, !r.ok);
    });

    chess.addEventListener('dragstart', (e) => {
      const bar = e.target.closest('[data-booking]');
      if (!bar || resizing) { e.preventDefault(); return; }
      dragged = bar;
      const cell = cellAt(e.clientX, e.clientY);
      grabDate = cell ? cell.dataset.date : null;
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
      const bar = dragged;
      const cell = cellAt(e.clientX, e.clientY);
      // Dates move only for a whole stay that has not started yet.
      const shift = cell && grabDate && bar.dataset.status === 'confirmed' && bar.dataset.whole === '1' ? diff(grabDate, cell.dataset.date) : 0;
      const sameRow = bar.parentElement === row;
      if (sameRow && !shift) return;
      const body = { segment_id: bar.dataset.segment };
      if (!sameRow) body.room_id = row.dataset.room === '0' ? '' : row.dataset.room;
      if (shift) { body.checkin = addDays(bar.dataset.checkin, shift); body.checkout = addDays(bar.dataset.checkout, shift); }
      pending = { id: bar.dataset.booking, body };
      $('[data-keep-price]', moveDialog).checked = true;
      await preview();
      moveDialog.showModal();
    });

    // Drag a bar's edge to change check-in or check-out.
    chess.addEventListener('pointerdown', (e) => {
      swallowClick = false;
      const h = e.target.closest('.chess__handle');
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      swallowClick = true;
      const bar = h.closest('.chess__bar');
      resizing = { bar, edge: h.dataset.edge, orig: bar.style.gridColumn, checkin: bar.dataset.checkin, checkout: bar.dataset.checkout, date: null };
      bar.classList.add('resizing');
      h.setPointerCapture(e.pointerId);
    });
    chess.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const under = cellAt(e.clientX, e.clientY);
      if (!under) return;
      const date = under.dataset.date;
      const r = resizing;
      const ci = r.edge === 'checkin' ? date : r.checkin;
      const co = r.edge === 'checkout' ? date : r.checkout;
      if (co <= ci) return;
      r.date = date;
      const [a, b] = r.orig.split('/').map((x) => x.trim());
      r.bar.style.gridColumn = `${r.edge === 'checkin' ? 3 + idxOf(ci) * 2 : a} / ${r.edge === 'checkout' ? 3 + idxOf(co) * 2 : b}`;
    });
    const finish = async (cancel) => {
      const r = resizing;
      if (!r) return;
      resizing = null;
      r.bar.classList.remove('resizing');
      const changed = r.date && r.date !== (r.edge === 'checkin' ? r.checkin : r.checkout);
      if (cancel || !changed) { r.bar.style.gridColumn = r.orig; return; }
      const body = { checkin: r.edge === 'checkin' ? r.date : r.checkin, checkout: r.edge === 'checkout' ? r.date : r.checkout };
      const res = await post(`/app/bookings/${r.bar.dataset.booking}/dates`, body);
      go(res.message || res.error, !res.ok);
    };
    chess.addEventListener('pointerup', () => finish(false));
    chess.addEventListener('pointercancel', () => finish(true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(true); });

    // A plain click on a bar opens the side panel; the click that ends an edge drag does nothing.
    chess.addEventListener('click', (e) => {
      const bar = e.target.closest('.chess__bar[data-booking]');
      if (!bar) return;
      e.preventDefault();
      if (swallowClick) { swallowClick = false; return; }
      openPeek(bar.dataset.booking);
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
      form.elements.cta.checked = btn.dataset.cta === '1';
      form.elements.ctd.checked = btn.dataset.ctd === '1';
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
        cta: form.elements.cta.checked, ctd: form.elements.ctd.checked,
      };
      const r = await fetch('/app/prices', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ error: 'Ошибка сохранения' }));
      if (!r.ok) { err.textContent = j.error; err.hidden = false; return; }
      const c = j.cell;
      Object.assign(current.dataset, { price: c.price, available: c.available, closed: c.closed, minstay: c.min_stay, cta: c.cta, ctd: c.ctd });
      let flags = $('.inv-flags', current);
      const text = [c.cta ? 'нз' : '', c.ctd ? 'нв' : '', c.min_stay > 1 ? `м${c.min_stay}` : ''].filter(Boolean).join(' ');
      if (!flags && text) { flags = document.createElement('span'); flags.className = 'inv-flags'; current.appendChild(flags); }
      if (flags) flags.textContent = text;
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
