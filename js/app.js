// Orquestador: une calculadora + chat + secreto + estado + ajustes de privacidad.
(function () {
  const LS_KEY = 'calcchat.settings.v1';
  const UNREAD_KEY = 'calcchat.unread.v1';

  // Ajustes de comportamiento (por dispositivo). hidden=modo oculto,
  // autoLock=bloquear al enviar, idleLock=segundos de inactividad (0=nunca).
  const BEHAVIOR_DEFAULTS = { hidden: true, autoLock: true, idleLock: 300 };

  const MAX_FILE_BYTES = 20 * 1024 * 1024; // límite del bucket

  const $calculator = document.getElementById('calculator');
  const $body = document.body;
  const $loginOverlay  = document.getElementById('login-overlay');
  const $chatOverlay   = document.getElementById('chat-overlay');
  const $setOverlay    = document.getElementById('settings-overlay');

  // ===== Settings =====
  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(LS_KEY));
      if (!stored) return null;
      // Migración: completar claves nuevas con los defaults
      return Object.assign({}, BEHAVIOR_DEFAULTS, stored);
    } catch { return null; }
  }
  function saveSettings(s) {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  }

  let settings = loadSettings();

  function generateRoom() {
    // 12 chars de [a-z0-9] = ~62 bits de entropía. Cripto-aleatorio.
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // sin caracteres confusos
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12);
  }

  // ===== Unread badge (sobrevive recargas) =====
  function setUnread(flag) {
    if (flag) {
      $body.classList.add('has-unread');
      localStorage.setItem(UNREAD_KEY, '1');
    } else {
      $body.classList.remove('has-unread');
      localStorage.removeItem(UNREAD_KEY);
    }
  }
  function loadUnread() {
    if (localStorage.getItem(UNREAD_KEY) === '1') {
      $body.classList.add('has-unread');
    }
  }

  // ===== API expuesta a calculator.js =====
  window.CalcAPI = {
    getSecret() {
      return settings ? settings.secret : window.APP_CONFIG.DEFAULT_SECRET;
    },
    onSecretMatch() {
      if (!settings) {
        // Nunca configurado → mostrar login
        openLogin();
      } else {
        openChat();
      }
    }
  };

  // ===== Login overlay =====
  const $loginName   = document.getElementById('login-name');
  const $loginRoom   = document.getElementById('login-room');
  const $loginSecret = document.getElementById('login-secret');
  const $loginSave   = document.getElementById('login-save');

  function openLogin() {
    if (settings) {
      $loginName.value = settings.name;
      $loginRoom.value = settings.room;
      $loginSecret.value = settings.secret;
    } else {
      $loginSecret.value = window.APP_CONFIG.DEFAULT_SECRET;
      $loginRoom.value = generateRoom();
    }
    $loginOverlay.classList.remove('hidden');
    setTimeout(() => $loginName.focus(), 100);
  }

  document.getElementById('login-room-gen').addEventListener('click', () => {
    $loginRoom.value = generateRoom();
  });
  document.getElementById('set-room-gen').addEventListener('click', () => {
    document.getElementById('set-room').value = generateRoom();
  });

  $loginSave.addEventListener('click', () => {
    const name   = $loginName.value.trim();
    const room   = $loginRoom.value.trim();
    const secret = $loginSecret.value.trim();
    if (!name || !room || !secret || !secret.endsWith('=')) {
      alert('Completá los 3 campos. El código secreto debe terminar en =');
      return;
    }
    settings = Object.assign({}, BEHAVIOR_DEFAULTS, { name, room, secret });
    saveSettings(settings);
    $loginOverlay.classList.add('hidden');
    initChatConnection();
    openChat();
  });

  // ===== Bloqueo por inactividad =====
  let idleTimer = null;

  function clearIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function resetIdle() {
    clearIdle();
    if (!settings || !settings.hidden || !settings.idleLock) return;
    if ($chatOverlay.classList.contains('hidden')) return;
    idleTimer = setTimeout(() => closeChat(), settings.idleLock * 1000);
  }

  // Cualquier interacción dentro del chat reinicia el contador
  ['touchstart', 'mousedown', 'keydown', 'input'].forEach(ev => {
    $chatOverlay.addEventListener(ev, resetIdle, { passive: true });
  });

  // ===== Chat overlay =====
  const $chatBack = document.getElementById('chat-back');
  const $chatSettings = document.getElementById('chat-settings');
  let demoAlerted = false;

  async function openChat() {
    if (!settings) { openLogin(); return; }
    if ((!window.ChatAPI || !window.ChatAPI.configured) && !demoAlerted) {
      demoAlerted = true;
      alert('Backend no configurado. Esto es una demo local — los mensajes no se sincronizan entre dispositivos.');
    }
    ChatUI.setPeer(settings.room);
    $chatOverlay.classList.remove('hidden');
    setUnread(false);
    resetIdle();
    // Recargar historial por si se perdió algún broadcast con la app cerrada
    if (window.ChatAPI.configured) {
      const history = await ChatAPI.loadHistory();
      ChatUI.clearMessages();
      history.forEach(m => ChatUI.appendMessage(m, m.sender === settings.name));
    }
    ChatUI.scrollToBottom();
    ChatUI.focusInput();
  }

  function closeChat() {
    clearIdle();
    ChatUI.hidePanels();
    ChatUI.blurInput();
    $chatOverlay.classList.add('hidden');
  }

  $chatBack.addEventListener('click', closeChat);

  // Botón físico "atrás" en Android cierra el chat (no la app)
  window.addEventListener('popstate', () => {
    if (!$chatOverlay.classList.contains('hidden')) closeChat();
  });

  // ===== Settings overlay =====
  const $setName   = document.getElementById('set-name');
  const $setRoom   = document.getElementById('set-room');
  const $setSecret = document.getElementById('set-secret');
  const $setSave   = document.getElementById('set-save');
  const $setCancel = document.getElementById('set-cancel');
  const $setClear  = document.getElementById('set-clear');

  const $setHidden   = document.getElementById('set-hidden');
  const $setAutolock = document.getElementById('set-autolock');
  const $setIdle     = document.getElementById('set-idle');
  const $rowAutolock = document.getElementById('row-autolock');
  const $rowIdle     = document.getElementById('row-idle');

  // Con modo oculto apagado, los bloqueos no aplican (el chat ES la app)
  function refreshLockRows() {
    const on = $setHidden.checked;
    $rowAutolock.classList.toggle('disabled', !on);
    $rowIdle.classList.toggle('disabled', !on);
    $setAutolock.disabled = !on;
    $setIdle.disabled = !on;
  }
  $setHidden.addEventListener('change', refreshLockRows);

  $chatSettings.addEventListener('click', () => {
    $setName.value = settings.name;
    $setRoom.value = settings.room;
    $setSecret.value = settings.secret;
    $setHidden.checked = settings.hidden;
    $setAutolock.checked = settings.autoLock;
    $setIdle.value = String(settings.idleLock);
    refreshLockRows();
    $setOverlay.classList.remove('hidden');
  });

  $setCancel.addEventListener('click', () => $setOverlay.classList.add('hidden'));

  $setSave.addEventListener('click', () => {
    const name   = $setName.value.trim();
    const room   = $setRoom.value.trim();
    const secret = $setSecret.value.trim();
    if (!name || !room || !secret || !secret.endsWith('=')) {
      alert('Completá los 3 campos. El código secreto debe terminar en =');
      return;
    }
    const roomChanged = room !== settings.room;
    settings = Object.assign({}, settings, {
      name, room, secret,
      hidden: $setHidden.checked,
      autoLock: $setAutolock.checked,
      idleLock: parseInt($setIdle.value, 10) || 0
    });
    saveSettings(settings);
    if (roomChanged) {
      ChatUI.clearMessages();
      initChatConnection();
    }
    ChatUI.setPeer(settings.room);
    $setOverlay.classList.add('hidden');
    resetIdle();
  });

  $setClear.addEventListener('click', () => {
    if (confirm('Borrar la conversación local? (No borra del servidor)')) {
      ChatUI.clearMessages();
    }
  });

  // ===== Conexión chat =====
  async function initChatConnection() {
    if (!window.ChatAPI.configured) {
      ChatUI.setStatus('demo local');
      return;
    }
    ChatUI.setStatus('conectando…');
    ChatAPI.disconnect();
    ChatAPI.init({ room: settings.room, sender: settings.name });

    ChatUI.clearMessages();
    const history = await ChatAPI.loadHistory();
    history.forEach(m => ChatUI.appendMessage(m, m.sender === settings.name));
    ChatUI.setStatus('en línea');

    ChatAPI.onMessage((msg) => {
      const me = msg.sender === settings.name;
      ChatUI.appendMessage(msg, me);
      if (!me) {
        // Mensaje entrante: si el chat NO está abierto, marcar unread
        if ($chatOverlay.classList.contains('hidden')) {
          setUnread(true);
          // Vibración corta si el dispositivo lo soporta (señal discreta)
          if (navigator.vibrate) navigator.vibrate(50);
        }
      }
    });
  }

  // ===== Envío de mensajes (texto, sticker, foto, archivo) =====
  async function sendMessage(kind, body, attachment) {
    try {
      if (window.ChatAPI.configured) {
        // El broadcast no nos llega a nosotros (self:false) → agregar la fila devuelta
        const row = await ChatAPI.send(body, kind, attachment);
        ChatUI.appendMessage(row, true);
      } else {
        // Modo demo
        ChatUI.appendMessage({
          id: Date.now(),
          sender: settings.name,
          body, kind, attachment,
          created_at: new Date().toISOString()
        }, true);
      }
      // 👉 Bloqueo al enviar: solo si está en modo oculto y la opción activa
      if (settings.hidden && settings.autoLock) closeChat();
    } catch (e) {
      console.error(e);
      alert('No se pudo enviar: ' + e.message);
    }
  }

  ChatUI.onSubmit((text) => sendMessage('text', text, null));
  ChatUI.onSticker((emoji) => sendMessage('sticker', emoji, null));

  // ===== Fotos y archivos =====
  function safeName(name) {
    const clean = (name || 'archivo').normalize('NFKD').replace(/[^\w.\-]+/g, '_');
    return clean.slice(-60) || 'archivo';
  }

  function uploadPath(name) {
    return crypto.randomUUID() + '/' + safeName(name);
  }

  // Comprime imágenes a máx 1600px JPEG (los GIF van como están, para no perder la animación)
  async function compressImage(file) {
    if (file.type === 'image/gif') return { blob: file, mime: file.type, name: file.name };
    try {
      const bitmap = await createImageBitmap(file);
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
      if (!blob) throw new Error('canvas vacío');
      const name = file.name.replace(/\.[^.]*$/, '') + '.jpg';
      return { blob, mime: 'image/jpeg', name };
    } catch {
      // Formato que el navegador no decodifica → mandar original
      return { blob: file, mime: file.type || 'application/octet-stream', name: file.name };
    }
  }

  ChatUI.onPickPhoto(async (file) => {
    if (!window.ChatAPI.configured) { alert('Las fotos necesitan el backend configurado.'); return; }
    try {
      ChatUI.setBusy('enviando foto…');
      const img = await compressImage(file);
      if (img.blob.size > MAX_FILE_BYTES) throw new Error('La foto supera los 20 MB');
      const url = await ChatAPI.upload(img.blob, uploadPath(img.name), img.mime);
      ChatUI.setBusy(null); // liberar el input antes del posible auto-bloqueo
      await sendMessage('image', '', { url, name: img.name, size: img.blob.size, mime: img.mime });
    } catch (e) {
      console.error(e);
      alert('No se pudo enviar la foto: ' + e.message);
    } finally {
      ChatUI.setBusy(null);
    }
  });

  ChatUI.onPickFile(async (file) => {
    if (!window.ChatAPI.configured) { alert('Los archivos necesitan el backend configurado.'); return; }
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('El archivo supera los 20 MB');
      ChatUI.setBusy('enviando archivo…');
      const mime = file.type || 'application/octet-stream';
      const url = await ChatAPI.upload(file, uploadPath(file.name), mime);
      ChatUI.setBusy(null); // liberar el input antes del posible auto-bloqueo
      await sendMessage('file', file.name, { url, name: file.name, size: file.size, mime });
    } catch (e) {
      console.error(e);
      alert('No se pudo enviar el archivo: ' + e.message);
    } finally {
      ChatUI.setBusy(null);
    }
  });

  // ===== Arranque =====
  loadUnread();
  if (settings) {
    const boot = initChatConnection();
    // Modo visible: abrir el chat recién cuando la conexión terminó de cargar
    // el historial (evita la doble carga simultánea)
    if (!settings.hidden) boot.then(() => openChat());
  }
  // (si no hay settings, esperar al primer match del secreto para mostrar login)

  // Service worker para PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
