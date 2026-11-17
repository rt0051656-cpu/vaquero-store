'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const state = { whatsapp: '51912420894', packages: [], playerId: '', pack: null, file: null };
  const money = (n) => 'S/ ' + Number(n).toFixed(2);
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const wa = (text) => `https://wa.me/${state.whatsapp}` + (text ? `?text=${encodeURIComponent(text)}` : '');

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Navegación entre secciones ----------
  function go(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'pay') fillPay();
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); return; }
    const s = e.target.closest('[data-scroll]');
    if (s) {
      e.preventDefault();
      if (!$('#view-home').classList.contains('active')) go('home');
      setTimeout(() => document.getElementById(s.dataset.scroll).scrollIntoView({ behavior: 'smooth' }), 60);
    }
  });

  // ---------- Config / catálogo (precios desde el servidor) ----------
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    state.whatsapp = cfg.whatsapp; state.packages = cfg.packages;
    $('#heroWa').href = wa('Hola, quiero información sobre las recargas de EL VAQUERO STORE.');
    $('#supportWa').href = wa('Hola, necesito ayuda con EL VAQUERO STORE.');
    renderPacks();
  }).catch(() => toast('No se pudo cargar el catálogo. Recarga la página.'));

  function renderPacks() {
    $('#packs').innerHTML = state.packages.map((p) => `
      <div class="pack" data-key="${p.key}">
        ${p.key === 'p1167' ? '<span class="tag">POPULAR</span>' : ''}
        <svg class="dia"><use href="#i-diamond"/></svg>
        <div class="qty">💎 ${fmt(p.diamonds)} diamantes</div>
        <div class="price">${money(p.price)}</div>
        <button class="btn" type="button" data-select="${p.key}">SELECCIONAR</button>
      </div>`).join('');
  }

  // ---------- ID de jugador ----------
  const idInput = $('#playerId');
  function validId() { return /^\d{6,14}$/.test(idInput.value.trim()); }
  idInput.addEventListener('input', () => {
    idInput.value = idInput.value.replace(/\D/g, '');
    const v = idInput.value;
    const ok = validId();
    idInput.classList.toggle('ok', ok);
    idInput.classList.toggle('bad', v.length > 0 && !ok && v.length > 14);
    $('#idErr').textContent = v && !ok && v.length >= 3 ? 'El ID debe tener entre 6 y 14 dígitos.' : '';
    $('#catalog').classList.toggle('locked', !ok);
    $('#catHint').textContent = ok ? 'Toca un paquete para seleccionarlo (solo uno por pedido).' : 'Ingresa tu ID de jugador para desbloquear los paquetes.';
    if (!ok) { state.pack = null; document.querySelectorAll('.pack').forEach((c) => c.classList.remove('sel')); $('#summary').hidden = true; }
    else if (state.pack) updateSummary();
  });

  // ---------- Selección de paquete ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-select]');
    if (!b) return;
    if (!validId()) { $('#idErr').textContent = 'Primero ingresa tu ID de jugador.'; idInput.focus(); return; }
    state.pack = state.packages.find((p) => p.key === b.dataset.select);
    document.querySelectorAll('.pack').forEach((c) => {
      const on = c.dataset.key === state.pack.key; c.classList.toggle('sel', on);
      c.querySelector('button').textContent = on ? '✓ SELECCIONADO' : 'SELECCIONAR';
    });
    updateSummary();
    $('#summary').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  function updateSummary() {
    state.playerId = idInput.value.trim();
    $('#sumId').textContent = state.playerId;
    $('#sumDia').textContent = '💎 ' + fmt(state.pack.diamonds) + ' diamantes';
    $('#sumPrice').textContent = money(state.pack.price);
    $('#summary').hidden = false;
  }
  $('#toPay').addEventListener('click', () => {
    if (!validId()) { $('#idErr').textContent = 'Ingresa un ID de jugador válido.'; idInput.focus(); return; }
    if (!state.pack) return;
    state.playerId = idInput.value.trim();
    go('pay');
  });

  // ---------- Pago ----------
  function fillPay() {
    if (!state.pack) { go('shop'); return; }
    $('#payPack').textContent = '💎 ' + fmt(state.pack.diamonds) + ' diamantes';
    $('#payId').textContent = state.playerId;
    $('#payAmount').textContent = money(state.pack.price);
    $('#payAmount2').textContent = money(state.pack.price);
    refreshConfirm();
  }

  // ---------- Comprobante ----------
  const fileInput = $('#receipt');
  const MAX = 5 * 1024 * 1024;
  $('#dropBtn').addEventListener('click', () => fileInput.click());
  $('#changeFile').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    $('#fileErr').textContent = '';
    if (!f) return;
    if (!/^image\/(jpeg|png)$/.test(f.type) || !/\.(jpe?g|png)$/i.test(f.name)) {
      $('#fileErr').textContent = 'Formato no permitido. Usa JPG, JPEG o PNG.'; clearFile(); return;
    }
    if (f.size > MAX) { $('#fileErr').textContent = 'La imagen supera los 5 MB.'; clearFile(); return; }
    state.file = f;
    const url = URL.createObjectURL(f);
    const img = $('#previewImg'); img.onload = () => URL.revokeObjectURL(url); img.src = url;
    $('#preview').hidden = false; $('#dropBtn').hidden = true;
    refreshConfirm();
  });
  function clearFile() {
    state.file = null; fileInput.value = ''; $('#preview').hidden = true; $('#dropBtn').hidden = false; refreshConfirm();
  }
  function refreshConfirm() { $('#confirmBtn').disabled = !(validId() && state.pack && state.file); }

  $('#confirmBtn').addEventListener('click', async () => {
    if (!(validId() && state.pack && state.file)) return;
    const btn = $('#confirmBtn'); btn.disabled = true; btn.textContent = 'ENVIANDO…';
    $('#fileErr').textContent = '';
    try {
      const fd = new FormData();
      fd.append('playerId', state.playerId);
      fd.append('packageKey', state.pack.key);
      fd.append('receipt', state.file, state.file.name);
      const r = await fetch('/api/orders', { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'No se pudo registrar el pedido.');
      showDone(data.order);
    } catch (err) {
      $('#fileErr').textContent = err.message;
    } finally {
      btn.textContent = 'CONFIRMAR PEDIDO'; refreshConfirm();
    }
  });

  // ---------- Confirmación ----------
  function showDone(o) {
    $('#doneRef').textContent = o.reference;
    $('#doneId').textContent = o.playerId;
    $('#donePack').textContent = '💎 ' + fmt(o.diamonds) + ' diamantes';
    $('#donePrice').textContent = money(o.price);
    $('#doneWa').href = wa(`Hola, soy cliente de EL VAQUERO STORE. Acabo de realizar un pedido de diamantes de Free Fire. Mi número de referencia es: ${o.reference}. Quisiera confirmar mi pedido`);
    // limpiar para un posible nuevo pedido
    state.pack = null; state.playerId = ''; idInput.value = ''; idInput.classList.remove('ok');
    $('#catalog').classList.add('locked'); $('#summary').hidden = true; renderPacks(); clearFile();
    go('done');
  }
  $('#copyRef').addEventListener('click', async () => {
    const ref = $('#doneRef').textContent;
    try { await navigator.clipboard.writeText(ref); }
    catch { const t = document.createElement('textarea'); t.value = ref; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    $('#copyTxt').textContent = '¡Copiado!'; toast('Número de referencia copiado');
    setTimeout(() => ($('#copyTxt').textContent = 'Copiar'), 1800);
  });
})();
