// UI del chat: burbujas (texto, sticker animado, foto, archivo), input,
// panel de stickers por categorías, menú adjuntar y separadores por día.
(function () {
  const $messages = document.getElementById('messages');
  const $form     = document.getElementById('chat-form');
  const $input    = document.getElementById('message-input');
  const $peerName = document.getElementById('peer-name');
  const $peerAvatar = document.getElementById('peer-avatar');
  const $peerStatus = document.getElementById('peer-status');

  const $stickerPanel = document.getElementById('sticker-panel');
  const $stickerTabs  = document.getElementById('sticker-tabs');
  const $stickerGrid  = document.getElementById('sticker-grid');
  const $attachMenu   = document.getElementById('attach-menu');
  const $btnSticker   = document.getElementById('btn-sticker');
  const $btnAttach    = document.getElementById('btn-attach');
  const $btnExpand    = document.getElementById('btn-expand');
  const $replyBar       = document.getElementById('reply-bar');
  const $replyBarSender = document.getElementById('reply-bar-sender');
  const $replyBarText   = document.getElementById('reply-bar-text');
  const $replyCancel    = document.getElementById('reply-cancel');
  const $fileCamera   = document.getElementById('file-camera');
  const $filePhoto    = document.getElementById('file-photo');
  const $fileAny      = document.getElementById('file-any');

  const seenIds = new Set();
  const msgEls = new Map(); // id de mensaje -> burbuja (para actualizar reacciones)
  let lastDayKey = null;
  let lastStatus = 'en línea';
  let busy = false;

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function dayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'HOY';
    if (d.toDateString() === yest.toDateString())  return 'AYER';
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function fmtSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Solo emojis (hasta 3) → se muestran grandes, como en WhatsApp
  function isEmojiOnly(s) {
    if (!s) return false;
    const stripped = s.replace(/[‍️\s]|[\u{1F3FB}-\u{1F3FF}]/gu, '');
    const chars = [...stripped];
    if (chars.length === 0 || chars.length > 3) return false;
    return chars.every(ch => /\p{Extended_Pictographic}/u.test(ch));
  }

  // El adjunto solo se renderiza si apunta a nuestro propio Supabase
  function attachmentUrl(msg) {
    const a = msg.attachment;
    if (!a || typeof a.url !== 'string') return null;
    if (!a.url.startsWith(window.APP_CONFIG.SUPABASE_URL)) return null;
    return a.url;
  }

  // Sticker: intenta la animación de Google; si no existe, emoji gigante
  function stickerElement(emoji) {
    const wrap = document.createElement('div');
    wrap.className = 'sticker-body';
    const img = document.createElement('img');
    img.className = 'sticker-anim';
    img.alt = emoji;
    img.loading = 'lazy';
    img.src = window.EMOJI_ANIM_URL(window.emojiToAnimCode(emoji));
    img.onerror = () => {
      const t = document.createElement('div');
      t.className = 'sticker-static';
      t.textContent = emoji;
      wrap.replaceChildren(t);
    };
    wrap.appendChild(img);
    return wrap;
  }

  function appendMessage(msg, me) {
    if (seenIds.has(msg.id)) return;
    seenIds.add(msg.id);

    const k = dayKey(msg.created_at);
    if (k !== lastDayKey) {
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = dayLabel(msg.created_at);
      $messages.appendChild(sep);
      lastDayKey = k;
    }

    const kind = msg.kind || 'text';
    const url = attachmentUrl(msg);

    const el = document.createElement('div');
    el.className = `bubble ${me ? 'me' : 'them'}`;
    el._msg = msg; // para el gesto de responder
    let metaBlock = false;

    // Cita: si este mensaje responde a otro, mostrar el original arriba
    if (msg.reply_to) {
      const q = document.createElement('div');
      q.className = 'reply-quote';
      const qs = document.createElement('div');
      qs.className = 'reply-quote-sender';
      qs.textContent = msg.reply_to.sender || '';
      const qt = document.createElement('div');
      qt.className = 'reply-quote-text';
      qt.textContent = msg.reply_to.snippet || '';
      q.appendChild(qs);
      q.appendChild(qt);
      el.appendChild(q);
    }

    if (kind === 'sticker') {
      el.classList.add('sticker');
      el.appendChild(stickerElement(msg.body));
      metaBlock = true;
    } else if (kind === 'image' && url) {
      el.classList.add('media');
      const img = document.createElement('img');
      img.className = 'bubble-img';
      img.loading = 'lazy';
      img.alt = 'Foto';
      img.src = url;
      img.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
      el.appendChild(img);
      metaBlock = true;
    } else if (kind === 'file' && url) {
      el.classList.add('media');
      const a = document.createElement('a');
      a.className = 'file-row';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      const ico = document.createElement('span');
      ico.className = 'file-ico';
      ico.textContent = '📄';
      const info = document.createElement('span');
      info.className = 'file-info';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = (msg.attachment && msg.attachment.name) || msg.body || 'archivo';
      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = fmtSize(msg.attachment && msg.attachment.size);
      info.appendChild(name);
      info.appendChild(size);
      a.appendChild(ico);
      a.appendChild(info);
      el.appendChild(a);
      metaBlock = true;
    } else {
      const safe = document.createElement('span');
      safe.textContent = msg.body;
      if (isEmojiOnly(msg.body)) safe.className = 'jumbo';
      el.appendChild(safe);
    }

    const meta = document.createElement('span');
    meta.className = 'meta' + (metaBlock ? ' block' : '');
    meta.textContent = fmtTime(msg.created_at);
    el.appendChild(meta);

    msgEls.set(msg.id, el);
    renderReactions(el, msg.reactions);

    $messages.appendChild(el);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      $messages.scrollTop = $messages.scrollHeight;
    });
  }

  function clearMessages() {
    $messages.innerHTML = '';
    seenIds.clear();
    msgEls.clear();
    lastDayKey = null;
    clearReply();
  }

  function setPeer(roomName) {
    $peerName.textContent = roomName || 'Sala';
    $peerAvatar.textContent = (roomName || '·').charAt(0);
  }

  function setStatus(text) {
    lastStatus = text;
    if (!busy) $peerStatus.textContent = text;
  }

  // ===== Panel de stickers con pestañas =====
  let stickerHandler = null;
  let photoHandler = null;
  let fileHandler = null;
  let activeSetId = null;

  function renderStickerGrid(set) {
    activeSetId = set.id;
    $stickerTabs.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.set === set.id);
    });
    $stickerGrid.replaceChildren();
    const pick = (emoji) => () => {
      hidePanels();
      if (stickerHandler) stickerHandler(emoji);
    };
    set.anim.forEach(([emoji, code]) => {
      const b = document.createElement('button');
      b.type = 'button';
      const img = document.createElement('img');
      img.src = window.EMOJI_ANIM_URL(code);
      img.alt = emoji;
      img.loading = 'lazy';
      img.onerror = () => { b.textContent = emoji; };
      b.appendChild(img);
      b.addEventListener('click', pick(emoji));
      $stickerGrid.appendChild(b);
    });
    set.plain.forEach((emoji) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'plain';
      b.textContent = emoji;
      b.addEventListener('click', pick(emoji));
      $stickerGrid.appendChild(b);
    });
  }

  window.STICKER_SETS.forEach((set) => {
    const t = document.createElement('button');
    t.type = 'button';
    t.dataset.set = set.id;
    t.textContent = set.tab;
    t.title = set.name;
    t.addEventListener('click', () => renderStickerGrid(set));
    $stickerTabs.appendChild(t);
  });

  function hidePanels() {
    $stickerPanel.classList.add('hidden');
    $attachMenu.classList.add('hidden');
  }

  $btnSticker.addEventListener('click', () => {
    if (busy) return;
    $attachMenu.classList.add('hidden');
    const opening = $stickerPanel.classList.contains('hidden');
    $stickerPanel.classList.toggle('hidden');
    if (opening && !activeSetId) renderStickerGrid(window.STICKER_SETS[0]);
  });

  $btnAttach.addEventListener('click', () => {
    if (busy) return;
    $stickerPanel.classList.add('hidden');
    $attachMenu.classList.toggle('hidden');
  });

  // Al abrir cámara/galería/archivos la app pasa a segundo plano por un
  // selector del sistema: avisar para que el escudo de privacidad no bloquee.
  function openPicker($inp) {
    hidePanels();
    window.ChatUI.pickingFile = true;
    $inp.click();
  }

  document.getElementById('attach-camera').addEventListener('click', () => openPicker($fileCamera));
  document.getElementById('attach-photo').addEventListener('click', () => openPicker($filePhoto));
  document.getElementById('attach-file').addEventListener('click', () => openPicker($fileAny));

  // Cámara y galería usan el mismo flujo de foto
  [$fileCamera, $filePhoto].forEach(($inp) => {
    $inp.addEventListener('change', () => {
      const f = $inp.files[0];
      $inp.value = '';
      if (f && photoHandler) photoHandler(f);
    });
  });
  $fileAny.addEventListener('change', () => {
    const f = $fileAny.files[0];
    $fileAny.value = '';
    if (f && fileHandler) fileHandler(f);
  });

  $input.addEventListener('focus', hidePanels);

  // ===== Input que crece + pantalla completa para textos largos =====
  const $composeOverlay = document.getElementById('compose-overlay');
  const $composeText    = document.getElementById('compose-text');
  const $composeClose   = document.getElementById('compose-close');
  const $composeSend    = document.getElementById('compose-send');
  // En compu (mouse) Enter envía y Shift+Enter hace salto de línea; en celular Enter = salto.
  const sendsOnEnter = window.matchMedia('(pointer: fine)').matches;

  // Ajusta la altura del casillero al contenido y muestra el botón de pantalla
  // completa cuando el texto se pone largo.
  function autoGrow() {
    $input.style.height = 'auto';
    $input.style.height = Math.min($input.scrollHeight, 120) + 'px';
    const tall = $input.scrollHeight > 78 || $input.value.length > 120;
    $btnExpand.classList.toggle('show', tall);
  }
  $input.addEventListener('input', autoGrow);

  function submitForm() {
    if ($form.requestSubmit) $form.requestSubmit();
    else $form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && sendsOnEnter) {
      e.preventDefault();
      submitForm();
    }
  });

  function openCompose() {
    $composeText.value = $input.value;
    $composeOverlay.classList.remove('hidden');
    setTimeout(() => $composeText.focus(), 50);
  }
  function closeCompose(keepText) {
    if (keepText) { $input.value = $composeText.value; autoGrow(); }
    $composeOverlay.classList.add('hidden');
  }
  $btnExpand.addEventListener('click', openCompose);
  $composeClose.addEventListener('click', () => { closeCompose(true); $input.focus(); });
  $composeSend.addEventListener('click', () => {
    $input.value = $composeText.value;
    closeCompose(false);
    submitForm();
  });
  // Privacidad: si la app pasa a segundo plano, cerrar la pantalla de escribir
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') closeCompose(true);
  });

  // ===== Responder mensajes (deslizar / doble clic) =====
  let replyingTo = null;

  function replySnippet(msg) {
    const kind = msg.kind || 'text';
    if (kind === 'sticker') return msg.body || '🙂';
    if (kind === 'image') return '📷 Foto';
    if (kind === 'file') return '📄 ' + ((msg.attachment && msg.attachment.name) || 'Archivo');
    return (msg.body || '').slice(0, 80);
  }

  function setReply(msg) {
    if (!msg || !msg.id) return;
    replyingTo = { id: msg.id, sender: msg.sender, snippet: replySnippet(msg), kind: msg.kind || 'text' };
    $replyBarSender.textContent = msg.sender || '';
    $replyBarText.textContent = replyingTo.snippet;
    $replyBar.classList.remove('hidden');
    setTimeout(() => $input.focus(), 30);
  }
  function clearReply() {
    replyingTo = null;
    $replyBar.classList.add('hidden');
  }
  function takeReply() {
    const r = replyingTo;
    clearReply();
    return r;
  }
  $replyCancel.addEventListener('click', clearReply);

  // Gesto táctil: deslizar una burbuja hacia la derecha para responderla
  let swipeEl = null, swipeStartX = 0, swipeStartY = 0, swiping = false;
  $messages.addEventListener('touchstart', (e) => {
    const b = e.target.closest('.bubble');
    if (!b || !b._msg) { swipeEl = null; return; }
    swipeEl = b;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swiping = false;
  }, { passive: true });
  $messages.addEventListener('touchmove', (e) => {
    if (!swipeEl) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;
    if (Math.abs(dy) > Math.abs(dx)) { swipeEl.style.transform = ''; swipeEl = null; return; }
    if (dx > 0) {
      swiping = true;
      swipeEl.style.transition = 'none';
      swipeEl.style.transform = `translateX(${Math.min(dx, 80)}px)`;
    }
  }, { passive: true });
  $messages.addEventListener('touchend', (e) => {
    if (!swipeEl) return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    swipeEl.style.transition = 'transform 0.15s';
    swipeEl.style.transform = '';
    if (swiping && dx > 55) {
      setReply(swipeEl._msg);
      if (navigator.vibrate) navigator.vibrate(20);
    }
    swipeEl = null;
    swiping = false;
  }, { passive: true });

  // En compu: doble clic en un mensaje para responderlo
  $messages.addEventListener('dblclick', (e) => {
    const b = e.target.closest('.bubble');
    if (b && b._msg) setReply(b._msg);
  });

  // ===== Reacciones (mantener presionado / clic derecho) =====
  const $reactionPicker = document.getElementById('reaction-picker');
  let reactHandler = null;
  let pickerMsgId = null;
  let pickerJustOpened = false;

  function renderReactions(el, reactions) {
    const emojis = reactions ? Object.values(reactions) : [];
    let chip = el.querySelector('.reactions');
    el.classList.toggle('has-reactions', emojis.length > 0);
    if (!emojis.length) { if (chip) chip.remove(); return; }
    if (!chip) { chip = document.createElement('div'); chip.className = 'reactions'; el.appendChild(chip); }
    const counts = {};
    emojis.forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    chip.textContent = '';
    Object.keys(counts).forEach(e => {
      const s = document.createElement('span');
      s.className = 'reaction-chip';
      s.textContent = counts[e] > 1 ? e + counts[e] : e;
      chip.appendChild(s);
    });
  }

  function updateReactions(messageId, reactions) {
    const el = msgEls.get(messageId);
    if (!el) return;
    if (el._msg) el._msg.reactions = reactions;
    renderReactions(el, reactions);
  }

  function showReactionPicker(b) {
    if (!b || !b._msg || b._msg.id == null) return;
    pickerMsgId = b._msg.id;
    $reactionPicker.classList.remove('hidden');
    const pw = $reactionPicker.offsetWidth || 250;
    const ph = $reactionPicker.offsetHeight || 44;
    const r = b.getBoundingClientRect();
    let left = b.classList.contains('me') ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    let top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    $reactionPicker.style.left = left + 'px';
    $reactionPicker.style.top = top + 'px';
    pickerJustOpened = true;
    setTimeout(() => { pickerJustOpened = false; }, 350);
  }
  function hideReactionPicker() { $reactionPicker.classList.add('hidden'); pickerMsgId = null; }

  $reactionPicker.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (pickerMsgId != null && reactHandler) reactHandler(pickerMsgId, btn.dataset.emoji);
      hideReactionPicker();
    });
  });
  document.addEventListener('click', (e) => {
    if (pickerJustOpened) return;
    if (!$reactionPicker.classList.contains('hidden') && !$reactionPicker.contains(e.target)) hideReactionPicker();
  });

  // Mantener presionado una burbuja para reaccionar
  let lpTimer = null, lpStartX = 0, lpStartY = 0;
  $messages.addEventListener('touchstart', (e) => {
    const b = e.target.closest('.bubble');
    if (!b || !b._msg) return;
    lpStartX = e.touches[0].clientX; lpStartY = e.touches[0].clientY;
    lpTimer = setTimeout(() => { lpTimer = null; showReactionPicker(b); if (navigator.vibrate) navigator.vibrate(25); }, 450);
  }, { passive: true });
  $messages.addEventListener('touchmove', (e) => {
    if (!lpTimer) return;
    if (Math.abs(e.touches[0].clientX - lpStartX) > 10 || Math.abs(e.touches[0].clientY - lpStartY) > 10) {
      clearTimeout(lpTimer); lpTimer = null;
    }
  }, { passive: true });
  $messages.addEventListener('touchend', () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }, { passive: true });

  // En compu: clic derecho en un mensaje para reaccionar
  $messages.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('.bubble');
    if (b && b._msg) { e.preventDefault(); showReactionPicker(b); }
  });

  // Mientras sube un archivo: bloquear input y mostrar estado
  function setBusy(text) {
    busy = !!text;
    $form.classList.toggle('busy', busy);
    $input.disabled = busy;
    $peerStatus.textContent = busy ? text : lastStatus;
  }

  window.ChatUI = {
    appendMessage,
    clearMessages,
    setPeer,
    setStatus,
    scrollToBottom,
    hidePanels,
    setBusy,
    setReply,
    takeReply,
    onReact(fn) { reactHandler = fn; },
    updateReactions,
    pickingFile: false, // true mientras hay cámara/selector del sistema abierto
    onSubmit(handler) {
      $form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (busy) return;
        const text = $input.value.trim();
        if (!text) return;
        $input.value = '';
        autoGrow();
        hidePanels();
        handler(text);
      });
    },
    onSticker(handler) { stickerHandler = handler; },
    onPickPhoto(handler) { photoHandler = handler; },
    onPickFile(handler) { fileHandler = handler; },
    focusInput() { setTimeout(() => $input.focus(), 50); },
    blurInput() { $input.blur(); }
  };
})();
