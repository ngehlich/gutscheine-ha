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

/* ---------- QR-Code (Byte-Modus, Fehlerkorrektur M, Version 1–40) ---------- */
const QR_ECC_M = [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
const QR_BLOCKS_M = [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];

function qrRawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const qrDataCodewords = (ver) => Math.floor(qrRawModules(ver) / 8) - QR_ECC_M[ver] * QR_BLOCKS_M[ver];

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(deg) {
  const r = new Array(deg).fill(0);
  r[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < deg) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
  }
  return r;
}

function qrEncode(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  for (; ver <= 40; ver++) {
    const ccBits = ver < 10 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= qrDataCodewords(ver) * 8) break;
  }
  if (ver > 40) return null;
  const cap = qrDataCodewords(ver) * 8;
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  // Blöcke + Fehlerkorrektur, verschränkt
  const nBlocks = QR_BLOCKS_M[ver], eccLen = QR_ECC_M[ver];
  const raw = Math.floor(qrRawModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const cw = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) cw.push(b[i]); });

  // Matrix
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, on) => { mod[y][x] = on; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((px, i) => pos.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const drawFormat = (mask) => {
    const d = (0 << 3) | mask; // M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const on = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, on); set(c, a, on);
    }
  }
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!fn[y][x] && i < cw.length * 8) {
          mod[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const apply = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
  };
  const penalty = () => {
    let p = 0, dark = 0;
    for (let a = 0; a < size; a++)
      for (const horiz of [true, false]) {
        let run = 0, prev = null;
        for (let b = 0; b < size; b++) {
          const c = horiz ? mod[a][b] : mod[b][a];
          if (c === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
          else { run = 1; prev = c; }
        }
      }
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (x < size - 1 && y < size - 1) {
          const c = mod[y][x];
          if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
        }
      }
    return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    apply(m); drawFormat(m);
    const p = penalty();
    if (p < bestP) { bestP = p; best = m; }
    apply(m);
  }
  apply(best); drawFormat(best);
  return mod;
}

function qrSvg(text) {
  const m = qrEncode(text);
  if (!m) return "";
  const n = m.length, q = 4;
  let path = "";
  m.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x + q} ${y + q}h1v1h-1z`; }));
  return `<svg viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" class="qrcode" role="img" aria-label="QR-Code" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/* Automatisch: kurze, druckbare Codes als Barcode, alles andere als QR-Code. */
function codeType(v) {
  if (v.code_type) return v.code_type;
  return code128(v.code) && v.code.length <= 30 ? "barcode" : "qr";
}
function codeBox(v) {
  const t = codeType(v);
  const img = t === "qr" ? qrSvg(v.code) : t === "barcode" ? barcodeSvg(v.code) : "";
  return `<div class="codebox ${t}">${img}<div class="codetext" style="--n:${v.code.length}">${esc(v.code)}</div></div>`;
}

/* ---------- Scanner (Kamera live oder Foto) ---------- */
const SCAN_BASE = "/gutscheine_static/scanner";
let zxingReady = null;
function loadZxing(version) {
  if (!zxingReady)
    zxingReady = new Promise((resolve, reject) => {
      if (window.ZXingWASM) return resolve(window.ZXingWASM);
      const s = document.createElement("script");
      s.src = `${SCAN_BASE}/zxing-reader.js?v=${version}`;
      s.onload = () => {
        window.ZXingWASM.setZXingModuleOverrides({
          locateFile: (p, prefix) => (p.endsWith(".wasm") ? `${SCAN_BASE}/zxing_reader.wasm?v=${version}` : prefix + p),
        });
        resolve(window.ZXingWASM);
      };
      s.onerror = () => { zxingReady = null; reject(new Error("Scanner konnte nicht geladen werden")); };
      document.head.appendChild(s);
    });
  return zxingReady;
}
async function decodeImage(input, version) {
  const z = await loadZxing(version);
  const res = await z.readBarcodes(input, { tryHarder: true, maxNumberOfSymbols: 1 });
  const hit = res.find((r) => r.isValid && r.text);
  return hit ? { text: hit.text, type: /QR|Aztec|DataMatrix|PDF417|Maxi/i.test(hit.format) ? "qr" : "barcode" } : null;
}
const canLiveScan = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

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
/* Ohne aufgedrucktes Ablaufdatum: gesetzliche Frist, 3 Jahre ab Ende des Ausstellungsjahres. */
const legalExpiry = (v) => !v.expires && !!v.issued;
const effExpiry = (v) => v.expires || (v.issued ? `${+v.issued.slice(0, 4) + 3}-12-31` : null);
const daysLeft = (v) => {
  const e = effExpiry(v);
  return e ? Math.round((new Date(e + "T00:00:00") - today()) / 864e5) : null;
};
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
  const d = daysLeft(v), e = fmtDate(effExpiry(v)), g = legalExpiry(v) ? "gesetzlich " : "";
  if (d === null) return "kein Ablaufdatum";
  if (v.redeemed) return `${g}bis ${e}`;
  if (d < 0) return `${g}abgelaufen am ${e}`;
  if (d === 0) return "läuft heute ab";
  if (d <= SOON) return `noch ${d} ${d === 1 ? "Tag" : "Tage"} (${g}bis ${e})`;
  return `${g}bis ${e}`;
}

