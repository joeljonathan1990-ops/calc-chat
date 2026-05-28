// Orquestador: une calculadora + chat + secreto + estado.
(function () {
  const LS_KEY = 'calcchat.settings.v1';
  const UNREAD_KEY = 'calcchat.unread.v1';

  const $calculator = document.getElementById('calculator');
  const $body = document.body;
  const $loginOverlay  = document.getElementById('login-overlay');
  const $chatOverlay   = document.getElementById('chat-overlay');
  const $setOverlay    = document.getElementById('settings-overlay');

  // ===== Settings =====
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; }
    catch { return null; }
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
    settings = { name, room, secret };
    saveSettings(settings);
    $loginOverlay.classList.add('hidden');
    initChatConnection();
    openChat();
  });

  // ===== Chat overlay =====
  const $chatBack = document.getElementById('chat-back');
  const $chatSettings = document.getElementById('chat-settings');

  async function openChat() {
    if (!settings) { openLogin(); return; }
    if (!window.ChatAPI || !window.ChatAPI.configured) {
      alert('Backend no configurado. Esto es una demo local — los mensajes no se sincronizan entre dispositivos.');
    }
    ChatUI.setPeer(settings.room);
    $chatOverlay.classList.remove('hidden');
    setUnread(false);
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

  $chatSettings.addEventListener('click', () => {
    $setName.value = settings.name;
    $setRoom.value = settings.room;
    $setSecret.value = settings.secret;
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
    settings = { name, room, secret };
    saveSettings(settings);
    if (roomChanged) {
      ChatUI.clearMessages();
      initChatConnection();
    }
    ChatUI.setPeer(settings.room);
    $setOverlay.classList.add('hidden');
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

  ChatUI.onSubmit(async (text) => {
    try {
      if (window.ChatAPI.configured) {
        await ChatAPI.send(text);
      } else {
        // Modo demo
        const msg = {
          id: Date.now(),
          sender: settings.name,
          body: text,
          created_at: new Date().toISOString()
        };
        ChatUI.appendMessage(msg, true);
      }
      // 👉 Al enviar mensaje, el chat se cierra automáticamente.
      closeChat();
    } catch (e) {
      console.error(e);
      alert('No se pudo enviar: ' + e.message);
    }
  });

  // ===== Arranque =====
  loadUnread();
  if (settings) {
    initChatConnection();
  }
  // (si no hay settings, esperar al primer match del secreto para mostrar login)

  // Service worker para PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
