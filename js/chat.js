// UI del chat: renderiza burbujas, maneja input, separadores por día.
(function () {
  const $messages = document.getElementById('messages');
  const $form     = document.getElementById('chat-form');
  const $input    = document.getElementById('message-input');
  const $peerName = document.getElementById('peer-name');
  const $peerAvatar = document.getElementById('peer-avatar');
  const $peerStatus = document.getElementById('peer-status');

  const seenIds = new Set();
  let lastDayKey = null;

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

    const el = document.createElement('div');
    el.className = `bubble ${me ? 'me' : 'them'}`;
    const safe = document.createElement('span');
    safe.textContent = msg.body;
    el.appendChild(safe);

    const meta = document.createElement('span');
    meta.className = 'meta';
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
    $peerStatus.textContent = text;
  }

  window.ChatUI = {
    appendMessage,
    clearMessages,
    setPeer,
    setStatus,
    scrollToBottom,
    onSubmit(handler) {
      $form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = $input.value.trim();
        if (!text) return;
        $input.value = '';
        handler(text);
      });
    },
    focusInput() { setTimeout(() => $input.focus(), 50); },
    blurInput() { $input.blur(); }
  };
})();