const CAM_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 4h3l2-2h6l2 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10m0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/></svg>`;

const STYLE = `
:host{display:block;min-height:100vh;background:var(--primary-background-color);color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,Roboto,system-ui,sans-serif)}
header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;height:56px;padding:0 12px;background:var(--app-header-background-color,var(--primary-color));color:var(--app-header-text-color,#fff)}
header h1{flex:1;margin:0;font-size:20px;font-weight:400}
header button{color:inherit}
button{font:inherit;cursor:pointer;border:none;background:none;color:var(--primary-color);padding:8px 12px;border-radius:8px}
button.icon{padding:8px;display:inline-flex}
button.primary{background:var(--primary-color);color:var(--text-primary-color,#fff)}
button.danger{color:var(--error-color,#db4437)}
main{max-width:720px;margin:0 auto;padding:8px 16px 96px}
.search{max-width:720px;margin:0 auto;padding:12px 16px 0;box-sizing:border-box}
.search input{box-sizing:border-box;width:100%;font:inherit;padding:10px 14px;border-radius:24px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
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
.item.abgelaufen{background:rgba(219,68,55,.12);border-color:rgba(219,68,55,.5)}
.item.abgelaufen .sub{color:var(--error-color,#db4437)}
.item.bald{background:rgba(255,166,0,.14);border-color:rgba(255,166,0,.6)}
.item.eingeloest{opacity:.65}
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
.qrcode{width:min(260px,70vw);height:auto;display:block;margin:0 auto}
.codebox{container-type:inline-size}
.codetext{font-family:monospace;letter-spacing:.08em;margin-top:6px;white-space:nowrap;overflow-x:auto;font-size:min(18px,calc(100cqi / (var(--n) * .78)))}
.codebox.text .codetext{font-size:min(24px,calc(100cqi / (var(--n) * .78)));margin:0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;margin:12px 0}
.mono{font-family:monospace;font-size:16px;white-space:nowrap}
dt{color:var(--secondary-text-color)}dd{margin:0;word-break:break-word}
.actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px}
form label{display:block;margin:10px 0 0;font-size:13px;color:var(--secondary-text-color)}
form input,form textarea,form select{box-sizing:border-box;width:100%;font:inherit;padding:10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.hist{font-size:14px;color:var(--secondary-text-color)}
.codeinput{display:flex;gap:6px;align-items:center}
.codeinput input{flex:1;min-width:0}
.scanbtn{border:1px solid var(--divider-color);border-radius:8px;padding:8px}
.videobox{position:relative;background:#000;border-radius:12px;overflow:hidden;aspect-ratio:4/3;margin:12px 0}
.videobox video{width:100%;height:100%;object-fit:cover;display:block}
.videobox .frame{position:absolute;inset:18% 12%;border:3px solid rgba(255,255,255,.85);border-radius:12px;box-shadow:0 0 0 999px rgba(0,0,0,.25)}
.scanmsg{color:var(--secondary-text-color);min-height:1.4em}
.hint{font-size:12px;color:var(--secondary-text-color);margin-top:4px}
.err{color:var(--error-color,#db4437);margin-top:8px}
`;

class GutscheinePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.vouchers = [];
    this.owner = "alle";
    this.query = "";
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
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><header></header><div class="search"><input type="search" placeholder="Suchen: Geschäft, Code, Besitzer, Notiz …" aria-label="Suchen" autocomplete="off"></div><main></main>
      <button class="primary fab" id="add">+ Gutschein</button><dialog class="main"></dialog><dialog class="scan"></dialog>`;
    this._renderHeader();
    this.shadowRoot.getElementById("add").onclick = () => this._edit(null);
    this.shadowRoot.querySelector(".search input").addEventListener("input", (e) => {
      this.query = e.target.value;
      this._render();
    });
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
    // Zurück-Pfeil, wenn die App aus einem Dashboard geöffnet wurde (?back=/pfad), sonst Menü.
    const back = new URLSearchParams(location.search).get("back");
    this._back = back && back.startsWith("/") && !back.startsWith("//") ? back : null;
    const left = this._back
      ? '<button class="icon" id="back" aria-label="Zurück"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 11v2H8l5.5 5.5-1.42 1.42L4.16 12l7.92-7.92L13.5 5.5 8 11h12Z"/></svg></button>'
      : this._narrow ? '<button class="icon" id="menu" aria-label="Menü">☰</button>' : "";
    h.innerHTML = `${left}<h1>Gutscheine</h1>`;
    const m = h.querySelector("#menu");
    if (m) m.onclick = () => this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    const bk = h.querySelector("#back");
    if (bk)
      bk.onclick = () => {
        history.pushState(null, "", this._back);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      };
  }

  async _load() {
    const res = await this.hass.callWS({ type: "gutscheine/list" });
    this.vouchers = res.vouchers;
    this.loaded = true;
    this._render();
    if (this._openId) this._detail(this._openId, true);
  }

  _filtered() {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.vouchers.filter((v) => {
      if (this.owner !== "alle" && (v.owner || "–") !== this.owner) return false;
      if (!words.length) return true;
      const hay = [v.shop, v.owner, v.kind, v.note, v.code, v.pin, v.value, v.balance]
        .filter((x) => x !== null && x !== undefined)
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  _render() {
    const main = this.shadowRoot.querySelector("main");
    const list = this._filtered();
    const open = list.filter((v) => ["aktiv", "bald"].includes(status(v)));
    const total = open.reduce((s, v) => s + (v.balance || 0), 0);
    const soon = list.filter((v) => status(v) === "bald").length;
    const owners = [...new Set(this.vouchers.map((v) => v.owner || "–"))].sort();
    const byExpiry = (a, b) => (effExpiry(a) || "9999").localeCompare(effExpiry(b) || "9999") || a.shop.localeCompare(b.shop);
    const group = (st) => list.filter((v) => status(v) === st).sort(byExpiry);
    const byShop = (a, b) => a.shop.localeCompare(b.shop, "de", { sensitivity: "base" }) || byExpiry(a, b);
    const current = list.filter((v) => status(v) !== "eingeloest").sort(byShop);
    const old = group("eingeloest");

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
      ${!this.loaded ? "" : list.length === 0 ? (this.query ? '<div class="empty">Nichts gefunden.</div>' : '<div class="empty">Noch keine Gutscheine. Unten rechts anlegen.</div>') : ""}
      ${current.length ? `<div class="list">${current.map(item).join("")}</div>` : ""}
      ${old.length ? `<h2><button id="toggleOld">${this.showOld ? "▾" : "▸"} Eingelöst (${old.length})</button></h2>
        ${this.showOld || this.query ? `<div class="list">${old.map(item).join("")}</div>` : ""}` : ""}`;
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
    const d = this.shadowRoot.querySelector("dialog.main");
    d.innerHTML = `<div class="dlg">${html}</div>`;
    if (!d.open) d.showModal();
    d.onclose = () => (this._openId = null);
    return d;
  }

  _close() {
    const d = this.shadowRoot.querySelector("dialog.main");
    this._openId = null;
    if (d.open) d.close();
  }

  _detail(id, refresh = false) {
    const v = this.vouchers.find((x) => x.id === id);
    if (!v) return refresh ? this._close() : undefined;
    const d = this.shadowRoot.querySelector("dialog.main");
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
      ${v.code ? codeBox(v) : ""}
      <dl>
        ${v.value !== null && v.value !== v.balance ? `<dt>Ursprünglich</dt><dd>${eur(v.value)}</dd>` : ""}
        ${v.issued ? `<dt>Ausgestellt</dt><dd>${fmtDate(v.issued)}</dd>` : ""}
        ${legalExpiry(v) ? `<dt>Ablauf</dt><dd>gesetzliche Frist: 3 Jahre ab Ende ${v.issued.slice(0, 4)}</dd>` : ""}
        ${v.pin ? `<dt>PIN</dt><dd class="mono">${esc(v.pin)}</dd>` : ""}
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
          <label>Ausstelldatum<input name="issued" type="date" value="${val("issued")}"></label>
        </div>
        <div class="hint">Steht kein Ablaufdatum drauf, nur das Ausstelldatum eintragen: Dann gilt die gesetzliche Frist von 3 Jahren ab Ende des Ausstellungsjahres.</div>
        <label>Besitzer<input name="owner" list="owners" value="${val("owner")}"></label>
        <datalist id="owners">${owners.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>
        <label>Code / Kartennummer<span class="codeinput"><input name="code" value="${val("code")}" autocomplete="off"><button type="button" class="icon scanbtn" data-a="scan" title="Code scannen" aria-label="Code scannen">${CAM_ICON}</button></span></label>
        <div class="row">
          <label>Anzeige als<select name="code_type">
            ${[["", "Automatisch"], ["barcode", "Barcode"], ["qr", "QR-Code"], ["text", "Nur Text"]]
              .map(([k, l]) => `<option value="${k}" ${(v?.code_type || "") === k ? "selected" : ""}>${l}</option>`).join("")}
          </select></label>
          <label>PIN<input name="pin" value="${val("pin")}" autocomplete="off"></label>
        </div>
        <label>Art<input name="kind" value="${val("kind")}" placeholder="z. B. Eintrittskarte"></label>
        <label>Notiz<textarea name="note" rows="2">${val("note")}</textarea></label>
        <div class="err"></div>
        <div class="actions"><button type="button" data-a="cancel">Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
      </form>`);
    this._openId = null;
    const form = dlg.querySelector("form");
    form.querySelector("[data-a=scan]").onclick = () =>
      this._scan((hit) => {
        form.elements.code.value = hit.text;
        form.elements.code_type.value = hit.type;
      });
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
        issued: f.get("issued") || null,
        owner: f.get("owner") || null,
        code: String(f.get("code") || "").replace(/\s+/g, "") || null,
        code_type: f.get("code_type") || null,
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

GutscheinePanel.prototype._scan = function (onHit) {
  const version = this.panel?.config?.version || "0";
  const scan = this.shadowRoot.querySelector("dialog.scan");
  const msg = (t) => (scan.querySelector(".scanmsg").textContent = t);
  let stream = null, timer = null, done = false;
  const stop = () => {
    done = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (scan.open) scan.close();
  };
  const hit = (h) => { if (done) return; stop(); onHit(h); };
  scan.innerHTML = `<div class="dlg"><h3>Code scannen</h3>
    <div class="videobox"><video playsinline muted></video><div class="frame"></div></div>
    <div class="scanmsg">Kamera wird gestartet …</div>
    <input type="file" accept="image/*" capture="environment" hidden>
    <div class="actions"><button type="button" data-a="photo">Foto aufnehmen</button><button type="button" data-a="close">Abbrechen</button></div></div>`;
  scan.onclose = stop;
  scan.showModal();
  const file = scan.querySelector("input[type=file]");
  scan.querySelector("[data-a=close]").onclick = stop;
  scan.querySelector("[data-a=photo]").onclick = () => file.click();
  file.onchange = async () => {
    if (!file.files[0]) return;
    msg("Foto wird ausgewertet …");
    try {
      const h = await decodeImage(file.files[0], version);
      h ? hit(h) : msg("Kein Code erkannt. Bitte näher ran und scharf fotografieren.");
    } catch (e) { msg(e.message); }
    file.value = "";
  };
  const video = scan.querySelector("video");
  if (!canLiveScan()) {
    scan.querySelector(".videobox").hidden = true;
    msg("Live-Scan geht nur über HTTPS. Mach einfach ein Foto vom Code.");
    loadZxing(version).catch(() => {});
    return;
  }
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
      if (done) return stop();
      video.srcObject = stream;
      await video.play();
      msg("Code ins Bild halten");
      const native = "BarcodeDetector" in window ? new window.BarcodeDetector() : null;
      if (!native) await loadZxing(version);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const tick = async () => {
        if (done) return;
        try {
          if (video.videoWidth) {
            let h = null;
            if (native) {
              const r = await native.detect(video);
              if (r[0]) h = { text: r[0].rawValue, type: /qr|aztec|data_matrix|pdf417/.test(r[0].format) ? "qr" : "barcode" };
            } else {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              h = await decodeImage(ctx.getImageData(0, 0, canvas.width, canvas.height), version);
            }
            if (h) return hit(h);
          }
        } catch (e) { /* nächster Versuch */ }
        timer = setTimeout(tick, 250);
      };
      tick();
    } catch (e) {
      scan.querySelector(".videobox").hidden = true;
      msg("Kamera nicht verfügbar. Mach stattdessen ein Foto vom Code.");
    }
  })();
};

// Nach einem Update kann die alte Version im selben Browser-Tab schon registriert sein.
if (!customElements.get("gutscheine-panel")) customElements.define("gutscheine-panel", GutscheinePanel);
