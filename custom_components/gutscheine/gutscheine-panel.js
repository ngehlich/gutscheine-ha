/* Gutscheine – Seitenleisten-App für Home Assistant. */
"use strict";

/* ---------- Code 128 (B, bzw. C für reine Ziffernfolgen gerader Länge) ---------- */
const C128 = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];

function code128(text) {
  let codes;
  if (/^(\d\d)+$/.test(text)) {
    codes = [105];
    for (let i = 0; i < text.length; i += 2) codes.push(parseInt(text.substr(i, 2), 10));
  } else {
    codes = [104];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) return null; // nicht darstellbar
      codes.push(c - 32);
    }
  }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes.map((c) => C128[c]).join("");
}

function barcodeSvg(text) {
  const pattern = code128(text);
  if (!pattern) return "";
  const quiet = 10;
  let x = quiet;
  let rects = "";
  [...pattern].forEach((w, i) => {
    w = +w;
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="60"/>`;
    x += w;
  });
  const width = x + quiet;
  return `<svg viewBox="0 0 ${width} 60" preserveAspectRatio="none" class="barcode" role="img" aria-label="Barcode ${esc(text)}"><rect width="${width}" height="60" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

/* ---------- Helfer ---------- */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eur = (v) =>
  v === null || v === undefined ? "–" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fmtDate = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("de-DE") : "");
const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const daysLeft = (v) => (v.expires ? Math.round((new Date(v.expires + "T00:00:00") - today()) / 864e5) : null);
const SOON = 30;
function status(v) {
  if (v.redeemed) return "eingeloest";
  const d = daysLeft(v);
  if (d === null) return "aktiv";
  if (d < 0) return "abgelaufen";
  return d <= SOON ? "bald" : "aktiv";
}
const STATUS_TEXT = { aktiv: "Gültig", bald: "Läuft bald ab", abgelaufen: "Abgelaufen", eingeloest: "Eingelöst" };
function expiryText(v) {
  const d = daysLeft(v);
  if (d === null) return "kein Ablaufdatum";
  if (v.redeemed) return `bis ${fmtDate(v.expires)}`;
  if (d < 0) return `abgelaufen am ${fmtDate(v.expires)}`;
  if (d === 0) return "läuft heute ab";
  if (d <= SOON) return `noch ${d} ${d === 1 ? "Tag" : "Tage"} (${fmtDate(v.expires)})`;
  return `bis ${fmtDate(v.expires)}`;
}

const STYLE = `
:host{display:block;min-height:100vh;background:var(--primary-background-color);color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,Roboto,system-ui,sans-serif)}
header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;height:56px;padding:0 12px;background:var(--app-header-background-color,var(--primary-color));color:var(--app-header-text-color,#fff)}
header h1{flex:1;margin:0;font-size:20px;font-weight:400}
header button{color:inherit}
button{font:inherit;cursor:pointer;border:none;background:none;color:var(--primary-color);padding:8px 12px;border-radius:8px}
button.icon{padding:8px;display:inline-flex}
button.primary{background:var(--primary-color);color:var(--text-primary-color,#fff)}
button.danger{color:var(--error-color,#db4437)}
main{max-width:720px;margin:0 auto;padding:16px 16px 96px}
.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}
.tile{background:var(--card-background-color);border-radius:12px;padding:12px;box-shadow:var(--ha-card-box-shadow,none);border:1px solid var(--divider-color)}
.tile b{display:block;font-size:20px;font-weight:500}
.tile span{font-size:12px;color:var(--secondary-text-color)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.chip{border:1px solid var(--divider-color);border-radius:16px;padding:4px 12px;color:var(--primary-text-color)}
.chip.on{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
h2{font-size:14px;font-weight:500;color:var(--secondary-text-color);margin:20px 4px 8px;text-transform:uppercase;letter-spacing:.04em}
.list{display:flex;flex-direction:column;gap:8px}
.item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:12px;padding:12px 14px;color:var(--primary-text-color)}
.item .main{flex:1;min-width:0}
.item .shop{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item .sub{font-size:13px;color:var(--secondary-text-color)}
.item .amount{font-size:17px;font-weight:500;white-space:nowrap}
.dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--success-color,#43a047)}
.dot.bald{background:var(--warning-color,#ffa600)}
.dot.abgelaufen{background:var(--error-color,#db4437)}
.dot.eingeloest{background:var(--disabled-text-color,#999)}
.item.abgelaufen,.item.eingeloest{opacity:.65}
.fab{position:fixed;right:20px;bottom:20px;border-radius:16px;padding:16px 20px;box-shadow:0 3px 8px rgba(0,0,0,.3)}
.empty{text-align:center;color:var(--secondary-text-color);padding:40px 0}
dialog{border:none;border-radius:16px;padding:0;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);background:var(--card-background-color);color:var(--primary-text-color)}
dialog::backdrop{background:rgba(0,0,0,.5)}
.dlg{padding:20px}
.dlg h3{margin:0 0 4px;font-size:22px;font-weight:400}
.dlg .meta{color:var(--secondary-text-color);margin-bottom:12px}
.big{font-size:32px;font-weight:500;margin:8px 0}
.codebox{background:#fff;border-radius:8px;padding:12px;margin:12px 0;text-align:center;color:#000}
.barcode{width:100%;height:96px;display:block}
.codetext{font-family:monospace;font-size:18px;letter-spacing:.08em;margin-top:6px;word-break:break-all}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;margin:12px 0}
dt{color:var(--secondary-text-color)}dd{margin:0;word-break:break-word}
.actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px}
form label{display:block;margin:10px 0 0;font-size:13px;color:var(--secondary-text-color)}
form input,form textarea{box-sizing:border-box;width:100%;font:inherit;padding:10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.hist{font-size:14px;color:var(--secondary-text-color)}
.err{color:var(--error-color,#db4437);margin-top:8px}
`;

class GutscheinePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.vouchers = [];
    this.owner = "alle";
    this.showOld = false;
    this.loaded = false;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._start();
  }
  get hass() {
    return this._hass;
  }
  set narrow(v) {
    this._narrow = v;
    this._renderHeader();
  }

  async _start() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><header></header><main></main>
      <button class="primary fab" id="add">+ Gutschein</button><dialog></dialog>`;
    this._renderHeader();
    this.shadowRoot.getElementById("add").onclick = () => this._edit(null);
    this.shadowRoot.querySelector("main").addEventListener("click", (e) => this._onMainClick(e));
    await this._load();
    this._unsub = await this.hass.connection.subscribeMessage(() => this._load(), { type: "gutscheine/subscribe" });
    const id = new URLSearchParams(location.search).get("id");
    if (id) this._detail(id);
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
    this._unsub = null;
    this._hass = null; // beim erneuten Öffnen neu starten
  }

  _renderHeader() {
    const h = this.shadowRoot.querySelector("header");
    if (!h) return;
    h.innerHTML = `${this._narrow ? '<button class="icon" id="menu" aria-label="Menü">☰</button>' : ""}<h1>Gutscheine</h1>`;
    const m = h.querySelector("#menu");
    if (m) m.onclick = () => this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  async _load() {
    const res = await this.hass.callWS({ type: "gutscheine/list" });
    this.vouchers = res.vouchers;
    this.loaded = true;
    this._render();
    if (this._openId) this._detail(this._openId, true);
  }

  _filtered() {
    return this.vouchers.filter((v) => this.owner === "alle" || (v.owner || "–") === this.owner);
  }

  _render() {
    const main = this.shadowRoot.querySelector("main");
    const list = this._filtered();
    const open = list.filter((v) => ["aktiv", "bald"].includes(status(v)));
    const total = open.reduce((s, v) => s + (v.balance || 0), 0);
    const soon = list.filter((v) => status(v) === "bald").length;
    const owners = [...new Set(this.vouchers.map((v) => v.owner || "–"))].sort();
    const byExpiry = (a, b) => (a.expires || "9999").localeCompare(b.expires || "9999") || a.shop.localeCompare(b.shop);
    const group = (st) => list.filter((v) => status(v) === st).sort(byExpiry);
    const old = [...group("abgelaufen"), ...group("eingeloest")];

    const item = (v) => {
      const st = status(v);
      return `<button class="item ${st}" data-id="${esc(v.id)}">
        <span class="dot ${st}" title="${STATUS_TEXT[st]}"></span>
        <span class="main"><div class="shop">${esc(v.shop)}</div>
        <div class="sub">${esc(expiryText(v))}${v.owner ? " · " + esc(v.owner) : ""}</div></span>
        <span class="amount">${v.balance === null ? (v.kind ? esc(v.kind) : "–") : eur(v.balance)}</span></button>`;
    };

    main.innerHTML = `
      <div class="summary">
        <div class="tile"><b>${eur(total)}</b><span>Gesamtwert</span></div>
        <div class="tile"><b>${open.length}</b><span>offen</span></div>
        <div class="tile"><b>${soon}</b><span>laufen bald ab</span></div>
      </div>
      ${owners.length > 1 ? `<div class="chips">${["alle", ...owners].map((o) => `<button class="chip ${o === this.owner ? "on" : ""}" data-owner="${esc(o)}">${o === "alle" ? "Alle" : o === "–" ? "Ohne Besitzer" : esc(o)}</button>`).join("")}</div>` : ""}
      ${!this.loaded ? "" : list.length === 0 ? '<div class="empty">Noch keine Gutscheine. Unten rechts anlegen.</div>' : ""}
      ${group("bald").length ? `<h2>Läuft bald ab</h2><div class="list">${group("bald").map(item).join("")}</div>` : ""}
      ${group("aktiv").length ? `<h2>Gültig</h2><div class="list">${group("aktiv").map(item).join("")}</div>` : ""}
      ${old.length ? `<h2><button id="toggleOld">${this.showOld ? "▾" : "▸"} Abgelaufen und eingelöst (${old.length})</button></h2>
        ${this.showOld ? `<div class="list">${old.map(item).join("")}</div>` : ""}` : ""}`;
  }

  _onMainClick(e) {
    const it = e.target.closest(".item");
    if (it) return this._detail(it.dataset.id);
    const chip = e.target.closest(".chip");
    if (chip) {
      this.owner = chip.dataset.owner;
      return this._render();
    }
    if (e.target.closest("#toggleOld")) {
      this.showOld = !this.showOld;
      this._render();
    }
  }

  _dialog(html) {
    const d = this.shadowRoot.querySelector("dialog");
    d.innerHTML = `<div class="dlg">${html}</div>`;
    if (!d.open) d.showModal();
    d.onclose = () => (this._openId = null);
    return d;
  }

  _close() {
    const d = this.shadowRoot.querySelector("dialog");
    this._openId = null;
    if (d.open) d.close();
  }

  _detail(id, refresh = false) {
    const v = this.vouchers.find((x) => x.id === id);
    if (!v) return refresh ? this._close() : undefined;
    const d = this.shadowRoot.querySelector("dialog");
    if (refresh && d.querySelector("form")) return; // Bearbeiten nicht überschreiben
    this._openId = id;
    const st = status(v);
    const hist = (v.history || [])
      .map((h) => `<div>${fmtDate(h.date)}: ${eur(h.amount)}${h.note ? " – " + esc(h.note) : ""}</div>`)
      .join("");
    const dlg = this._dialog(`
      <h3>${esc(v.shop)}</h3>
      <div class="meta">${STATUS_TEXT[st]} · ${esc(expiryText(v))}</div>
      <div class="big">${v.balance === null ? "Betrag unbekannt" : eur(v.balance)}</div>
      ${v.code ? `<div class="codebox">${barcodeSvg(v.code)}<div class="codetext">${esc(v.code)}</div></div>` : ""}
      <dl>
        ${v.value !== null && v.value !== v.balance ? `<dt>Ursprünglich</dt><dd>${eur(v.value)}</dd>` : ""}
        ${v.pin ? `<dt>PIN</dt><dd>${esc(v.pin)}</dd>` : ""}
        ${v.owner ? `<dt>Besitzer</dt><dd>${esc(v.owner)}</dd>` : ""}
        ${v.kind ? `<dt>Art</dt><dd>${esc(v.kind)}</dd>` : ""}
        ${v.note ? `<dt>Notiz</dt><dd>${esc(v.note)}</dd>` : ""}
      </dl>
      ${hist ? `<div class="hist"><b>Eingelöst</b>${hist}</div>` : ""}
      <div class="actions">
        <button class="danger" data-a="del">Löschen</button>
        <button data-a="edit">Bearbeiten</button>
        ${v.redeemed ? `<button data-a="reopen">Wieder öffnen</button>` : `<button data-a="part">Teilweise einlösen</button><button class="primary" data-a="full">Ganz einlösen</button>`}
        <button data-a="close">Schließen</button>
      </div>`);
    dlg.querySelector(".actions").onclick = async (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === "close") return this._close();
      if (a === "edit") return this._edit(v);
      if (a === "del") {
        if (confirm(`Gutschein „${v.shop}“ endgültig löschen?`)) {
          this._close();
          await this.hass.callWS({ type: "gutscheine/remove", voucher: v.id });
        }
        return;
      }
      if (a === "full") {
        if (confirm(`„${v.shop}“ komplett als eingelöst markieren?`))
          await this.hass.callWS({ type: "gutscheine/redeem", voucher: v.id });
        return;
      }
      if (a === "reopen") return this.hass.callWS({ type: "gutscheine/save", voucher: v.id, redeemed: false });
      if (a === "part") {
        const raw = prompt("Wie viel Euro wurden eingelöst?", "");
        if (raw === null) return;
        const amount = parseFloat(raw.replace(",", "."));
        if (!(amount > 0)) return alert("Bitte einen Betrag eingeben.");
        await this.hass.callWS({ type: "gutscheine/redeem", voucher: v.id, amount });
      }
    };
  }

  _edit(v) {
    const val = (k) => esc(v?.[k] ?? "");
    const num = (k) => (v?.[k] === null || v?.[k] === undefined ? "" : String(v[k]).replace(".", ","));
    const owners = [...new Set(this.vouchers.map((x) => x.owner).filter(Boolean))];
    const dlg = this._dialog(`
      <h3>${v ? "Gutschein bearbeiten" : "Neuer Gutschein"}</h3>
      <form>
        <label>Geschäft *<input name="shop" required value="${val("shop")}" autocomplete="off"></label>
        <div class="row">
          <label>Ursprungswert (€)<input name="value" inputmode="decimal" value="${num("value")}"></label>
          <label>Restwert (€)<input name="balance" inputmode="decimal" value="${num("balance")}" placeholder="= Ursprungswert"></label>
        </div>
        <div class="row">
          <label>Ablaufdatum<input name="expires" type="date" value="${val("expires")}"></label>
          <label>Besitzer<input name="owner" list="owners" value="${val("owner")}"></label>
        </div>
        <datalist id="owners">${owners.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>
        <label>Code / Kartennummer<input name="code" value="${val("code")}" autocomplete="off"></label>
        <div class="row">
          <label>PIN<input name="pin" value="${val("pin")}" autocomplete="off"></label>
          <label>Art<input name="kind" value="${val("kind")}" placeholder="z. B. Eintrittskarte"></label>
        </div>
        <label>Notiz<textarea name="note" rows="2">${val("note")}</textarea></label>
        <div class="err"></div>
        <div class="actions"><button type="button" data-a="cancel">Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
      </form>`);
    this._openId = null;
    const form = dlg.querySelector("form");
    form.querySelector("[data-a=cancel]").onclick = () => (v ? this._detail(v.id) : this._close());
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const money = (k) => {
        const s = String(f.get(k) || "").trim().replace(/\s|€/g, "").replace(",", ".");
        return s === "" ? null : parseFloat(s);
      };
      const msg = {
        type: "gutscheine/save",
        shop: f.get("shop").trim(),
        value: money("value"),
        balance: money("balance"),
        expires: f.get("expires") || null,
        owner: f.get("owner") || null,
        code: f.get("code") || null,
        pin: f.get("pin") || null,
        kind: f.get("kind") || null,
        note: f.get("note") || null,
      };
      if ([msg.value, msg.balance].some((x) => x !== null && isNaN(x)))
        return (form.querySelector(".err").textContent = "Beträge bitte als Zahl eingeben.");
      if (!v && msg.balance === null) msg.balance = msg.value;
      if (v) msg.voucher = v.id;
      try {
        const res = await this.hass.callWS(msg);
        // Liste kommt über das Abo, Detail sofort aus der Antwort:
        const i = this.vouchers.findIndex((x) => x.id === res.voucher.id);
        if (i >= 0) this.vouchers[i] = res.voucher;
        else this.vouchers.push(res.voucher);
        this._detail(res.voucher.id);
      } catch (err) {
        form.querySelector(".err").textContent = err.message || String(err);
      }
    };
  }
}

customElements.define("gutscheine-panel", GutscheinePanel);
