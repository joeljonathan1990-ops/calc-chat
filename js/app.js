// Orquestador: une calculadora + chat + secreto + estado + ajustes de privacidad.
(function () {
  const LS_KEY = 'calcchat.settings.v1';
  const UNREAD_KEY = 'calcchat.unread.v1';

  // Ajustes de comportamiento (por dispositivo). hidden=modo oculto,
  // idleLock=segundos de inactividad para bloquear (0=nunca),
  // sound=tono de mensaje, vibrate=vibración, push=avisos con la app cerrada.
  const BEHAVIOR_DEFAULTS = { hidden: true, idleLock: 300, sound: 'pop', vibrate: true, push: false };

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
    startPolling();
    ChatUI.scrollToBottom();
    ChatUI.focusInput();
  }

  function closeChat() {
    clearIdle();
    stopPolling();
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
  const $setIdle     = document.getElementById('set-idle');
  const $rowIdle     = document.getElementById('row-idle');
  const $setSound    = document.getElementById('set-sound');
  const $setVibrate  = document.getElementById('set-vibrate');
  const $setPush     = document.getElementById('set-push');

  // Probar el tono al elegirlo
  $setSound.addEventListener('change', () => Sounds.play($setSound.value));

  // Con modo oculto apagado, los bloqueos no aplican (el chat ES la app)
  function refreshLockRows() {
    const on = $setHidden.checked;
    $rowIdle.classList.toggle('disabled', !on);
    $setIdle.disabled = !on;
  }
  $setHidden.addEventListener('change', refreshLockRows);

  $chatSettings.addEventListener('click', () => {
    $setName.value = settings.name;
    $setRoom.value = settings.room;
    $setSecret.value = settings.secret;
    $setHidden.checked = settings.hidden;
    $setIdle.value = String(settings.idleLock);
    $setSound.value = settings.sound;
    $setVibrate.checked = settings.vibrate;
    $setPush.checked = settings.push;
    refreshLockRows();
    $setOverlay.classList.remove('hidden');
  });

  $setCancel.addEventListener('click', () => $setOverlay.classList.add('hidden'));

  $setSave.addEventListener('click', async () => {
    const name   = $setName.value.trim();
    const room   = $setRoom.value.trim();
    const secret = $setSecret.value.trim();
    if (!name || !room || !secret || !secret.endsWith('=')) {
      alert('Completá los 3 campos. El código secreto debe terminar en =');
      return;
    }
    const roomChanged = room !== settings.room;
    const pushWas = settings.push;
    const pushWanted = $setPush.checked;

    settings = Object.assign({}, settings, {
      name, room, secret,
      hidden: $setHidden.checked,
      idleLock: parseInt($setIdle.value, 10) || 0,
      sound: $setSound.value,
      vibrate: $setVibrate.checked,
      push: pushWanted
    });
    saveSettings(settings);
    if (roomChanged) {
      ChatUI.clearMessages();
      initChatConnection();
    }
    ChatUI.setPeer(settings.room);
    $setOverlay.classList.add('hidden');
    resetIdle();

    // Push: activar/desactivar/re-vincular según corresponda
    try {
      if (pushWanted && !pushWas) {
        const ok = await enablePush();
        if (!ok) {
          // enablePush ya mostró el motivo exacto cuando corresponde
          settings.push = false;
          saveSettings(settings);
        }
      } else if (!pushWanted && pushWas) {
        await disablePush();
      } else if (pushWanted && pushWas) {
        await syncPush(); // re-vincular por si cambió la sala o el nombre
      }
    } catch (e) {
      console.error(e);
      if (pushWanted && !pushWas) {
        // La suscripción falló con excepción: revertir para no quedar "activado" en falso
        settings.push = false;
        saveSettings(settings);
        alert('No se pudieron activar los avisos: ' + e.message);
      }
    }
  });

  $setClear.addEventListener('click', async () => {
    if (!confirm('¿Borrar TODA la conversación para los dos? Se elimina del servidor y NO se puede deshacer.')) return;
    if (!window.ChatAPI.configured) { ChatUI.clearMessages(); return; }
    try {
      await ChatAPI.clearChat();
      ChatUI.clearMessages();
      $setOverlay.classList.add('hidden');
      alert('Conversación borrada.');
    } catch (e) {
      console.error(e);
      alert('No se pudo borrar: ' + e.message);
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
        // Sonido configurable al recibir (con la app abierta)
        Sounds.play(settings.sound);
        // Mensaje entrante: si el chat NO está abierto, marcar unread
        if ($chatOverlay.classList.contains('hidden')) {
          setUnread(true);
          // Vibración corta si el dispositivo lo soporta (señal discreta)
          if (settings.vibrate && navigator.vibrate) navigator.vibrate(50);
        }
      }
    });

    // Si la otra persona borra la conversación, limpiar la vista acá también
    ChatAPI.onCleared(() => ChatUI.clearMessages());
  }

  // ===== Recepción robusta de mensajes =====
  // Red de seguridad por si se perdió un broadcast en vivo: recarga el historial
  // y agrega SOLO lo nuevo (appendMessage descarta lo ya visto por id).
  async function refreshHistory() {
    if (!settings || !window.ChatAPI.configured) return;
    if ($chatOverlay.classList.contains('hidden')) return;
    const history = await ChatAPI.loadHistory();
    history.forEach(m => ChatUI.appendMessage(m, m.sender === settings.name));
  }

  // Sondeo suave mientras el chat está abierto y visible (respaldo del tiempo real).
  let pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' &&
          !$chatOverlay.classList.contains('hidden')) {
        refreshHistory();
      }
    }, 7000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ===== Escudo de privacidad =====
  // Android saca una "foto" de la pantalla al pasar la app a segundo plano
  // (vista de apps recientes). Con modo oculto activo, cerramos el chat al
  // instante para que esa foto muestre solo la calculadora.
  let pushPrompting = false; // true durante el diálogo de permiso de notificaciones

  function lockForBackground() {
    if (!settings || !settings.hidden) return;
    if (ChatUI.pickingFile || pushPrompting) return; // cámara/galería/permiso: no bloquear
    $setOverlay.classList.add('hidden');
    $loginOverlay.classList.add('hidden');
    if (!$chatOverlay.classList.contains('hidden')) closeChat();
  }

  window.addEventListener('blur', lockForBackground);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lockForBackground();
    else refreshHistory();
  });

  // Al volver del selector de archivos/cámara, rearmar el escudo
  window.addEventListener('focus', () => {
    setTimeout(() => { ChatUI.pickingFile = false; }, 800);
    refreshHistory();
  });

  // ===== Notificaciones push (app cerrada / segundo plano) =====
  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function getSub() {
    const reg = await navigator.serviceWorker.ready;
    return { reg, sub: await reg.pushManager.getSubscription() };
  }

  // Pide permiso, se suscribe y guarda la suscripción en el servidor
  async function enablePush() {
    if (!pushSupported()) {
      alert('Este navegador no soporta avisos en segundo plano. En iPhone: primero "Agregar a pantalla de inicio".');
      return false;
    }
    if (!window.ChatAPI.configured) return false;
    pushPrompting = true; // el diálogo de permiso quita el foco: no activar el escudo
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        if (Notification.permission === 'denied') {
          alert('Las notificaciones están BLOQUEADAS para esta app.\n\n' +
            'Si la usás desde Chrome:\n' +
            '1. Tocá el candado 🔒 al lado de la dirección\n' +
            '2. Permisos → Notificaciones → Permitir\n\n' +
            'Si está instalada en la pantalla de inicio:\n' +
            '1. Ajustes de Android → Aplicaciones\n' +
            '2. Buscá "Calculadora" → Notificaciones → Permitir\n\n' +
            'Después volvé acá y activá el aviso de nuevo.');
        }
        return false;
      }
      const { reg } = await getSub();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(window.APP_CONFIG.VAPID_PUBLIC)
      });
      await ChatAPI.savePushSub(settings.room, settings.name, sub.toJSON());
      return true;
    } finally {
      pushPrompting = false;
    }
  }

  async function disablePush() {
    if (!pushSupported()) return;
    const { sub } = await getSub();
    if (sub) {
      if (window.ChatAPI.configured) await ChatAPI.removePushSub(sub.endpoint);
      await sub.unsubscribe();
    }
  }

  // Mantiene la suscripción vinculada a la sala/nombre actuales
  async function syncPush() {
    if (!pushSupported() || !window.ChatAPI.configured) return;
    if (Notification.permission !== 'granted') return;
    const { sub } = await getSub();
    if (sub) await ChatAPI.savePushSub(settings.room, settings.name, sub.toJSON());
    else await enablePush();
  }

  // ===== Envío de mensajes (texto, sticker, foto, archivo) =====
  async function sendMessage(kind, body, attachment) {
    const reply = ChatUI.takeReply();
    try {
      if (window.ChatAPI.configured) {
        // El broadcast no nos llega a nosotros (self:false) → agregar la fila devuelta
        const row = await ChatAPI.send(body, kind, attachment, reply);
        ChatUI.appendMessage(row, true);
      } else {
        // Modo demo
        ChatUI.appendMessage({
          id: Date.now(),
          sender: settings.name,
          body, kind, attachment, reply_to: reply,
          created_at: new Date().toISOString()
        }, true);
      }
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
      navigator.serviceWorker.register('sw.js')
        .then(() => {
          // Si los avisos están activos, mantener la suscripción al día
          if (settings && settings.push) syncPush().catch(() => {});
        })
        .catch(() => {});
    });
  }
})();
