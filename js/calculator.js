// Calculadora 100% funcional + detector de código secreto.
// Cada vez que el usuario pulsa una tecla, se guarda la secuencia "raw"
// (los símbolos +, -, *, /, números, .) y se compara con el secreto al pulsar =.
(function () {
  const $result  = document.getElementById('result');
  const $history = document.getElementById('history');
  const $btnEq   = document.getElementById('btn-equals');

  // Estado de la calculadora estándar
  let current = '0';     // lo que se muestra
  let previous = null;   // operando anterior
  let operator = null;   // +, -, *, /
  let justEvaluated = false;

  // Buffer para detectar el código secreto: lo que el usuario ha tipeado
  // desde el último AC o desde el último =. Ej: "1+2+3+4+5="
  let secretBuffer = '';

  const opSymbol = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  function render() {
    // Formateo: agrupar miles si no hay decimal en curso
    let display = current;
    if (!display.endsWith('.') && !display.includes('e')) {
      const num = Number(display);
      if (Number.isFinite(num) && Math.abs(num) < 1e16) {
        const [intP, decP] = display.split('.');
        const formattedInt = Number(intP).toLocaleString('en-US');
        display = decP !== undefined ? `${formattedInt}.${decP}` : formattedInt;
      }
    }
    // Acortar si es muy largo
    if (display.length > 12) {
      const num = Number(current);
      if (Number.isFinite(num)) {
        display = num.toPrecision(9).replace(/\.?0+($|e)/, '$1');
      }
    }
    $result.textContent = display;
    $history.textContent = previous !== null && operator
      ? `${formatNum(previous)} ${opSymbol[operator]}`
      : '';
  }

  function formatNum(n) {
    if (!Number.isFinite(n)) return '';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 9 });
  }

  function appendDigit(d) {
    if (justEvaluated) { current = '0'; justEvaluated = false; }
    if (current === '0') current = d;
    else if (current.length < 15) current += d;
    secretBuffer += d;
  }

  function appendDot() {
    if (justEvaluated) { current = '0'; justEvaluated = false; }
    if (!current.includes('.')) current += '.';
    secretBuffer += '.';
  }

  function setOperator(op) {
    justEvaluated = false;
    if (previous === null) {
      previous = parseFloat(current);
    } else if (operator) {
      previous = compute(previous, parseFloat(current), operator);
      current = String(previous);
    }
    operator = op;
    current = '0';
    secretBuffer += op;
  }

  function compute(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? NaN : a / b;
    }
    return b;
  }

  function evaluate() {
    secretBuffer += '=';
    // Chequear secreto ANTES de resetear nada
    const secret = (window.CalcAPI && window.CalcAPI.getSecret) ? window.CalcAPI.getSecret() : null;
    let secretMatched = false;
    if (secret && secretBuffer.endsWith(secret)) {
      secretMatched = true;
    }

    if (previous !== null && operator !== null) {
      const result = compute(previous, parseFloat(current), operator);
      current = Number.isFinite(result) ? String(result) : 'Error';
      previous = null;
      operator = null;
      justEvaluated = true;
    }

    // Después del =, el buffer arranca de nuevo pero NO disparamos secreto si no coincide
    secretBuffer = '';

    render();

    if (secretMatched && window.CalcAPI && window.CalcAPI.onSecretMatch) {
      // Pequeño delay para que el usuario "vea" el resultado un instante
      setTimeout(() => window.CalcAPI.onSecretMatch(), 120);
    }
  }

  function clearAll() {
    current = '0';
    previous = null;
    operator = null;
    justEvaluated = false;
    secretBuffer = '';
    render();
  }

  function toggleSign() {
    if (current === '0') return;
    current = current.startsWith('-') ? current.slice(1) : '-' + current;
    // Para el buffer secreto: no agregamos nada — el ± no es parte del secreto
    render();
  }

  function percent() {
    const v = parseFloat(current);
    if (!Number.isFinite(v)) return;
    current = String(v / 100);
    render();
  }

  // Bind UI
  document.querySelectorAll('.key').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'num')      { appendDigit(btn.dataset.num); render(); }
      else if (action === 'dot') { appendDot(); render(); }
      else if (action === 'op')  { setOperator(btn.dataset.op); render(); }
      else if (action === 'equals')  { evaluate(); }
      else if (action === 'clear')   { clearAll(); }
      else if (action === 'sign')    { toggleSign(); }
      else if (action === 'percent') { percent(); }
    });
  });

  // Soporte de teclado físico (para PC)
  document.addEventListener('keydown', (e) => {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (!document.getElementById('chat-overlay').classList.contains('hidden')) return;
    if (!document.getElementById('settings-overlay').classList.contains('hidden')) return;
    if (!document.getElementById('login-overlay').classList.contains('hidden')) return;

    const k = e.key;
    if (/^[0-9]$/.test(k))     { appendDigit(k); render(); }
    else if (k === '.')        { appendDot(); render(); }
    else if (k === '+' || k === '-' || k === '*' || k === '/') { setOperator(k); render(); }
    else if (k === 'Enter' || k === '=') { e.preventDefault(); evaluate(); }
    else if (k === 'Escape')   { clearAll(); }
    else if (k === '%')        { percent(); }
    else if (k === 'Backspace') {
      if (current.length > 1) current = current.slice(0, -1);
      else current = '0';
      // mantenemos buffer secreto intacto: el secreto se chequea por sufijo en =
      render();
    }
  });

  render();
})();
