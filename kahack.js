// ==UserScript==
// @name         KaHack
// @version      23.1.0
// @description  Kahoot answer + puzzle helper
// @match        https://kahoot.it/*
// @match        https://kahoot.it/challenge/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=kahoot.it
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'kahack_last_input';

    let questions = [];
    let loaded = false;
    let answered = new Set();
    let highlightTimer = null;
    let statusTimer = null;

    // ---------- DOM HELPERS ----------
    const findAnswers = () =>
        document.querySelectorAll(
            'button[data-functional-selector^="answer-"], ' +
            'button[data-functional-selector^="multi-select-button-"]'
        );

    const getAnswerBtn = (i) =>
        document.querySelector(`[data-functional-selector="answer-${i}"]`) ||
        document.querySelector(`[data-functional-selector="multi-select-button-${i}"]`);

    const getCounter = () =>
        document.querySelector('[data-functional-selector="question-index-counter"]');

    const getTextInput = () =>
        document.querySelector('input[type="text"][data-functional-selector*="text"], ' +
                              'textarea[data-functional-selector*="text"], ' +
                              'input[type="text"]:not([data-functional-selector*="nickname"])');

    const currentQ = () => {
        const c = getCounter();
        if (!c) return -1;
        const m = c.textContent.match(/(\d+)/);
        return m ? parseInt(m[1]) - 1 : -1;
    };

    const totalQ = () => {
        const c = getCounter();
        if (!c) return questions.length;
        const m = c.textContent.match(/\/(\d+)/);
        return m ? parseInt(m[1]) : questions.length;
    };

    // ---------- STATUS ----------
    function showStatus(text, duration = 2500) {
        const el = document.getElementById('kh-status');
        if (!el) return;
        el.textContent = text;
        if (statusTimer) clearTimeout(statusTimer);
        if (duration > 0) {
            statusTimer = setTimeout(() => { el.textContent = ''; }, duration);
        }
    }

    // ---------- ID EXTRACTION ----------
    function extractId(input) {
        input = (input || '').trim();
        if (!input) return null;
        const uuid = input.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        if (uuid) return uuid[0];
        if (/^[a-zA-Z0-9_-]+$/.test(input)) return input;
        return null;
    }

    // ---------- STORAGE ----------
    function saveLastInput(raw) {
        try { localStorage.setItem(STORAGE_KEY, raw); } catch(e) {}
    }

    function getLastInput() {
        try { return localStorage.getItem(STORAGE_KEY) || ''; } catch(e) { return ''; }
    }

    // ---------- SHOW ANSWERS ----------
    function clearHighlights() {
        findAnswers().forEach(b => {
            b.style.removeProperty('outline');
            b.style.removeProperty('box-shadow');
            b.style.removeProperty('opacity');
        });
        const inp = getTextInput();
        if (inp) {
            inp.style.removeProperty('outline');
            inp.style.removeProperty('box-shadow');
        }
        document.querySelectorAll('.kh-badge').forEach(b => b.remove());
        document.querySelectorAll('[data-functional-selector^="puzzle-tile-"]').forEach(t => {
            t.style.removeProperty('outline');
        });
        const puzzleInfo = document.getElementById('kh-puzzle');
        if (puzzleInfo) puzzleInfo.classList.remove('on');
    }

    function flashAnswers() {
        const i = currentQ();
        if (i < 0 || i >= questions.length) return;
        const q = questions[i];
        if (!q) return;

        clearHighlights();

        if (q.openEnded) {
            const input = getTextInput();
            if (input) {
                input.style.outline = '4px solid #00cc66';
                input.style.boxShadow = '0 0 30px #00cc6680';
            }
        } else if (q.puzzle) {
            applyPuzzleOrder(q);
        } else {
            q.answers.forEach(a => {
                const btn = getAnswerBtn(a);
                if (btn) {
                    btn.style.outline = '4px solid #00cc66';
                    btn.style.boxShadow = 'inset 0 0 0 4px #00cc66, 0 0 30px #00cc6680';
                }
            });
            q.incorrect.forEach(a => {
                const btn = getAnswerBtn(a);
                if (btn) {
                    btn.style.outline = '4px solid #cc2244';
                    btn.style.opacity = '0.4';
                }
            });
        }

        if (highlightTimer) clearTimeout(highlightTimer);
        highlightTimer = setTimeout(clearHighlights, 4000);
    }

    // ---------- PUZZLE ----------
    function applyPuzzleOrder(q) {
        const tiles = document.querySelectorAll('[data-functional-selector^="puzzle-tile-"]');
        if (!tiles.length) return;

        q.answers.forEach((correctIndex, position) => {
            const tile = document.querySelector(`[data-functional-selector="puzzle-tile-${correctIndex}"]`);
            if (!tile) return;

            const old = tile.querySelector('.kh-badge');
            if (old) old.remove();

            const badge = document.createElement('div');
            badge.className = 'kh-badge';
            badge.textContent = (position + 1);
            badge.style.cssText = `
                position: absolute; top: 8px; left: 8px;
                width: 32px; height: 32px; border-radius: 50%;
                background: #00cc66; color: #000;
                font-weight: 900; font-size: 18px;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 0 20px #00cc66;
                z-index: 9999; pointer-events: none;
            `;
            if (getComputedStyle(tile).position === 'static') {
                tile.style.position = 'relative';
            }
            tile.appendChild(badge);
            tile.style.outline = '4px solid #00cc66';
        });

        const list = document.getElementById('kh-puzzle-list');
        const info = document.getElementById('kh-puzzle');
        if (list && info) {
            list.innerHTML = '';
            q.answers.forEach((correctIndex, position) => {
                const li = document.createElement('li');
                li.textContent = 'Tile ' + (position + 1);
                list.appendChild(li);
            });
            info.classList.add('on');
        }
    }

    // ---------- PARSE ----------
    function parse(data) {
        return data.map(q => {
            const correct = [];
            const incorrect = [];
            let openEnded = false;
            let puzzle = false;

            if (q.type === 'open_ended' || q.type === 'open_ended_multi') {
                openEnded = true;
                if (q.choices && q.choices[0]) {
                    correct.push(q.choices[0].answer || q.choices[0].text || '');
                }
            } else if (q.type === 'puzzle') {
                puzzle = true;
                (q.choices || []).forEach((c, i) => correct.push(i));
            } else if (q.choices) {
                q.choices.forEach((c, i) =>
                    (c.correct ? correct : incorrect).push(i)
                );
            }

            return {
                answers: correct,
                incorrect: incorrect,
                multi: q.type === 'multiple_select_quiz' || q.type === 'quiz_multiple',
                openEnded: openEnded,
                puzzle: puzzle,
                raw: q
            };
        });
    }

    // ---------- FETCH ----------
    function fetchQuiz(rawInput, silent = false) {
        const id = extractId(rawInput);
        if (!id) {
            if (!silent) showStatus('invalid link or id');
            return;
        }
        showStatus('fetching...', 0);
        fetch('https://kahoot.it/rest/kahoots/' + id)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(d => {
                questions = parse(d.questions);
                loaded = true;
                answered.clear();
                document.getElementById('kh-q').textContent = '0/' + questions.length;
                showStatus('loaded ' + questions.length + ' questions', 3000);
                saveLastInput(rawInput);
            })
            .catch(() => showStatus('fetch failed', 3000));
    }

    // ---------- UI ----------
    let ui = null;
    let hidden = false;

    function buildUI() {
        const style = document.createElement('style');
        style.textContent = `
            #kh, #kh * { box-sizing: border-box; }
            #kh {
                position: fixed; top: 20px; left: 20px; width: 280px;
                background: #0a0a0a; border: 1px solid #2a2a2a;
                border-radius: 8px; color: #ccc;
                font-family: 'Segoe UI', sans-serif; font-size: 12px;
                z-index: 99999; box-shadow: 0 8px 32px rgba(0,0,0,0.8);
                overflow: hidden;
                transition: opacity 0.15s, transform 0.15s;
            }
            #kh.hidden { opacity: 0; transform: scale(0.95); pointer-events: none; }
            #kh .hdr {
                padding: 8px 12px; background: #141414;
                border-bottom: 1px solid #2a2a2a;
                display: flex; justify-content: space-between;
                align-items: center; cursor: move; user-select: none;
            }
            #kh .hdr b { font-size: 13px; }
            #kh .hint { font-size: 9px; opacity: 0.4; letter-spacing: 0.5px; }
            #kh .body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
            #kh .row { display: flex; gap: 6px; }
            #kh input {
                flex: 1; background: #0a0a0a; color: #ccc;
                border: 1px solid #2a2a2a; border-radius: 4px;
                padding: 5px 8px; font-size: 12px; outline: none;
            }
            #kh input:focus { border-color: #00cc66; }
            #kh button {
                background: #2a2a2a; color: #ccc;
                border: 1px solid #2a2a2a; border-radius: 4px;
                padding: 5px 10px; font-size: 11px;
                font-weight: 600; text-transform: uppercase;
                cursor: pointer; transition: 0.2s;
            }
            #kh button:hover { background: #1f1f1f; }
            #kh button.reveal {
                background: #00cc66; color: #000;
                border: none; width: 100%;
                padding: 10px; font-size: 12px;
                font-weight: 700; letter-spacing: 0.5px;
                margin-top: 2px;
            }
            #kh button.reveal:hover { opacity: 0.85; }
            #kh button.reveal:active {
                transform: scale(0.98);
                background: #00aa55;
            }
            #kh .status {
                font-size: 10px; text-align: center;
                opacity: 0.6; min-height: 14px;
                transition: opacity 0.3s;
            }
            #kh .puzzle-info {
                display: none;
                background: #141414;
                border: 1px solid #2a2a2a;
                border-radius: 4px;
                padding: 6px 8px;
                font-size: 11px;
                color: #00cc66;
                margin-top: 4px;
            }
            #kh .puzzle-info.on { display: block; }
            #kh .puzzle-info ol {
                margin: 4px 0 0 0; padding-left: 18px;
                color: #ccc; font-size: 11px;
            }
            #kh .info {
                display: flex; justify-content: space-between;
                font-size: 11px; opacity: 0.7;
                align-items: center;
            }
        `;
        document.head.appendChild(style);

        ui = document.createElement('div');
        ui.id = 'kh';
        ui.innerHTML = `
            <div class="hdr" id="kh-hdr">
                <b>kahack</b>
                <span class="hint">press H</span>
            </div>
            <div class="body">
                <div class="row">
                    <input id="kh-quiz" placeholder="paste link or quiz id...">
                    <button id="kh-fetch">fetch</button>
                </div>
                <div class="status" id="kh-status"></div>
                <button class="reveal" id="kh-reveal">show answers</button>
                <div class="puzzle-info" id="kh-puzzle">
                    <b>puzzle order:</b>
                    <ol id="kh-puzzle-list"></ol>
                </div>
                <div class="info">
                    <span id="kh-q">0/0</span>
                </div>
            </div>
        `;
        document.body.appendChild(ui);

        // Reveal button
        document.getElementById('kh-reveal').onclick = () => {
            if (!loaded) {
                showStatus('no quiz loaded');
                return;
            }
            flashAnswers();
        };

        // Fetch
        document.getElementById('kh-fetch').onclick = () => {
            const raw = document.getElementById('kh-quiz').value;
            fetchQuiz(raw);
        };

        // Enter key triggers fetch
        document.getElementById('kh-quiz').addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('kh-fetch').click();
            }
        });

        // Drag
        let drag = false, ox, oy;
        document.getElementById('kh-hdr').onmousedown = e => {
            drag = true;
            const r = ui.getBoundingClientRect();
            ox = e.clientX - r.left;
            oy = e.clientY - r.top;
        };
        document.onmousemove = e => {
            if (!drag) return;
            ui.style.left = Math.max(0, Math.min(window.innerWidth - ui.offsetWidth, e.clientX - ox)) + 'px';
            ui.style.top = Math.max(0, Math.min(window.innerHeight - ui.offsetHeight, e.clientY - oy)) + 'px';
        };
        document.onmouseup = () => drag = false;
    }

    function toggleVisibility() {
        if (!ui) return;
        hidden = !hidden;
        ui.classList.toggle('hidden', hidden);
    }

    // ---------- MONITOR ----------
    function monitor() {
        let last = -1;
        setInterval(() => {
            const i = currentQ();
            const t = totalQ();
            if (i >= 0) {
                document.getElementById('kh-q').textContent = (i + 1) + '/' + (t || questions.length);
            }
            if (i >= 0 && i !== last) {
                last = i;
                clearHighlights();
            }
        }, 250);
    }

    // ---------- KEYBIND ----------
    document.addEventListener('keydown', e => {
        if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            e.preventDefault();
            toggleVisibility();
            return;
        }
        if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            e.preventDefault();
            if (loaded) flashAnswers();
        }
    });

    // ---------- INIT ----------
    function init() {
        buildUI();
        monitor();

        // 1. Restore last saved input
        const saved = getLastInput();
        if (saved) {
            document.getElementById('kh-quiz').value = saved;
            setTimeout(() => fetchQuiz(saved, true), 1500);
        }
        // 2. Otherwise, try to detect challenge ID from URL
        else {
            setTimeout(() => {
                const m = location.href.match(/\/challenge\/([a-zA-Z0-9_-]+)/);
                if (m) {
                    document.getElementById('kh-quiz').value = m[1];
                    document.getElementById('kh-fetch').click();
                }
            }, 1000);
        }

        console.log('[KaHack] v23.1 ready');
    }

    init();
})();