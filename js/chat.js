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
  const $fileCamera   = document.getElementById('file-camera');
  const $filePhoto    = document.getElementById('file-photo');
  const $fileAny      = document.getElementById('file-any');

  const seenIds = new Set();
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
    let metaBlock = false;

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
    lastDayKey = null;
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

  document.getElementById('attach-camera').addEventListener('click', () => {
    hidePanels();
    $fileCamera.click();
  });
  document.getElementById('attach-photo').addEventListener('click', () => {
    hidePanels();
    $filePhoto.click();
  });
  document.getElementById('attach-file').addEventListener('click', () => {
    hidePanels();
    $fileAny.click();
  });

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
    onSubmit(handler) {
      $form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (busy) return;
        const text = $input.value.trim();
        if (!text) return;
        $input.value = '';
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
