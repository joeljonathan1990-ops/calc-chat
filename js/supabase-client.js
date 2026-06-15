// Cliente Supabase + capa de chat (privado por sala).
// - SELECT/INSERT directos están bloqueados por RLS.
// - Mensajes se mandan via RPC `send_chat`, que también hace broadcast a la sala.
// - Realtime via canal broadcast `room:X`, no via postgres_changes (más privado).
// - Fotos/archivos se suben al bucket `chat-media` (URLs con UUID, no adivinables).
(function () {
  const url = window.APP_CONFIG.SUPABASE_URL;
  const key = window.APP_CONFIG.SUPABASE_ANON_KEY;

  const configured = url && !url.startsWith('__') && key && !key.startsWith('__');

  if (!configured) {
    window.ChatAPI = {
      configured: false,
      init() {},
      async send() { throw new Error('Supabase no configurado'); },
      async upload() { throw new Error('Supabase no configurado'); },
      async savePushSub() { throw new Error('Supabase no configurado'); },
      async removePushSub() {},
      onMessage() {},
      async loadHistory() { return []; },
      disconnect() {}
    };
    console.warn('[ChatAPI] Sin credenciales Supabase. Modo demo local.');
    return;
  }

  const client = supabase.createClient(url, key, {
    realtime: { params: { eventsPerSecond: 10 } }
  });

  let channel = null;
  let listeners = [];
  let currentRoom = null;
  let currentSender = null;

  window.ChatAPI = {
    configured: true,

    init({ room, sender }) {
      currentRoom = room;
      currentSender = sender;

      if (channel) {
        client.removeChannel(channel);
        channel = null;
      }

      channel = client
        .channel(`room:${room}`, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'new_message' }, ({ payload }) => {
          // payload es el JSON que mandó la RPC
          if (!payload || !payload.id) return;
          listeners.forEach(fn => fn(payload));
        })
        .subscribe();
    },

    // kind: 'text' | 'sticker' | 'image' | 'file'
    // attachment: { url, name, size, mime } o null
    async send(text, kind = 'text', attachment = null) {
      if (!currentRoom || !currentSender) throw new Error('Chat no inicializado');
      const { data, error } = await client.rpc('send_chat', {
        p_room: currentRoom,
        p_sender: currentSender,
        p_body: text,
        p_kind: kind,
        p_attachment: attachment
      });
      if (error) throw error;
      return data;
    },

    // Sube un archivo al bucket y devuelve su URL pública.
    async upload(blob, path, mime) {
      const { error } = await client.storage
        .from('chat-media')
        .upload(path, blob, { contentType: mime || 'application/octet-stream', upsert: false });
      if (error) throw error;
      return client.storage.from('chat-media').getPublicUrl(path).data.publicUrl;
    },

    // Suscripción a notificaciones push (una por dispositivo)
    async savePushSub(room, sender, sub) {
      const { error } = await client.rpc('save_push_sub', {
        p_room: room, p_sender: sender, p_sub: sub
      });
      if (error) throw error;
    },

    async removePushSub(endpoint) {
      const { error } = await client.rpc('remove_push_sub', { p_endpoint: endpoint });
      if (error) console.error(error);
    },

    onMessage(fn) { listeners.push(fn); },

    async loadHistory(limit = 500) {
      if (!currentRoom) return [];
      const { data, error } = await client.rpc('load_chat', {
        p_room: currentRoom,
        p_limit: limit
      });
      if (error) { console.error(error); return []; }
      return data || [];
    },

    disconnect() {
      if (channel) { client.removeChannel(channel); channel = null; }
      listeners = [];
    }
  };
})();
