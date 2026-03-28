(function () {
  'use strict';

  const TURKISH_UPPER = 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ';
  const MAX_MISTAKES = 3;
  const LEVEL_STORAGE_KEY = 'kriptogram_level_v1';
  const INTRO_STORAGE_KEY = 'kriptogram_intro_seen_v1';

  const INTRO_SLIDES = [
    {
      emoji: '🔓',
      title: 'Kriptogram’a hoş geldin!',
      text: 'Rakamların altındaki gizli harfleri bul; ortaya atasözleri, deyimler ve ünlü sözler çıkacak. Küçük bir dedektif gibi düşün!'
    },
    {
      emoji: '🧩',
      title: 'Her sayı = bir harf',
      text: 'Aynı rakam her yerde aynı harfi temsil eder — ama bu oyunda her kutuyu tek tek sen dolduracaksın; otomatik kopyalama yok, tam senlik!'
    },
    {
      emoji: '✨',
      title: 'Doğru mu, yanlış mı?',
      text: 'Doğru harfi yazınca kutu yeşillenir ve imleç kendiliğinden sonraki kutuya zıplar. Yanlışsa kutu kızarır ve hafifçe titrer — merak etme, silip yeniden dene.'
    },
    {
      emoji: '🎮',
      title: 'Bölümler ve kurallar',
      text: 'Her metin bir bölüm. Kontrol ile cevabını doğrula; üç yanlış kontrolde bölüm yanar ve sıfırdan başlarsın. İpucu tek bir harfi açar. Hazırsan…'
    }
  ];

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
  let advanceTimer = null;

  function getPuzzleList() {
    return window.CRYPTO_PUZZLES || [];
  }

  function loadSavedLevel() {
    const list = getPuzzleList();
    if (!list.length) return 0;
    const n = parseInt(localStorage.getItem(LEVEL_STORAGE_KEY) || '0', 10);
    return Math.max(0, Math.min(n, list.length - 1));
  }

  function saveLevel(idx) {
    localStorage.setItem(LEVEL_STORAGE_KEY, String(idx));
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
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
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

  function shakeSlot(wrap) {
    if (!wrap) return;
    wrap.classList.remove('cell-shake');
    void wrap.offsetWidth;
    wrap.classList.add('cell-shake');
    const done = () => {
      wrap.removeEventListener('animationend', done);
      wrap.classList.remove('cell-shake');
    };
    wrap.addEventListener('animationend', done);
  }

  function focusNextSmart(fromInput) {
    const list = getEditableInputs();
    if (!list.length) return;
    const idx = list.indexOf(fromInput);
    if (idx < 0) return;
    for (let j = idx + 1; j < list.length; j++) {
      list[j].focus();
      selectSlotForInput(list[j]);
      return;
    }
    const empty = list.find((inp) => !inp.value);
    if (empty && empty !== fromInput) {
      empty.focus();
      selectSlotForInput(empty);
    }
  }

  function afterLetterEntered(input, v) {
    if (!state || gameLocked || !input || input.classList.contains('revealed')) return;
    const i = Number(input.dataset.index);
    if (Number.isNaN(i)) return;
    const want = state.cipher.upper[i];
    const wrap = input.closest('.cell-slot');
    if (wrap) wrap.classList.remove('slot-wrong');
    if (v === want) {
      input.classList.remove('error');
      input.classList.add('ok');
      refreshLegendStrip();
      requestAnimationFrame(() => focusNextSmart(input));
    } else {
      input.classList.remove('ok');
      input.classList.add('error');
      if (wrap) {
        wrap.classList.add('slot-wrong');
        shakeSlot(wrap);
      }
      refreshLegendStrip();
    }
  }

  /** Sadece seçili kutuyu güncelle; aynı rakamdaki diğer kutulara yazılmaz. */
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
      input.value = '';
      input.classList.remove('error', 'ok');
      input.closest('.cell-slot')?.classList.remove('slot-wrong');
      refreshLegendStrip();
      return;
    }

    const v = toTrUpper(letter);
    if (!isLetter(v)) return;
    input.value = v;
    afterLetterEntered(input, v);
  }

  function onInput(e) {
    const el = e.target;
    let v = el.value;
    if (!v) {
      el.classList.remove('error', 'ok');
      el.closest('.cell-slot')?.classList.remove('slot-wrong');
      refreshLegendStrip();
      return;
    }
    v = toTrUpper(v.slice(-1));
    if (!isLetter(v)) {
      el.value = '';
      return;
    }
    el.value = v;
    afterLetterEntered(el, v);
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

  function hasSameNumConflict() {
    const byNum = {};
    board.querySelectorAll('input.slot-input:not(.revealed)').forEach((inp) => {
      const n = inp.dataset.num;
      const v = inp.value ? toTrUpper(inp.value) : '';
      if (!v) return;
      if (!byNum[n]) byNum[n] = new Set();
      byNum[n].add(v);
    });
    return Object.values(byNum).some((set) => set.size > 1);
  }

  /** Aynı rakamda çelişkili harf var mı (ikisi de dolu ve farklı)? */
  function markSameNumConflicts() {
    const byNum = {};
    board.querySelectorAll('input.slot-input').forEach((inp) => {
      if (inp.classList.contains('revealed')) return;
      const num = inp.dataset.num;
      const v = inp.value ? toTrUpper(inp.value) : '';
      if (!v) return;
      if (!byNum[num]) byNum[num] = new Set();
      byNum[num].add(v);
    });
    Object.keys(byNum).forEach((num) => {
      if (byNum[num].size > 1) {
        board.querySelectorAll(`input[data-num="${num}"]:not(.revealed)`).forEach((inp) => {
          inp.classList.add('error');
          inp.closest('.cell-slot')?.classList.add('slot-wrong');
        });
      }
    });
  }

  function isNumFullySolvedInDom(n) {
    const { cipher } = state;
    const group = cipher.positions.filter((p) => p.num === n);
    return group.every((p) => {
      const inp = board.querySelector(`input[data-index="${p.i}"]`);
      if (isCellRevealed(p)) return true;
      const v = inp && inp.value ? toTrUpper(inp.value) : '';
      return v === p.letter;
    });
  }

  function refreshLegendStrip() {
    if (!state) return;
    const { cipher } = state;
    const nums = Object.keys(
      cipher.positions.reduce((acc, p) => {
        acc[p.num] = true;
        return acc;
      }, {})
    )
      .map(Number)
      .sort((a, b) => a - b);

    legend.innerHTML = '';
    nums.forEach((n) => {
      const chip = document.createElement('span');
      chip.className = 'legend-chip';
      if (isNumFullySolvedInDom(n)) {
        const p0 = cipher.positions.find((p) => p.num === n);
        chip.classList.add('revealed');
        chip.textContent = `${n}→${p0.letter}`;
      } else {
        chip.textContent = `${n}→?`;
      }
      legend.appendChild(chip);
    });
  }

  function burnRestartLevel() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    state.mistakes = 0;
    state.hintReveal = new Set();
    gameLocked = false;
    state.cipher = buildCipher(state.puzzle.text, getDifficulty());
    hintMsg.textContent = '3 hata! Bölüm yandı — aynı metin, yeni kodlarla sıfırdan.';
    hintMsg.className = 'hint-text error';
    render();
  }

  function goToNextLevel() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    const list = getPuzzleList();
    const next = state.levelIndex + 1;
    if (next >= list.length) {
      hintMsg.textContent = 'Tebrikler! Tüm bölümleri bitirdiniz. Kayıt sıfırlandı — yeniden 1. bölümden oynayabilirsiniz.';
      hintMsg.className = 'hint-text success';
      saveLevel(0);
      gameLocked = true;
      renderMistakesSuccess();
      return;
    }
    saveLevel(next);
    state.levelIndex = next;
    state.puzzle = list[next];
    state.mistakes = 0;
    state.hintReveal = new Set();
    gameLocked = false;
    state.cipher = buildCipher(state.puzzle.text, getDifficulty());
    hintMsg.textContent = `Bölüm ${state.levelIndex + 1} — devam!`;
    hintMsg.className = 'hint-text success';
    render();
  }

  function check() {
    if (!state || gameLocked) return;
    const want = state.cipher.upper;
    const got = collectAnswer();
    const ok = got === want;

    board.querySelectorAll('.cell-slot').forEach((w) => w.classList.remove('slot-wrong'));

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
      else {
        inp.classList.add('error');
        inp.closest('.cell-slot')?.classList.add('slot-wrong');
      }
    });

    markSameNumConflicts();

    const conflict = hasSameNumConflict();

    if (ok) {
      hintMsg.textContent = 'Bölüm tamam! Sonraki bölüme geçiliyor…';
      hintMsg.className = 'hint-text success';
      gameLocked = true;
      renderMistakesSuccess();
      refreshLegendStrip();
      advanceTimer = setTimeout(() => {
        advanceTimer = null;
        goToNextLevel();
      }, 1800);
      return;
    }

    const wrongCells = hasAnyWrong() || conflict;

    if (hasAnyFilled() && wrongCells) {
      state.mistakes = Math.min(MAX_MISTAKES, state.mistakes + 1);
      renderMistakes();
      if (state.mistakes >= MAX_MISTAKES) {
        burnRestartLevel();
        return;
      }
    }

    hintMsg.textContent =
      'Henüz tam doğru değil. Aynı rakamda farklı harf olamaz; kırmızılar yanlış, yeşiller doğru.';
    hintMsg.className = 'hint-text error';
    refreshLegendStrip();
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
    state.hintReveal.add(pick.i);
    hintMsg.textContent = 'Bir kutu açıldı (sadece o kutu).';
    hintMsg.className = 'hint-text neutral';
    render();
  }

  function renderMeta() {
    const list = getPuzzleList();
    const total = list.length;
    const { puzzle } = state;
    const typeLabel =
      puzzle.type === 'atasözü'
        ? 'Atasözü'
        : puzzle.type === 'deyim'
          ? 'Deyim'
          : 'Söz';
    let html = `<span class="meta-level">Bölüm ${state.levelIndex + 1} / ${total}</span>`;
    html += `<strong>${typeLabel}</strong>`;
    if (puzzle.author) html += `<br>${puzzle.author}`;
    meta.innerHTML = html;
  }

  function renderBoardOnly() {
    const { cipher } = state;
    const byIndex = positionMap(cipher.positions);

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
  }

  function render() {
    board.innerHTML = '';
    legend.innerHTML = '';

    if (!state) return;

    renderMeta();
    renderBoardOnly();
    refreshLegendStrip();
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

  function startLevel(levelIndex) {
    const list = getPuzzleList();
    if (!list.length) {
      meta.textContent = 'Bulmaca listesi boş.';
      return;
    }
    const idx = Math.max(0, Math.min(levelIndex, list.length - 1));
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    gameLocked = false;
    hintMsg.textContent = '';
    hintMsg.className = 'hint-text';
    state = {
      levelIndex: idx,
      puzzle: list[idx],
      cipher: buildCipher(list[idx].text, getDifficulty()),
      mistakes: 0,
      hintReveal: new Set()
    };
    render();
  }

  function restartCurrentLevelNewCipher() {
    if (!state) return;
    difficultyMenu.value = difficultySheet.value;
    closeSettings();
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    gameLocked = false;
    state.mistakes = 0;
    state.hintReveal = new Set();
    state.cipher = buildCipher(state.puzzle.text, getDifficulty());
    hintMsg.textContent = 'Aynı bölüm — yeni kodlarla yenilendi.';
    hintMsg.className = 'hint-text neutral';
    render();
  }

  document.getElementById('btnPlay').addEventListener('click', () => {
    showGame();
    startLevel(loadSavedLevel());
  });

  document.getElementById('btnHome').addEventListener('click', () => {
    showMenu();
    state = null;
    activeSlot = null;
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  });

  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
  backdrop.addEventListener('click', closeSettings);

  document.getElementById('btnNewGame').addEventListener('click', () => {
    restartCurrentLevelNewCipher();
  });

  difficultySheet.addEventListener('change', () => {
    difficultyMenu.value = difficultySheet.value;
  });

  document.getElementById('btnCheck').addEventListener('click', check);
  document.getElementById('btnHint').addEventListener('click', hintLetter);

  const introOverlay = document.getElementById('introOverlay');
  const introEmoji = document.getElementById('introEmoji');
  const introTitle = document.getElementById('introTitle');
  const introText = document.getElementById('introText');
  const introDots = document.getElementById('introDots');
  const introPrev = document.getElementById('introPrev');
  const introNext = document.getElementById('introNext');
  const introSkip = document.getElementById('introSkip');
  let introIdx = 0;

  function renderIntroSlide() {
    const s = INTRO_SLIDES[introIdx];
    introEmoji.textContent = s.emoji;
    introTitle.textContent = s.title;
    introText.textContent = s.text;
    introDots.innerHTML = '';
    INTRO_SLIDES.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'intro-dot' + (i === introIdx ? ' is-active' : '');
      b.setAttribute('aria-label', `Slayt ${i + 1}`);
      if (i === introIdx) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
      b.addEventListener('click', () => {
        introIdx = i;
        renderIntroSlide();
      });
      introDots.appendChild(b);
    });
    introPrev.disabled = introIdx === 0;
    introNext.textContent =
      introIdx === INTRO_SLIDES.length - 1 ? 'Hadi başlayalım! 🎉' : 'İleri →';
  }

  function openIntro() {
    introIdx = 0;
    introOverlay.classList.remove('is-hidden');
    introOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderIntroSlide();
  }

  function closeIntro(markSeen) {
    if (markSeen) {
      try {
        localStorage.setItem(INTRO_STORAGE_KEY, '1');
      } catch (e) {}
    }
    introOverlay.classList.add('is-hidden');
    introOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  introNext.addEventListener('click', () => {
    if (introIdx >= INTRO_SLIDES.length - 1) {
      closeIntro(true);
    } else {
      introIdx++;
      renderIntroSlide();
    }
  });

  introPrev.addEventListener('click', () => {
    if (introIdx > 0) {
      introIdx--;
      renderIntroSlide();
    }
  });

  introSkip.addEventListener('click', () => closeIntro(true));

  try {
    if (!localStorage.getItem(INTRO_STORAGE_KEY)) {
      openIntro();
    }
  } catch (e) {}

  document.getElementById('btnHowto').addEventListener('click', () => openIntro());

  document.getElementById('btnShowIntro').addEventListener('click', () => {
    closeSettings();
    openIntro();
  });
})();
