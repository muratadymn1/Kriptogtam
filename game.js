(function () {
  'use strict';

  const TURKISH_UPPER = 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ';
  const MAX_MISTAKES = 3;

  const KB_LAYOUT = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'Ğ', 'Ü'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ş', 'İ'],
    ['BACK', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Ö', 'Ç', 'NEXT']
  ];

  function toTrUpper(s) {
    return String(s).toLocaleUpperCase('tr-TR');
  }

  function isLetter(ch) {
    if (!ch || ch.length !== 1) return false;
    return TURKISH_UPPER.includes(toTrUpper(ch));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const DIFF_HINT = { easy: 0.42, medium: 0.2, hard: 0.07 };

  const screenMenu = document.getElementById('screenMenu');
  const screenGame = document.getElementById('screenGame');
  const board = document.getElementById('board');
  const legend = document.getElementById('legend');
  const meta = document.getElementById('meta');
  const hintMsg = document.getElementById('hintMsg');
  const difficultyMenu = document.getElementById('difficulty');
  const difficultySheet = document.getElementById('difficultySheet');
  const vkeyboard = document.getElementById('vkeyboard');
  const mistakeDots = document.getElementById('mistakeDots');
  const backdrop = document.getElementById('backdrop');
  const panelSettings = document.getElementById('panelSettings');

  let state = null;
  let activeSlot = null;
  let gameLocked = false;

  function pickPuzzle() {
    const list = window.CRYPTO_PUZZLES || [];
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  function buildCipher(text, difficulty) {
    const upper = toTrUpper(text);
    const unique = [];
    const seen = new Set();
    for (let i = 0; i < upper.length; i++) {
      const c = upper[i];
      if (!isLetter(c)) continue;
      if (!seen.has(c)) {
        seen.add(c);
        unique.push(c);
      }
    }
    const shuffled = shuffle(unique);
    const letterToNum = {};
    shuffled.forEach((L, idx) => {
      letterToNum[L] = idx + 1;
    });

    const positions = [];
    for (let i = 0; i < upper.length; i++) {
      const c = upper[i];
      if (isLetter(c)) {
        positions.push({ i, letter: c, num: letterToNum[c], revealed: false });
      }
    }

    const ratio = DIFF_HINT[difficulty] ?? DIFF_HINT.medium;
    let nReveal = Math.round(positions.length * ratio);
    nReveal = Math.max(2, Math.min(nReveal, positions.length - 1));

    const idxs = shuffle(positions.map((_, j) => j));
    const revealedIdx = new Set(idxs.slice(0, nReveal));
    positions.forEach((p, j) => {
      p.revealed = revealedIdx.has(j);
    });

    const numRevealedLetter = {};
    positions.forEach((p) => {
      if (p.revealed) numRevealedLetter[p.num] = p.letter;
    });

    return {
      original: text,
      upper,
      letterToNum,
      positions,
      numRevealedLetter,
      words: tokenizeWords(upper)
    };
  }

  function tokenizeWords(upper) {
    const raw = [];
    let start = 0;
    for (let i = 0; i <= upper.length; i++) {
      const end = i === upper.length;
      const ch = end ? ' ' : upper[i];
      if (ch === ' ' || (!end && !isLetter(ch) && ch !== "'" && ch !== '’')) {
        if (i > start) raw.push({ start, end: i });
        if (!end && !isLetter(ch) && ch !== ' ' && ch !== "'" && ch !== '’') {
          raw.push({ punct: ch });
        }
        start = i + 1;
      }
    }
    const words = [];
    for (const seg of raw) {
      if (seg.punct) {
        const last = words[words.length - 1];
        if (last && last.start !== undefined) last.trailPunct = seg.punct;
        else words.push({ lonePunct: seg.punct });
      } else {
        words.push({ ...seg });
      }
    }
    return words;
  }

  function positionMap(positions) {
    const byIndex = {};
    positions.forEach((p) => {
      byIndex[p.i] = p;
    });
    return byIndex;
  }

  function isCellRevealed(p) {
    return p.revealed || (state.hintReveal && state.hintReveal.has(p.i));
  }

  function getDifficulty() {
    return difficultyMenu.value || 'medium';
  }

  function syncSheetSelect() {
    difficultySheet.innerHTML = difficultyMenu.innerHTML;
    difficultySheet.value = difficultyMenu.value;
  }

  function showMenu() {
    screenMenu.classList.remove('is-hidden');
    screenGame.classList.add('is-hidden');
    screenGame.setAttribute('aria-hidden', 'true');
  }

  function showGame() {
    screenMenu.classList.add('is-hidden');
    screenGame.classList.remove('is-hidden');
    screenGame.setAttribute('aria-hidden', 'false');
  }

  function openSettings() {
    syncSheetSelect();
    backdrop.classList.remove('is-hidden');
    panelSettings.classList.remove('is-hidden');
    backdrop.setAttribute('aria-hidden', 'false');
    panelSettings.setAttribute('aria-hidden', 'false');
  }

  function closeSettings() {
    backdrop.classList.add('is-hidden');
    panelSettings.classList.add('is-hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    panelSettings.setAttribute('aria-hidden', 'true');
    difficultyMenu.value = difficultySheet.value;
  }

  function renderMistakes() {
    mistakeDots.innerHTML = '';
    for (let i = 0; i < MAX_MISTAKES; i++) {
      const d = document.createElement('span');
      d.className = 'mistake-dot';
      if (i < state.mistakes) {
        d.classList.add('used');
        d.textContent = '✕';
      }
      mistakeDots.appendChild(d);
    }
  }

  function puzzleLetterSet() {
    const s = new Set();
    state.cipher.positions.forEach((p) => s.add(p.letter));
    return s;
  }

  function renderKeyboard() {
    vkeyboard.innerHTML = '';
    const inPuzzle = puzzleLetterSet();

    KB_LAYOUT.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      row.forEach((key) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kb-key';
        if (key === 'BACK') {
          btn.classList.add('wide', 'backspace');
          btn.textContent = '←';
          btn.setAttribute('aria-label', 'Sil');
          btn.addEventListener('click', () => applyFromKeyboard(''));
        } else if (key === 'NEXT') {
          btn.classList.add('wide');
          btn.textContent = '→';
          btn.setAttribute('aria-label', 'Sonraki kutu');
          btn.addEventListener('click', focusNextEditable);
        } else {
          btn.textContent = key;
          if (!inPuzzle.has(key)) btn.classList.add('dim');
          else btn.classList.add('active-puzzle');
          btn.addEventListener('click', () => applyFromKeyboard(key));
        }
        rowEl.appendChild(btn);
      });
      vkeyboard.appendChild(rowEl);
    });
  }

  function getEditableInputs() {
    return [...board.querySelectorAll('input.slot-input:not(.revealed)')];
  }

  function focusNextEditable() {
    const list = getEditableInputs();
    if (!list.length) return;
    const cur = document.activeElement;
    const idx = list.indexOf(cur);
    const next = list[(idx + 1) % list.length];
    next.focus();
    selectSlotForInput(next);
  }

  function selectSlotForInput(input) {
    if (activeSlot) activeSlot.classList.remove('is-selected');
    const slot = input && input.closest('.cell-slot');
    activeSlot = slot;
    if (activeSlot) activeSlot.classList.add('is-selected');
  }

  function applyFromKeyboard(letter) {
    if (gameLocked) return;
    const input =
      document.activeElement && document.activeElement.matches('input.slot-input:not(.revealed)')
        ? document.activeElement
        : activeSlot && activeSlot.querySelector('input.slot-input:not(.revealed)');
    if (!input) {
      const first = getEditableInputs()[0];
      if (first) {
        first.focus();
        selectSlotForInput(first);
      }
      if (!letter) return;
      return applyFromKeyboard(letter);
    }

    if (letter === '') {
      syncNum(input.dataset.num, '');
      input.value = '';
      input.classList.remove('error', 'ok');
      return;
    }

    const v = toTrUpper(letter);
    if (!isLetter(v)) return;
    input.value = v;
    syncNum(input.dataset.num, v);
    input.classList.remove('error', 'ok');
    focusNextEditable();
  }

  function syncNum(numStr, letter) {
    board.querySelectorAll(`input[data-num="${numStr}"]`).forEach((inp) => {
      if (inp.classList.contains('revealed')) return;
      inp.value = letter;
      inp.classList.remove('error', 'ok');
    });
  }

  function onInput(e) {
    const el = e.target;
    let v = el.value;
    if (!v) {
      syncNum(el.dataset.num, '');
      return;
    }
    v = toTrUpper(v.slice(-1));
    if (!isLetter(v)) {
      el.value = '';
      return;
    }
    el.value = v;
    syncNum(el.dataset.num, v);
    el.classList.remove('error', 'ok');
  }

  function onKeydownNav(e) {
    const el = e.target;
    const list = getEditableInputs();
    const idx = list.indexOf(el);
    if (idx < 0) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (idx > 0) {
        list[idx - 1].focus();
        selectSlotForInput(list[idx - 1]);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (idx < list.length - 1) {
        list[idx + 1].focus();
        selectSlotForInput(list[idx + 1]);
      }
    } else if (e.key === 'Backspace' && !el.value) {
      e.preventDefault();
      if (idx > 0) {
        list[idx - 1].focus();
        selectSlotForInput(list[idx - 1]);
      }
    }
  }

  function collectAnswer() {
    const { cipher } = state;
    let out = '';
    for (let i = 0; i < cipher.upper.length; i++) {
      const c = cipher.upper[i];
      if (isLetter(c)) {
        const inp = board.querySelector(`input[data-index="${i}"]`);
        out += inp && inp.value ? toTrUpper(inp.value) : '?';
      } else {
        out += c;
      }
    }
    return out;
  }

  function hasAnyWrong() {
    const want = state.cipher.upper;
    for (const inp of board.querySelectorAll('input.slot-input')) {
      const i = Number(inp.dataset.index);
      const v = inp.value ? toTrUpper(inp.value) : '';
      if (v && v !== want[i]) return true;
    }
    return false;
  }

  function hasAnyFilled() {
    for (const inp of board.querySelectorAll('input.slot-input')) {
      if (inp.value) return true;
    }
    return false;
  }

  function check() {
    if (!state || gameLocked) return;
    const got = collectAnswer();
    const want = state.cipher.upper;
    const ok = got === want;

    board.querySelectorAll('input.slot-input').forEach((inp) => {
      inp.classList.remove('error', 'ok');
      const i = Number(inp.dataset.index);
      const should = want[i];
      const v = inp.value ? toTrUpper(inp.value) : '';
      if (inp.classList.contains('revealed')) {
        inp.classList.add('ok');
        return;
      }
      if (!v) return;
      if (v === should) inp.classList.add('ok');
      else inp.classList.add('error');
    });

    if (ok) {
      hintMsg.textContent = 'Tebrikler! Doğru çözdünüz.';
      hintMsg.className = 'hint-text success';
      gameLocked = true;
      renderMistakesSuccess();
      return;
    }

    if (hasAnyFilled() && hasAnyWrong()) {
      state.mistakes = Math.min(MAX_MISTAKES, state.mistakes + 1);
      renderMistakes();
      if (state.mistakes >= MAX_MISTAKES) {
        gameLocked = true;
        hintMsg.textContent =
          'Üç hakkınız doldu. Ayarlardan yeni bulmaca seçebilir veya ana menüye dönebilirsiniz.';
        hintMsg.className = 'hint-text error';
        return;
      }
    }

    hintMsg.textContent =
      'Henüz tam doğru değil. Kırmızı çizgili harfler yanlış; yeşil olanlar doğru.';
    hintMsg.className = 'hint-text error';
  }

  function renderMistakesSuccess() {
    mistakeDots.innerHTML = '';
    for (let i = 0; i < MAX_MISTAKES; i++) {
      const d = document.createElement('span');
      d.className = 'mistake-dot ok';
      d.textContent = '✓';
      mistakeDots.appendChild(d);
    }
  }

  function hintLetter() {
    if (!state || gameLocked) return;
    const { cipher } = state;
    const byIndex = positionMap(cipher.positions);
    const candidates = cipher.positions.filter((p) => {
      if (isCellRevealed(p)) return false;
      const inp = board.querySelector(`input[data-index="${p.i}"]`);
      if (!inp) return false;
      const v = inp.value ? toTrUpper(inp.value) : '';
      return !v || v !== p.letter;
    });
    if (!candidates.length) {
      hintMsg.textContent = 'Açılacak harf kalmadı.';
      hintMsg.className = 'hint-text neutral';
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (!state.hintReveal) state.hintReveal = new Set();
    cipher.positions.forEach((p) => {
      if (p.num === pick.num) state.hintReveal.add(p.i);
    });
    hintMsg.textContent = 'Bir harf açıldı.';
    hintMsg.className = 'hint-text neutral';
    render();
  }

  function render() {
    board.innerHTML = '';
    legend.innerHTML = '';
    hintMsg.textContent = '';
    hintMsg.className = 'hint-text';

    if (!state) return;

    const { puzzle, cipher } = state;
    const byIndex = positionMap(cipher.positions);
    const typeLabel =
      puzzle.type === 'atasözü'
        ? 'Atasözü'
        : puzzle.type === 'deyim'
          ? 'Deyim'
          : 'Söz';

    let metaHtml = `<strong>${typeLabel}</strong>`;
    if (puzzle.author) metaHtml += `<br>${puzzle.author}`;
    meta.innerHTML = metaHtml;

    const nums = Object.keys(
      cipher.positions.reduce((acc, p) => {
        acc[p.num] = true;
        return acc;
      }, {})
    )
      .map(Number)
      .sort((a, b) => a - b);

    nums.forEach((n) => {
      const chip = document.createElement('span');
      chip.className = 'legend-chip';
      let L = cipher.numRevealedLetter[n];
      if (!L && state.hintReveal) {
        const hp = cipher.positions.find((p) => p.num === n && state.hintReveal.has(p.i));
        if (hp) L = hp.letter;
      }
      if (L) {
        chip.classList.add('revealed');
        chip.textContent = `${n}→${L}`;
      } else {
        chip.textContent = `${n}→?`;
      }
      legend.appendChild(chip);
    });

    cipher.words.forEach((w) => {
      const row = document.createElement('div');
      row.className = 'word-row';

      if (w.lonePunct) {
        const span = document.createElement('span');
        span.className = 'cell-punct';
        span.textContent = w.lonePunct;
        row.appendChild(span);
        board.appendChild(row);
        return;
      }

      for (let i = w.start; i < w.end; i++) {
        const ch = cipher.upper[i];
        if (isLetter(ch)) {
          const p = byIndex[i];
          const revealed = isCellRevealed(p);
          const wrap = document.createElement('div');
          wrap.className = 'cell-slot';
          if (revealed) wrap.classList.add('revealed-slot');

          const inner = document.createElement('div');
          inner.className = 'slot-inner';

          const input = document.createElement('input');
          input.type = 'text';
          input.inputMode = 'none';
          input.maxLength = 1;
          input.className = 'slot-input';
          if (revealed) input.classList.add('revealed');
          input.dataset.index = String(i);
          input.dataset.num = String(p.num);
          input.readOnly = revealed || gameLocked;
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.setAttribute('aria-label', `Kod ${p.num}`);

          if (revealed) {
            input.value = p.letter;
            input.tabIndex = -1;
          } else {
            input.addEventListener('input', onInput);
            input.addEventListener('keydown', onKeydownNav);
            input.addEventListener('focus', () => selectSlotForInput(input));
            input.addEventListener('click', () => selectSlotForInput(input));
          }

          const uline = document.createElement('span');
          uline.className = 'underline';

          inner.appendChild(input);
          inner.appendChild(uline);
          wrap.appendChild(inner);

          const numEl = document.createElement('span');
          numEl.className = 'cell-num';
          numEl.textContent = String(p.num);
          wrap.appendChild(numEl);

          row.appendChild(wrap);
        }
      }

      if (w.trailPunct) {
        const span = document.createElement('span');
        span.className = 'cell-punct';
        span.textContent = w.trailPunct;
        row.appendChild(span);
      }

      board.appendChild(row);
    });

    renderKeyboard();
    if (!gameLocked) renderMistakes();

    const first = getEditableInputs()[0];
    if (first && !gameLocked) {
      requestAnimationFrame(() => {
        first.focus();
        selectSlotForInput(first);
      });
    }
  }

  function newGame() {
    const puzzle = pickPuzzle();
    if (!puzzle) {
      meta.textContent = 'Bulmaca listesi boş.';
      return;
    }
    gameLocked = false;
    state = {
      puzzle,
      cipher: buildCipher(puzzle.text, getDifficulty()),
      mistakes: 0,
      hintReveal: new Set()
    };
    render();
  }

  document.getElementById('btnPlay').addEventListener('click', () => {
    showGame();
    newGame();
  });

  document.getElementById('btnHome').addEventListener('click', () => {
    showMenu();
    state = null;
    activeSlot = null;
  });

  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
  backdrop.addEventListener('click', closeSettings);

  document.getElementById('btnNewGame').addEventListener('click', () => {
    difficultyMenu.value = difficultySheet.value;
    closeSettings();
    newGame();
  });

  difficultySheet.addEventListener('change', () => {
    difficultyMenu.value = difficultySheet.value;
  });

  document.getElementById('btnCheck').addEventListener('click', check);
  document.getElementById('btnHint').addEventListener('click', hintLetter);
})();
