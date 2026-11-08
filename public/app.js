(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const LS = {
    model: 'pchat.model',
    auto: 'pchat.auto',
    theme: 'pchat.theme',
    last: 'pchat.lastSession',
  };

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2 21h20Z"/><path d="M12 9v5M12 17.5v.5"/></svg>',
  };

  const state = {
    config: null,
    models: [],
    model: localStorage.getItem(LS.model) || '',
    auto: localStorage.getItem(LS.auto) !== 'false',
    theme: localStorage.getItem(LS.theme) || 'system',
    sessions: [],
    currentId: null,
    session: { id: null, title: 'گفتگوی جدید', messages: [] },
    streaming: false,
    stopRequested: false,
    live: null,
    lastUserText: '',
  };

  const els = {
    sidebar: $('#sidebar'),
    scrim: $('#scrim'),
    sessionList: $('#sessionList'),
    messages: $('#messages'),
    input: $('#input'),
    sendBtn: $('#sendBtn'),
    statusText: $('#statusText'),
    chatTitle: $('#chatTitle'),
    chatSub: $('#chatSub'),
    modelChip: $('#modelChip'),
    modelChipText: $('#modelChipText'),
    themeBtn: $('#themeBtn'),
    settingsModal: $('#settingsModal'),
    modelSearch: $('#modelSearch'),
    modelList: $('#modelList'),
    autoToggle: $('#autoToggle'),
    settingsDir: $('#settingsDir'),
    dirText: $('#dirText'),
    toast: $('#toast'),
  };

  /* ---------------------------------- utils --------------------------------- */

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function api(path, options = {}) {
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    return data;
  }

  let toastTimer = null;
  function toast(message, kind = '') {
    els.toast.textContent = message;
    els.toast.className = 'toast ' + kind;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
      } catch {
        return false;
      }
    }
  }

  function shortModel(id) {
    if (!id) return 'مدل';
    return id.replace(/^opencode\//, '');
  }

  function relativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'همین حالا';
    if (min < 60) return `${min} دقیقه پیش`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} ساعت پیش`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} روز پیش`;
    try {
      return new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleDateString();
    }
  }

  function humanizeError(message) {
    const text = String(message || '');
    const rules = [
      [/not available in your country|RegionError/i, 'این مدل در کشور شما در دسترس نیست. از تنظیمات، یک مدل دیگر انتخاب کنید.'],
      [/insufficient account funds|no credit|balance/i, 'موجودی حساب OpenCode کافی نیست. یک مدل با پسوند free انتخاب کنید یا حساب خود را شارژ کنید.'],
      [/auth|credential|login|unauthor/i, 'احراز هویت OpenCode کامل نیست. یک بار opencode را در ترمینال اجرا و وارد شوید.'],
      [/rate.?limit|429|quota|too many requests/i, 'محدودیت مصرف یا تعداد درخواست. کمی بعد دوباره تلاش کنید.'],
      [/context.*length|too long|token limit|maximum context/i, 'پیام خیلی طولانی است و از حد مجاز مدل رد شده. بخشی از آن را کوتاه کنید.'],
      [/model .*not found|invalid model|unknown model/i, 'این مدل پیدا نشد. مدل دیگری از تنظیمات انتخاب کنید.'],
      [/timed? ?out|ETIMEDOUT|ECONN|ENOTFOUND|network|fetch failed|socket/i, 'مشکل در اتصال به سرویس مدل. اینترنت خود را بررسی کنید و دوباره تلاش کنید.'],
      [/permission|denied/i, 'اجازه لازم برای این ابزار داده نشده است. تنظیمات مجوزها را بررسی کنید.'],
    ];
    for (const [pattern, replacement] of rules) {
      if (pattern.test(text)) return replacement;
    }
    return text ? 'خطای OpenCode: ' + text : 'خطای نامشخص';
  }

  /* --------------------------------- render --------------------------------- */

  const PURIFY_CONFIG = {
    ALLOWED_TAGS: ['a', 'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
      'span', 'sup', 'sub', 'input'],
    ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'class', 'start', 'align', 'type', 'checked', 'disabled'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'iframe', 'form', 'button', 'textarea', 'select', 'option', 'script'],
  };

  function renderMarkdown(text) {
    const container = document.createElement('div');
    container.className = 'markdown';
    let html;
    try {
      html = marked.parse(String(text || ''), { gfm: true, breaks: true });
    } catch {
      html = '<p>' + escapeHtml(text) + '</p>';
    }
    container.innerHTML = window.DOMPurify
      ? DOMPurify.sanitize(html, PURIFY_CONFIG)
      : escapeHtml(html);

    $$('a', container).forEach((a) => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });

    $$('pre', container).forEach((pre) => {
      const code = pre.querySelector('code');
      let lang = '';
      if (code) {
        const m = (code.className || '').match(/language-([\w+#.-]+)/);
        if (m) lang = m[1];
      }
      const wrap = document.createElement('div');
      wrap.className = 'codeblock';
      const bar = document.createElement('div');
      bar.className = 'codebar';
      const label = document.createElement('span');
      label.className = 'lang';
      label.textContent = lang || 'code';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = ICONS.copy + '<span>کپی</span>';
      btn.addEventListener('click', async () => {
        const ok = await copyText(code ? code.textContent : pre.textContent);
        if (!ok) return toast('کپی نشد', 'error');
        btn.innerHTML = ICONS.check + '<span>کپی شد</span>';
        setTimeout(() => { btn.innerHTML = ICONS.copy + '<span>کپی</span>'; }, 1500);
      });
      bar.append(label, btn);
      pre.parentNode.insertBefore(wrap, pre);
      wrap.append(bar, pre);
    });

    $$('p, li, h1, h2, h3, h4, h5, h6, blockquote, th, td', container).forEach((el) => {
      el.setAttribute('dir', 'auto');
    });

    return container;
  }

  function toolChip(tool) {
    const chip = document.createElement('div');
    chip.className = 'tool-chip';
    const status = tool.status || 'running';
    let icon = '<span class="spinner"></span>';
    if (status === 'completed') icon = ICONS.check;
    else if (status === 'error') icon = ICONS.warn;
    chip.innerHTML = icon + '<span class="t-name">' + escapeHtml(tool.tool || 'tool') + '</span>';
    if (tool.detail) {
      const d = document.createElement('span');
      d.className = 't-detail';
      d.textContent = tool.detail;
      d.title = tool.detail;
      chip.append(d);
    }
    if (status === 'completed') chip.classList.add('ok');
    if (status === 'error') chip.classList.add('fail');
    return chip;
  }

  function avatar(kind) {
    const el = document.createElement('div');
    el.className = 'avatar ' + (kind === 'user' ? 'user' : 'ai');
    el.textContent = kind === 'user' ? 'ش' : 'پ';
    return el;
  }

  function renderUserMessage(msg) {
    const wrap = document.createElement('article');
    wrap.className = 'msg msg-user';
    const body = document.createElement('div');
    body.className = 'msg-body';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.dir = 'auto';
    bubble.textContent = msg.text;
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'mini-btn';
    copy.innerHTML = ICONS.copy + '<span>کپی</span>';
    copy.addEventListener('click', async () => {
      const ok = await copyText(msg.text);
      if (ok) {
        copy.innerHTML = ICONS.check + '<span>کپی شد</span>';
        setTimeout(() => { copy.innerHTML = ICONS.copy + '<span>کپی</span>'; }, 1500);
      }
    });
    actions.append(copy);
    body.append(bubble, actions);
    wrap.append(avatar('user'), body);
    return wrap;
  }

  function renderAssistantMessage(msg) {
    const wrap = document.createElement('article');
    wrap.className = 'msg msg-assistant';
    const body = document.createElement('div');
    body.className = 'msg-body';

    const tools = document.createElement('div');
    tools.className = 'tools';
    for (const tool of msg.tools || []) tools.append(toolChip(tool));

    const content = renderMarkdown(msg.text || '');

    const errorNote = document.createElement('div');
    errorNote.className = 'error-note';
    errorNote.hidden = true;
    if (msg.error) {
      errorNote.hidden = false;
      errorNote.textContent = humanizeError(msg.error);
    } else if (msg.aborted) {
      errorNote.hidden = false;
      errorNote.className = 'abort-note';
      errorNote.textContent = 'پاسخ توسط شما متوقف شد.';
    }

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    if (msg.text) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'mini-btn';
      copy.innerHTML = ICONS.copy + '<span>کپی پاسخ</span>';
      copy.addEventListener('click', async () => {
        const ok = await copyText(msg.text);
        if (ok) {
          copy.innerHTML = ICONS.check + '<span>کپی شد</span>';
          setTimeout(() => { copy.innerHTML = ICONS.copy + '<span>کپی پاسخ</span>'; }, 1500);
        }
      });
      actions.append(copy);
    }

    body.append(tools, content, errorNote, actions);
    wrap.append(avatar('ai'), body);

    return { el: wrap, toolsEl: tools, contentEl: content, errorEl: errorNote, actionsEl: actions };
  }

  function renderWelcome() {
    els.messages.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'welcome';
    box.innerHTML =
      '<div class="welcome-logo">پ</div>' +
      '<h2>چطور می‌تونم کمکت کنم؟</h2>' +
      '<p>اینجا یک چت فارسی است که مستقیم به OpenCode روی سیستم شما وصل می‌شود.</p>';

    const suggestions = [
      ['توضیح یک پروژه', 'ساختار پوشه جاری را بررسی کن و توضیح بده این پروژه چه کار می‌کند.'],
      ['نوشتن کد', 'یک تابع پایتون بنویس که فایل‌های تکراری را در یک پوشه پیدا کند.'],
      ['ترجمه', 'متن زیر را به انگلیسی روان ترجمه کن و اصطلاحات فنی را حفظ کن.'],
      ['اسکریپت ویندوز', 'یک اسکریپت PowerShell برای پشتیبان‌گیری از یک پوشه بنویس.'],
    ];
    const grid = document.createElement('div');
    grid.className = 'suggestions';
    for (const [title, prompt] of suggestions) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'suggestion';
      card.innerHTML = '<b>' + escapeHtml(title) + '</b><span>' + escapeHtml(prompt) + '</span>';
      card.addEventListener('click', () => {
        els.input.value = prompt;
        autoResize();
        els.input.focus();
      });
      grid.append(card);
    }
    box.append(grid);
    els.messages.append(box);
  }

  function scrollToBottom(force = false) {
    const gap = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
    if (force || gap < 120) els.messages.scrollTop = els.messages.scrollHeight;
  }

  function ensureThread() {
    let thread = $('.thread', els.messages);
    if (!thread) {
      els.messages.innerHTML = '';
      thread = document.createElement('div');
      thread.className = 'thread';
      els.messages.append(thread);
    }
    return thread;
  }

  function renderThread() {
    if (!state.session || !state.session.messages || state.session.messages.length === 0) {
      renderWelcome();
      return;
    }
    els.messages.innerHTML = '';
    const thread = document.createElement('div');
    thread.className = 'thread';
    for (const msg of state.session.messages) {
      if (msg.role === 'user') thread.append(renderUserMessage(msg));
      else {
        const built = renderAssistantMessage(msg);
        thread.append(built.el);
      }
    }
    els.messages.append(thread);
    scrollToBottom(true);
  }

  function renderSidebar() {
    els.sessionList.innerHTML = '';
    if (!state.sessions.length) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = 'هنوز گفتگویی ندارید';
      els.sessionList.append(empty);
      return;
    }
    for (const session of state.sessions) {
      const item = document.createElement('div');
      item.className = 'session-item' + (session.id === state.currentId ? ' active' : '');
      item.dataset.id = session.id;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');

      const title = document.createElement('span');
      title.className = 's-title';
      title.textContent = session.title || 'گفتگوی جدید';
      title.title = 'برای تغییر نام، دوبار کلیک کنید';
      title.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const next = prompt('عنوان جدید:', session.title || '');
        if (!next || !next.trim()) return;
        try {
          await api('/api/sessions/' + encodeURIComponent(session.id), { method: 'PATCH', body: { title: next.trim() } });
          if (state.currentId === session.id) {
            state.session.title = next.trim();
            updateHeader();
          }
          await loadSessions();
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      const time = document.createElement('span');
      time.className = 's-time';
      time.textContent = relativeTime(session.updatedAt);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 's-del';
      del.title = 'حذف گفتگو';
      del.innerHTML = ICONS.trash;
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(session.id);
      });

      item.append(title, time, del);
      item.addEventListener('click', () => openSession(session.id));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openSession(session.id);
        }
      });
      els.sessionList.append(item);
    }
  }

  function updateHeader() {
    els.chatTitle.textContent = state.session.title || 'گفتگوی جدید';
    els.chatSub.textContent = state.streaming ? 'در حال نوشتن…' : 'آماده';
    els.modelChipText.textContent = shortModel(state.model);
    els.modelChip.title = state.model;
  }

  function setStatus(text) {
    els.statusText.textContent = text || '';
  }

  /* -------------------------------- sessions -------------------------------- */

  async function loadSessions() {
    try {
      const data = await api('/api/sessions');
      state.sessions = data.sessions || [];
      renderSidebar();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function openSession(id) {
    if (state.streaming) {
      toast('اول پاسخ در حال اجرا را متوقف یا تمام کنید', 'error');
      return;
    }
    try {
      const data = await api('/api/sessions/' + encodeURIComponent(id));
      state.session = data.session;
      state.currentId = id;
      localStorage.setItem(LS.last, id);
      renderThread();
      updateHeader();
      renderSidebar();
      closeSidebar();
      els.input.focus();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function newChat() {
    if (state.streaming) {
      toast('اول پاسخ در حال اجرا را متوقف کنید', 'error');
      return;
    }
    state.currentId = null;
    state.session = { id: null, title: 'گفتگوی جدید', messages: [] };
    localStorage.removeItem(LS.last);
    renderWelcome();
    updateHeader();
    renderSidebar();
    closeSidebar();
    els.input.focus();
  }

  async function deleteSession(id) {
    if (!confirm('این گفتگو حذف شود؟')) return;
    try {
      await api('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
      if (state.currentId === id) newChat();
      await loadSessions();
      toast('گفتگو حذف شد', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* --------------------------------- streaming ------------------------------ */

  function createLiveAssistant() {
    const built = renderAssistantMessage({ text: '', tools: [] });
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    built.contentEl.append(typing);

    let contentEl = built.contentEl;
    let currentText = '';
    let frame = null;
    const toolNodes = new Map();

    const paint = () => {
      frame = null;
      const fresh = renderMarkdown(currentText);
      if (state.streaming) {
        const caret = document.createElement('span');
        caret.className = 'caret';
        fresh.append(caret);
      }
      contentEl.replaceWith(fresh);
      contentEl = fresh;
      scrollToBottom();
    };

    return {
      el: built.el,
      setText(text) {
        currentText = text || '';
        if (typing.isConnected) typing.remove();
        if (frame) return;
        frame = requestAnimationFrame(paint);
      },
      upsertTool(tool) {
        if (toolNodes.has(tool.id)) {
          const next = toolChip(tool);
          toolNodes.get(tool.id).replaceWith(next);
          toolNodes.set(tool.id, next);
        } else {
          const chip = toolChip(tool);
          built.toolsEl.append(chip);
          toolNodes.set(tool.id, chip);
        }
        scrollToBottom();
      },
      showError(message) {
        built.errorEl.hidden = false;
        built.errorEl.textContent = humanizeError(message);
        this.errorText = message;
      },
      finalize(msg) {
        if (typing.isConnected) typing.remove();
        if (frame) {
          cancelAnimationFrame(frame);
          frame = null;
        }
        if (msg) {
          const saved = renderAssistantMessage(msg);
          built.el.replaceWith(saved.el);
        } else {
          const fresh = renderMarkdown(currentText);
          contentEl.replaceWith(fresh);
          contentEl = fresh;
        }
        return currentText;
      },
    };
  }

  async function sendMessage(rawText) {
    const text = String(rawText || '').trim();
    if (!text || state.streaming) return;

    if (!state.config || !state.config.opencode) {
      toast('OpenCode پیدا نشد. ابتدا آن را نصب کنید.', 'error');
      return;
    }

    state.lastUserText = text;
    els.input.value = '';
    autoResize();

    const thread = ensureThread();
    thread.append(renderUserMessage({ role: 'user', text }));

    const userMsg = { role: 'user', text, ts: Date.now() };
    state.session.messages.push(userMsg);

    const live = createLiveAssistant();
    state.live = live;
    thread.append(live.el);
    scrollToBottom(true);

    state.streaming = true;
    state.stopRequested = false;
    updateComposerState();
    updateHeader();
    setStatus('در حال ارسال…');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.currentId,
          message: text,
          model: state.model,
          auto: state.auto,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      await readStream(res, live);
    } catch (err) {
      live.showError(err.message);
      setStatus('خطا');
      toast(humanizeError(err.message), 'error');
    } finally {
      state.streaming = false;
      state.live = null;
      updateComposerState();
      updateHeader();
      setStatus(state.stopRequested ? 'متوقف شد' : '');
      await loadSessions();
    }
  }

  async function readStream(res, live) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    const handle = (line) => {
      if (!line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); } catch { return; }

      switch (evt.type) {
        case 'session': {
          if (evt.session && evt.session.id) {
            const wasNew = state.currentId !== evt.session.id;
            state.currentId = evt.session.id;
            state.session.id = evt.session.id;
            state.session.title = evt.session.title || state.session.title;
            localStorage.setItem(LS.last, evt.session.id);
            if (wasNew) loadSessions();
            updateHeader();
          }
          setStatus('در حال فکر کردن…');
          break;
        }
        case 'text': {
          live.setText(evt.text);
          setStatus('در حال نوشتن…');
          break;
        }
        case 'tool': {
          live.upsertTool(evt);
          setStatus(evt.status === 'completed' ? 'ابزار تمام شد' : 'در حال اجرای ابزار…');
          break;
        }
        case 'error': {
          live.showError(evt.message);
          break;
        }
        case 'saved': {
          live.finalize(evt.message);
          if (evt.session && evt.session.title) state.session.title = evt.session.title;
          finished = true;
          break;
        }
        case 'done': {
          if (!finished) live.finalize(null);
          finished = true;
          if (evt.aborted) setStatus('متوقف شد');
          break;
        }
        default:
          break;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handle(line);
      }
      scrollToBottom();
    }
    if (buffer.trim()) handle(buffer);
  }

  async function stopGeneration() {
    if (!state.streaming) return;
    state.stopRequested = true;
    setStatus('در حال توقف…');
    try {
      if (state.currentId) {
        await api('/api/abort', { method: 'POST', body: { sessionId: state.currentId } });
      }
    } catch {
      /* ignore */
    }
  }

  function updateComposerState() {
    els.sendBtn.classList.toggle('stopping', state.streaming);
    els.sendBtn.setAttribute('aria-label', state.streaming ? 'توقف' : 'ارسال');
    els.input.disabled = false;
  }

  /* ---------------------------------- theme --------------------------------- */

  function applyTheme(choice, persist = true) {
    state.theme = choice;
    if (persist) localStorage.setItem(LS.theme, choice);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const dark = choice === 'dark' || (choice === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    els.themeBtn.innerHTML = dark ? ICONS.sun : ICONS.moon;
    $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === choice));
  }

  /* -------------------------------- settings -------------------------------- */

  function renderModelList(filter = '') {
    const value = filter.trim().toLowerCase();
    els.modelList.innerHTML = '';
    const models = state.models.filter((m) => !value || m.toLowerCase().includes(value));
    if (!models.length) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = 'مدلی پیدا نشد';
      els.modelList.append(empty);
      return;
    }
    for (const model of models) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'model-option' + (model === state.model ? ' selected' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', model === state.model ? 'true' : 'false');
      const free = /free/i.test(model) ? '<span class="free">free</span>' : '';
      btn.innerHTML = '<span>' + escapeHtml(model) + '</span>' + free + '<span class="tick">' + ICONS.check + '</span>';
      btn.addEventListener('click', () => selectModel(model));
      els.modelList.append(btn);
    }
  }

  async function selectModel(model) {
    state.model = model;
    localStorage.setItem(LS.model, model);
    renderModelList(els.modelSearch.value);
    updateHeader();
    try {
      await api('/api/settings', { method: 'POST', body: { model } });
    } catch {
      /* settings are best-effort */
    }
  }

  function openSettings() {
    els.modelSearch.value = '';
    renderModelList('');
    els.autoToggle.checked = state.auto;
    els.settingsDir.textContent = state.config ? state.config.cwd : '—';
    applyTheme(state.theme, false);
    els.settingsModal.hidden = false;
    setTimeout(() => els.modelSearch.focus(), 50);
  }

  function closeSettings() {
    els.settingsModal.hidden = true;
  }

  /* --------------------------------- sidebar -------------------------------- */

  function openSidebar() {
    els.sidebar.classList.add('open');
    els.scrim.classList.add('show');
  }

  function closeSidebar() {
    els.sidebar.classList.remove('open');
    els.scrim.classList.remove('show');
  }

  /* ---------------------------------- input --------------------------------- */

  function autoResize() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 220) + 'px';
  }

  function submit() {
    if (state.streaming) {
      stopGeneration();
      return;
    }
    sendMessage(els.input.value);
  }

  /* ----------------------------------- init --------------------------------- */

  async function init() {
    applyTheme(state.theme, false);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.theme === 'system') applyTheme('system', false);
    });

    els.input.addEventListener('input', autoResize);
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape' && state.streaming) {
        e.preventDefault();
        stopGeneration();
      }
    });
    els.sendBtn.addEventListener('click', submit);

    $('#newChatBtn').addEventListener('click', newChat);
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#modelChip').addEventListener('click', openSettings);
    $('#closeSettings').addEventListener('click', closeSettings);
    els.settingsModal.addEventListener('click', (e) => {
      if (e.target === els.settingsModal) closeSettings();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.settingsModal.hidden) closeSettings();
    });

    els.themeBtn.addEventListener('click', () => {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const dark = state.theme === 'dark' || (state.theme === 'system' && media.matches);
      applyTheme(dark ? 'light' : 'dark');
    });

    els.modelSearch.addEventListener('input', () => renderModelList(els.modelSearch.value));
    els.autoToggle.addEventListener('change', async () => {
      state.auto = els.autoToggle.checked;
      localStorage.setItem(LS.auto, String(state.auto));
      try { await api('/api/settings', { method: 'POST', body: { auto: state.auto } }); } catch { /* ignore */ }
    });

    $$('#themeSeg button').forEach((btn) => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice));
    });

    $('#clearAllBtn').addEventListener('click', async () => {
      if (!confirm('همه گفتگوها پاک شوند؟ این کار برگشت‌پذیر نیست.')) return;
      try {
        for (const s of state.sessions) {
          await api('/api/sessions/' + encodeURIComponent(s.id), { method: 'DELETE' });
        }
        await loadSessions();
        newChat();
        closeSettings();
        toast('همه گفتگوها پاک شد', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('#menuBtn').addEventListener('click', openSidebar);
    els.scrim.addEventListener('click', closeSidebar);

    try {
      const config = await api('/api/config');
      state.config = config;
      state.models = config.models && config.models.length ? config.models : [config.defaultModel];
      if (!state.model || !state.models.includes(state.model)) {
        state.model = config.model || config.defaultModel;
      }
      if (!state.models.includes(state.model)) state.models.unshift(state.model);
      state.auto = typeof config.auto === 'boolean' ? config.auto : state.auto;
      els.autoToggle.checked = state.auto;
      els.settingsDir.textContent = config.cwd;
      els.dirText.textContent = config.cwd;
      els.dirText.parentElement.title = config.cwd;
      updateHeader();
    } catch (err) {
      toast('اتصال به سرور pchat برقرار نشد: ' + err.message, 'error');
    }

    await loadSessions();

    const last = localStorage.getItem(LS.last);
    if (last && state.sessions.some((s) => s.id === last)) await openSession(last);
    else newChat();

    els.input.focus();
  }

  init();
})();
