// Stayra booking widget: one script tag on any hotel site.
// <div id="stayra-booking"></div><script src="https://YOUR-HOST/widget.js" data-hotel="slug" async></script>
(function () {
  var script = document.currentScript || document.querySelector('script[data-hotel][src*="widget.js"]');
  if (!script) return;
  var origin = new URL(script.src).origin;
  var hotel = script.getAttribute('data-hotel');
  var mount = document.getElementById('stayra-booking');
  if (!mount || !hotel) return;
  function iso(d) { return d.toISOString().slice(0, 10); }
  var t = new Date(); t.setUTCHours(0, 0, 0, 0);
  var a = new Date(t); a.setUTCDate(a.getUTCDate() + 7);
  var b = new Date(t); b.setUTCDate(b.getUTCDate() + 9);
  var root = mount.attachShadow ? mount.attachShadow({ mode: 'open' }) : mount;
  root.innerHTML =
    '<style>:host{all:initial}form{font-family:system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:10px;align-items:end;background:#fff;border:1px solid #dcdfd9;border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)}' +
    'label{display:grid;gap:4px;font-size:13px;font-weight:600;color:#1b1f1d}input{font:inherit;padding:8px 10px;border:1.5px solid #7d857f;border-radius:6px;min-height:40px}' +
    'button{font:inherit;font-weight:700;background:#f2b33d;color:#1b1f1d;border:0;border-radius:10px;padding:10px 20px;min-height:42px;cursor:pointer}small{flex-basis:100%;color:#59615c;font-size:12px}</style>' +
    '<form target="_blank" method="get" action="' + origin + '/h/' + encodeURIComponent(hotel) + '/rooms">' +
    '<label>Заезд<input type="date" name="checkin" required min="' + iso(t) + '" value="' + iso(a) + '"></label>' +
    '<label>Выезд<input type="date" name="checkout" required value="' + iso(b) + '"></label>' +
    '<label>Взрослые<input type="number" name="adults" min="1" max="12" value="2" style="width:80px"></label>' +
    '<label>Дети<input type="number" name="children" min="0" max="8" value="0" style="width:80px"></label>' +
    '<button type="submit">Найти номера</button><small>Бронирование без посредников · Stayra</small></form>';
})();
