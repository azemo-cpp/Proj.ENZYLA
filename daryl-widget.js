/* Daryl chat widget. Isang file lang, walang dependencies.
Panel sa loob ng isang box:  Daryl.mount("#box", { api: "https://your-server" })
Floating bubble:             Daryl.mount(null, { api: "https://your-server", mode: "bubble" })
Gumagamit ng Shadow DOM, kaya hindi nito ginugulo ang styles ng website mo. */
(function () {
  "use strict";

  const scriptSrc = document.currentScript && document.currentScript.src;
  const defaultApi = scriptSrc ? new URL(scriptSrc).origin : "";

  const CSS = `
    :host {
      --daryl-accent: #3b5bdb; --daryl-bg: #ffffff; --daryl-fg: #1a1b1e;
      --daryl-muted: #f1f3f5; --daryl-border: #d0d5dd; --daryl-radius: 12px;
      --daryl-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      display: block; font-family: var(--daryl-font); color: var(--daryl-fg);
    }
    @media (prefers-color-scheme: dark) {
      :host { --daryl-bg: #16181d; --daryl-fg: #e8eaed; --daryl-muted: #23262d; --daryl-border: #3a3f4a; }
    }
    * { box-sizing: border-box; }
    .panel { display: flex; flex-direction: column; height: 100%; min-height: 320px; background: var(--daryl-bg);
      border: 1px solid var(--daryl-border); border-radius: var(--daryl-radius); overflow: hidden; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
      background: var(--daryl-accent); color: #fff; font-weight: 600; }
    header button { background: none; border: 0; color: inherit; font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 6px; }
    .log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .msg { max-width: 92%; padding: 8px 12px; border-radius: 10px; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
    .msg.user { align-self: flex-end; background: var(--daryl-accent); color: #fff; }
    .msg.daryl { align-self: flex-start; background: var(--daryl-muted); }
    .msg.error { border: 1px solid #c92a2a; }
    .text { white-space: pre-wrap; margin: 0; }
    .text + .tablewrap, .tablewrap + .text { margin-top: 8px; }
    .tablewrap { overflow-x: auto; }
    table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
    th, td { border: 1px solid var(--daryl-border); padding: 4px 8px; text-align: left; vertical-align: top; }
    th { font-weight: 600; }
    .row { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--daryl-border); }
    input { flex: 1; min-width: 0; padding: 9px 10px; font: inherit; font-size: 14px; color: inherit;
      background: var(--daryl-bg); border: 1px solid var(--daryl-border); border-radius: 8px; }
    input:focus-visible, button:focus-visible { outline: 2px solid var(--daryl-accent); outline-offset: 2px; }
    .send { padding: 9px 14px; font: inherit; font-size: 14px; font-weight: 600; color: #fff;
      background: var(--daryl-accent); border: 0; border-radius: 8px; cursor: pointer; }
    .send:disabled { opacity: .55; cursor: default; }
    .fab { display: none; padding: 12px 18px; font: inherit; font-weight: 600; color: #fff; background: var(--daryl-accent);
      border: 0; border-radius: 999px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
    :host(.bubble) { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; }
    :host(.bubble) .fab { display: block; }
    :host(.bubble) .panel { display: none; width: min(380px, calc(100vw - 32px)); height: min(520px, calc(100vh - 100px)); box-shadow: 0 8px 30px rgba(0,0,0,.3); }
    :host(.bubble.open) .panel { display: flex; }
    :host(.bubble.open) .fab { display: none; }
    :host(:not(.bubble)) header button { display: none; }
  `;

  // Tables lang ang special. Lahat ng text ay textContent, kaya walang HTML injection.
  function renderAnswer(node, text) {
    node.textContent = "";
    const lines = String(text).split("\n");
    let textBuf = [];
    let tableBuf = [];

    const flushText = () => {
      const joined = textBuf.join("\n").replace(/^\n+|\n+$/g, "");
      if (joined) {
        const p = document.createElement("p");
        p.className = "text";
        p.textContent = joined;
        node.appendChild(p);
      }
      textBuf = [];
    };
    const flushTable = () => {
      if (!tableBuf.length) return;
      const rows = tableBuf
        .map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()))
        .filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));
      const table = document.createElement("table");
      rows.forEach((cells, i) => {
        const tr = document.createElement("tr");
        cells.forEach(c => {
          const cell = document.createElement(i === 0 ? "th" : "td");
          cell.textContent = c;
          tr.appendChild(cell);
        });
        table.appendChild(tr);
      });
      const wrap = document.createElement("div");
      wrap.className = "tablewrap";
      wrap.appendChild(table);
      node.appendChild(wrap);
      tableBuf = [];
    };

    for (const line of lines) {
      if (/^\s*\|.*\|\s*$/.test(line)) { flushText(); tableBuf.push(line); }
      else { flushTable(); textBuf.push(line); }
    }
    flushText();
    flushTable();
  }

  function mount(target, options) {
    const opts = Object.assign({
      api: defaultApi,
      mode: "panel",
      title: "Daryl",
      placeholder: "Ask about a site or date",
      greeting: "Hi, I'm Daryl. Ask me to compare landing sites or find the best landing date.",
      settings: null
    }, options || {});
    const bubble = opts.mode === "bubble";

    let parent = document.body;
    if (!bubble) {
      parent = typeof target === "string" ? document.querySelector(target) : target;
      if (!parent) throw new Error("Daryl: target element not found.");
    }

    const host = document.createElement("div");
    host.setAttribute("data-daryl", "");
    if (bubble) host.className = "bubble";
    else host.style.height = "100%";
    parent.appendChild(host);

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      "<style></style>" +
      '<button class="fab" type="button"></button>' +
      '<section class="panel"><header><span class="title"></span>' +
      '<button class="close" type="button" aria-label="Close chat">\u00d7</button></header>' +
      '<div class="log" role="log" aria-live="polite"></div>' +
      '<div class="row"><input type="text" maxlength="2000" autocomplete="off">' +
      '<button class="send" type="button">Send</button></div></section>';

    root.querySelector("style").textContent = CSS;
    root.querySelector(".title").textContent = opts.title;
    root.querySelector(".fab").textContent = "Ask " + opts.title;
    const log = root.querySelector(".log");
    const input = root.querySelector("input");
    const sendBtn = root.querySelector(".send");
    input.placeholder = opts.placeholder;
    input.setAttribute("aria-label", "Your question");

    function addMessage(role, text) {
      const div = document.createElement("div");
      div.className = "msg " + role;
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }

    let busy = false;
    function setBusy(value) {
      busy = value;
      sendBtn.disabled = value;
    }

    async function send() {
      const question = input.value.trim();
      if (!question || busy) return;
      addMessage("user", question);
      input.value = "";
      setBusy(true);
      const reply = addMessage("daryl", "Thinking...");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      const payload = opts.settings ? { question, settings: opts.settings } : { question };

      try {
        const res = await fetch(opts.api + "/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* hindi JSON ang sagot */ }

        if (res.ok && data && data.ok) {
          renderAnswer(reply, data.answer);
        } else {
          reply.classList.add("error");
          reply.textContent = (data && data.message) || "Sorry, something went wrong. Please try again.";
        }
      } catch (error) {
        reply.classList.add("error");
        reply.textContent = error && error.name === "AbortError"
          ? "That took too long. Please try again."
          : "Can't reach Daryl right now.";
      } finally {
        clearTimeout(timer);
        setBusy(false);
        log.scrollTop = log.scrollHeight;
        input.focus();
      }
    }

    const open = () => { host.classList.add("open"); input.focus(); };
    const close = () => host.classList.remove("open");

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
    root.querySelector(".fab").addEventListener("click", open);
    root.querySelector(".close").addEventListener("click", close);
    root.addEventListener("keydown", e => { if (e.key === "Escape" && bubble) close(); });

    if (opts.greeting) addMessage("daryl", opts.greeting);

    return { open, close, destroy: () => host.remove() };
  }

  window.Daryl = { mount };
})();
