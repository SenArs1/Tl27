// Tiny tagged-template HTML helper with escaping. raw() marks trusted markup.
const RAW = Symbol('raw');

export function raw(s) {
  return { [RAW]: true, value: String(s) };
}

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'object' && v[RAW]) return v.value;
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return raw(out);
}

export function rub(n) {
  return new Intl.NumberFormat('ru-RU').format(n).replace(/ /g, ' ') + ' ₽';
}

// Form field with label and error. type: text|email|tel|number|date|password|textarea|select
export function field({ name, label, type = 'text', value = '', error, options, attrs = '', hint, prefix = 'f' }) {
  const id = `${prefix}-${name}`;
  const errId = error ? `${id}-err` : '';
  const describedBy = [error ? errId : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ');
  const a = raw(`${attrs}${describedBy ? ` aria-describedby="${describedBy}"` : ''}${error ? ' aria-invalid="true"' : ''}`);
  let control;
  if (type === 'textarea') control = html`<textarea id="${id}" name="${name}" ${a}>${value}</textarea>`;
  else if (type === 'select') {
    control = html`<select id="${id}" name="${name}" ${a}>${options.map(([v, t]) => html`<option value="${v}" ${String(v) === String(value) ? raw('selected') : ''}>${t}</option>`)}</select>`;
  } else control = html`<input id="${id}" name="${name}" type="${type}" value="${value}" ${a}>`;
  return html`<div class="field${error ? ' field--error' : ''}">
    <label for="${id}">${label}</label>
    ${control}
    ${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    ${error ? html`<p class="field-error" id="${errId}">${error}</p>` : ''}
  </div>`;
}
