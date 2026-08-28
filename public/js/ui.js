// Interface DOM : menu, selecteurs, chat, classement.
// Le canvas ne dessine que l'arene ; tout le reste est du DOM (plus net, plus simple).

import { PALETTE, colorOf } from './theme.js';
import { SKIN_IDS, SKIN_LABELS, drawSkinPreview } from './skins.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'agarium:prefs';

export class UI {
  constructor() {
    this.el = {
      menu: $('menu'),
      hud: $('hud'),
      dead: $('dead'),
      nick: $('nick'),
      skinGrid: $('skin-grid'),
      colorRow: $('color-row'),
      modeList: $('mode-list'),
      play: $('play'),
      spectate: $('spectate'),
      again: $('again'),
      toMenu: $('to-menu'),
      conn: $('conn-state'),
      lbList: $('lb-list'),
      statScore: $('stat-score'),
      statCells: $('stat-cells'),
      statPlayers: $('stat-players'),
      chatLog: $('chat-log'),
      chatForm: $('chat-form'),
      chatInput: $('chat-input'),
      chatHint: $('chat-hint'),
      modeBadge: $('mode-badge'),
      minimap: $('minimap'),
      wHint: $('w-hint'),
      optArena: $('opt-arena'),
      optGrid: $('opt-grid'),
      optMass: $('opt-mass'),
      deadScore: $('dead-score'),
      deadTime: $('dead-time'),
      deadXp: $('dead-xp'),
    };

    this.prefs = this.loadPrefs();
    this.modes = [];
    this.chatOpen = false;
    this.maxChatLines = 12;

    this.el.nick.value = this.prefs.name;
    this.el.optArena.checked = this.prefs.arena === 'light';
    this.el.optGrid.checked = this.prefs.grid;
    this.el.optMass.checked = this.prefs.mass;

    this.buildSkins();
    this.buildColors();
  }

