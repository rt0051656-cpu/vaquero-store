'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = { 'X-Requested-With': 'vaquero', 'Content-Type': 'application/json' };
  let statuses = {}; let timer;

  async function api(url, opts) {
    const r = await fetch(url, opts);
    if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('Sesión expirada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Error');
    return d;
  }
  function showLogin() { $('#login').hidden = false; $('#app').hidden = true; clearInterval(timer); }
  function showApp() {
    $('#login').hidden = true; $('#app').hidden = false; load();
    clearInterval(timer); timer = setInterval(() => { if (!document.hidden && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'INPUT') load(true); }, 30000);
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#loginErr').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: $('#user').value, password: $('#pass').value }) });
      $('#pass').value = ''; showApp();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#logout').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST', headers: H }); showLogin(); });
  $('#refresh').addEventListener('click', () => load());

  let qTimer;
  $('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => load(), 250); });
  $('#statusFilter').addEventListener('change', () => load());

  async function load() {
    const params = new URLSearchParams();
    if ($('#q').value.trim()) params.set('q', $('#q').value.trim());
    if ($('#statusFilter').value) params.set('status', $('#statusFilter').value);
    try {
      const d = await api('/api/admin/orders?' + params);
      statuses = d.statuses; render(d);
    } catch (e) { /* sesión expirada: ya mostró login */ }
  }

  function render(d) {
    const sf = $('#statusFilter'); const cur = sf.value;
    sf.innerHTML = '<option value="">Todos los estados</option>' + Object.entries(statuses).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    sf.value = cur;
    const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
    $('#chips').innerHTML = `<span class="chip">Total<b>${total}</b></span>` +
      Object.entries(statuses).map(([k, v]) => `<span class="chip ${cur === k ? 'on' : ''}">${v}<b>${d.counts[k] || 0}</b></span>`).join('');
    $('#count').textContent = `${d.orders.length} pedido(s) mostrado(s)`;
    $('#list').innerHTML = d.orders.length ? d.orders.map(card).join('') : '<p class="empty">No hay pedidos que coincidan.</p>';
  }

  function card(o) {
    const dt = new Date(o.createdAt).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
    const opts = Object.entries(statuses).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('');
    return `<article class="order s-${o.status}" data-id="${o.id}">
      <img class="thumb" loading="lazy" src="${o.receiptUrl}" alt="Comprobante ${esc(o.reference)}" data-view="${o.id}">
      <div>
        <div class="ref">${esc(o.reference)}</div>
        <div class="meta"><span>ID jugador: <b>${esc(o.playerId)}</b></span><span>Paquete: <b>💎 ${Number(o.diamonds).toLocaleString('en-US')}</b></span><span class="price">S/ ${o.price.toFixed(2)}</span></div>
        <div class="when">Recibido: ${esc(dt)}</div>
        <div class="row" style="margin-top:10px">
          <select class="input sm" data-status>${opts}</select>
          <button class="btn btn-sm" data-save>Guardar estado</button>
          <button class="btn btn-ghost btn-sm" data-view="${o.id}">Ver comprobante</button>
          <a class="btn btn-ghost btn-sm" href="${o.receiptUrl}?download=1">Descargar</a>
        </div>
        <input class="input sm note" data-note maxlength="300" placeholder="Nota interna (opcional)" value="${esc(o.note)}">
        <div class="saved" data-saved></div>
      </div></article>`;
  }

  document.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]');
    if (v) {
      const id = v.dataset.view;
      $('#lbImg').src = `/api/admin/orders/${id}/receipt`;
      $('#lbDown').href = `/api/admin/orders/${id}/receipt?download=1`;
      $('#lightbox').hidden = false; return;
    }
    if (e.target.id === 'lbClose' || e.target.id === 'lightbox') { $('#lightbox').hidden = true; $('#lbImg').src = ''; return; }
    const s = e.target.closest('[data-save]');
    if (s) {
      const art = s.closest('.order');
      const status = art.querySelector('[data-status]').value;
      const note = art.querySelector('[data-note]').value;
      s.disabled = true;
      try {
        await api(`/api/admin/orders/${art.dataset.id}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status, note }) });
        art.querySelector('[data-saved]').textContent = '✓ Guardado: ' + statuses[status];
        await load();
      } catch (err) { art.querySelector('[data-saved]').textContent = err.message; }
      s.disabled = false;
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#lightbox').hidden = true; });

  api('/api/admin/me').then(showApp).catch(showLogin);
})();
