// Tonos de notificación sintetizados con Web Audio (sin archivos de audio).
// Nombres: pop, campanita, ding, burbuja. 'off' o desconocido = silencio.
window.Sounds = (function () {
  let ctx = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Oscilador con envolvente de caída exponencial
  function tone(c, { type = 'sine', from, to = null, dur, vol = 0.25, delay = 0 }) {
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const tones = {
    pop(c)       { tone(c, { from: 880, to: 220, dur: 0.12, vol: 0.3 }); },
    campanita(c) { tone(c, { type: 'triangle', from: 1318, dur: 0.5, vol: 0.25 });
                   tone(c, { type: 'triangle', from: 1976, dur: 0.4, vol: 0.12, delay: 0.06 }); },
    ding(c)      { tone(c, { from: 880, dur: 0.6, vol: 0.3 }); },
    burbuja(c)   { tone(c, { from: 260, to: 900, dur: 0.18, vol: 0.25 });
                   tone(c, { from: 520, to: 1400, dur: 0.12, vol: 0.12, delay: 0.1 }); }
  };

  return {
    play(name) {
      if (!name || name === 'off' || !tones[name]) return;
      try {
        const c = ac();
        if (c) tones[name](c);
      } catch (e) { /* sin audio disponible */ }
    }
  };
})();