  // --- Preferences -----------------------------------------------------------
  loadPrefs() {
    const base = { name: '', skin: 'solid', color: (Math.random() * PALETTE.length) | 0, mode: 'classique', arena: 'dark', grid: true, mass: true };
    try {
      return { ...base, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
    } catch {
      return base;
    }
  }

  savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.prefs));
    } catch {
      /* mode prive : on joue sans memoriser, ce n'est pas bloquant */
    }
  }

  // --- Selecteurs ------------------------------------------------------------
  buildSkins() {
    this.el.skinGrid.replaceChildren();
    for (const id of SKIN_IDS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skin-opt';
      btn.title = SKIN_LABELS[id] || id;
      btn.setAttribute('aria-label', SKIN_LABELS[id] || id);
      btn.setAttribute('aria-pressed', String(id === this.prefs.skin));
      const cv = document.createElement('canvas');
      btn.appendChild(cv);
      btn.addEventListener('click', () => {
        this.prefs.skin = id;
        this.savePrefs();
        this.refreshSkins();
      });
      this.el.skinGrid.appendChild(btn);
      // La taille du canvas depend du layout : on attend la mise en page.
      requestAnimationFrame(() => drawSkinPreview(cv, id, colorOf(this.prefs.color)));
    }
  }

  refreshSkins() {
    const btns = [...this.el.skinGrid.children];
    btns.forEach((btn, i) => {
      const id = SKIN_IDS[i];
      btn.setAttribute('aria-pressed', String(id === this.prefs.skin));
      drawSkinPreview(btn.firstChild, id, colorOf(this.prefs.color));
    });
  }

  buildColors() {
    this.el.colorRow.replaceChildren();
    PALETTE.forEach((hex, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-opt';
      btn.style.background = hex;
      btn.title = hex;
      btn.setAttribute('aria-label', `Couleur ${hex}`);
      btn.setAttribute('aria-pressed', String(i === this.prefs.color));
      btn.addEventListener('click', () => {
        this.prefs.color = i;
        this.savePrefs();
        [...this.el.colorRow.children].forEach((b, j) =>
          b.setAttribute('aria-pressed', String(j === i)),
        );
        this.refreshSkins();
      });
      this.el.colorRow.appendChild(btn);
    });
  }

  setModes(modes) {
    this.modes = modes;
    if (!modes.some((m) => m.id === this.prefs.mode)) this.prefs.mode = modes[0]?.id || 'classique';
    this.el.modeList.replaceChildren();

    for (const m of modes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-opt';
      btn.style.setProperty('--accent', m.color);
      btn.setAttribute('aria-pressed', String(m.id === this.prefs.mode));

      const main = document.createElement('span');
      main.className = 'mode-main';
      const name = document.createElement('span');
      name.className = 'mode-name';
      name.textContent = m.label.fr;
      const desc = document.createElement('span');
      desc.className = 'mode-desc';
      desc.textContent = m.desc.fr;
      main.append(name, desc);

      const count = document.createElement('span');
      count.className = 'mode-count';
      count.textContent = `${m.players}/${m.maxPlayers}`;

      btn.append(main, count);
      btn.addEventListener('click', () => {
        this.prefs.mode = m.id;
        this.savePrefs();
        [...this.el.modeList.children].forEach((b, i) =>
          b.setAttribute('aria-pressed', String(modes[i].id === m.id)),
        );
        this.refreshWHint();
      });
      this.el.modeList.appendChild(btn);
    }
    this.refreshWHint();
  }

  // En Demolition, W ne fait pas la meme chose : on le dit dans le menu.
  refreshWHint() {
    const m = this.modes.find((x) => x.id === this.prefs.mode);
    this.el.wHint.textContent = m?.cannon ? 'tirer sur les adversaires' : 'ejecter de la masse';
  }

  updateModeCounts(modes) {
    modes.forEach((m, i) => {
      const el = this.el.modeList.children[i]?.querySelector('.mode-count');
      if (el) el.textContent = `${m.players}/${m.maxPlayers}`;
    });
  }

  // --- Ecrans ----------------------------------------------------------------
  showMenu() {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.dead.classList.add('hidden');
    this.closeChat();
  }

  showGame(mode) {
    this.el.menu.classList.add('hidden');
    this.el.dead.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    if (mode) {
      this.el.modeBadge.textContent = mode.label.fr;
      this.el.modeBadge.style.color = mode.color;
    }
  }

  showDead({ score, time, xp }) {
    this.el.deadScore.textContent = String(score);
    this.el.deadTime.textContent = `${time}s`;
    this.el.deadXp.textContent = String(xp);
    this.el.dead.classList.remove('hidden');
    this.closeChat();
  }

  setConn(text, cls = '') {
    this.el.conn.textContent = text;
    this.el.conn.className = `conn ${cls}`;
  }

  // --- Classement ------------------------------------------------------------
  setLeaderboard(items, selfId) {
    const list = this.el.lbList;
    list.replaceChildren();
    for (const it of items) {
      const li = document.createElement('li');
      if (it.id === selfId) li.className = 'me';

      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = `${it.rank}.`;

      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = it.name; // textContent : pseudo joueur, jamais interprete

      const score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = formatScore(it.score);

      li.append(rank, name, score);
      list.appendChild(li);
    }
  }

  setStats({ score, cells, players }) {
    this.el.statScore.textContent = formatScore(score);
    this.el.statCells.textContent = String(cells);
    this.el.statPlayers.textContent = String(players);
  }

  // --- Chat ------------------------------------------------------------------
  addChat({ n, c, m }) {
    const div = document.createElement('div');
    div.className = 'msg';
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = colorOf(c);
    who.textContent = `${n}: `; // textContent : contenu joueur, jamais du HTML
    const body = document.createElement('span');
    body.textContent = m;
    div.append(who, body);
    this.pushChatNode(div);
  }

  addSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    this.pushChatNode(div);
  }

  pushChatNode(node) {
    const log = this.el.chatLog;
    log.appendChild(node);
    while (log.children.length > this.maxChatLines) log.removeChild(log.firstChild);
  }

  openChat() {
    this.chatOpen = true;
    this.el.chatForm.classList.remove('hidden');
    this.el.chatHint.classList.add('hidden');
    this.el.chatInput.focus();
  }

  closeChat() {
    this.chatOpen = false;
    this.el.chatInput.value = '';
    this.el.chatInput.blur();
    this.el.chatForm.classList.add('hidden');
    this.el.chatHint.classList.remove('hidden');
  }
}

function formatScore(n) {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
