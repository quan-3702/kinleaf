// Kinleaf – offline family tree maker. All data stays in this browser profile (IndexedDB).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Pro (Microsoft Store add-on via Digital Goods API) ----------
const FREE_PEOPLE = 20;
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'kinleaf_pro';
const PRO_IDS = [PRO_SKU];
let STORE_URL = 'https://apps.microsoft.com/detail/9NRR32J91340';
let proAvailable = false; // Pro limits apply only when the Store actually sells the add-on
try { if ('getDigitalGoodsService' in window && localStorage.getItem('kinleaf-proavail') === '1') proAvailable = true; } catch (_) {} // keep Pro limits when offline
let proSku = PRO_SKU;
let isPro = false;
try { isPro = localStorage.getItem('kinleaf-pro') === '1'; } catch (_) {}
const unlocked = () => isPro || !proAvailable;

async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}
function setPro(v) {
  isPro = v;
  try { localStorage.setItem('kinleaf-pro', v ? '1' : '0'); } catch (_) {}
  const b = $('proBtn');
  b.textContent = v ? '★ Pro' : '★ Get Pro';
  b.classList.toggle('is-pro', v);
  b.hidden = !proAvailable && !v;
  document.body.classList.toggle('unlocked', unlocked());
  renderList();
}
async function checkProAfterBuy() {
  for (let i = 0; i < 6; i++) {
    if (await checkPro()) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  proMessage('Thank you! If Pro is not unlocked within a minute, click “Restore purchase”.');
  return false;
}
async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    if (details.length) { proAvailable = true; try { localStorage.setItem('kinleaf-proavail', '1'); } catch (_) {} }
    if (details[0]) { proSku = details[0].itemId; if (!PRO_IDS.includes(proSku)) PRO_IDS.push(proSku); }
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    if (owned || details.length) { setPro(owned); return owned; }
    setPro(isPro); // Store did not answer (offline): keep what we knew
    return isPro;
  } catch (_) { return isPro; }
}
function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }
async function openPro(reason) {
  proMessage(reason || '');
  const svc = await billing();
  if (!svc) {
    $('buyBtn').textContent = 'Get Kinleaf on Microsoft Store';
    $('restoreBtn').hidden = true;
  } else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}
async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); }
    catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkProAfterBuy()) { proMessage('Thank you! Pro is unlocked. ★'); setTimeout(() => $('proDialog').close(), 1500); }
}
function needsPro(reason) {
  if (unlocked()) return false;
  openPro(reason);
  return true;
}

// ---------- data ----------
let tree = { title: '', people: {}, fams: {}, focus: null, rootFam: null };
let selected = null;
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const people = () => Object.values(tree.people);
const famsOf = (pid) => Object.values(tree.fams).filter((f) => f.a === pid || f.b === pid);
const parentFam = (pid) => Object.values(tree.fams).find((f) => f.children.includes(pid)) || null;
const spouseIn = (f, pid) => (f.a === pid ? f.b : f.a);
const fullName = (p) => (p ? [p.first, p.last].filter(Boolean).join(' ').trim() || '(no name yet)' : '');
const yearOf = (s) => { const m = /(\d{4})/.exec(s || ''); return m ? m[1] : ''; };
function lifespan(p) {
  const b = yearOf(p.birth), d = yearOf(p.death);
  if (b && (d || p.deceased)) return `${b} – ${d || '?'}`;
  if (b) return `b. ${b}`;
  if (d) return `d. ${d}`;
  return p.deceased ? 'deceased' : '';
}

// IndexedDB key-value store
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kinleaf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(k) { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function dbSet(k, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
let saveTimer = 0;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => dbSet('tree', tree).catch(() => toast('Could not save – your disk may be full')), 300); }

function newPerson(init) {
  const p = Object.assign({ id: uid('p'), first: '', last: '', sex: '', birth: '', place: '', death: '', deathPlace: '', deceased: false, notes: '', photo: '' }, init || {});
  tree.people[p.id] = p;
  return p;
}
function newFam(a, b, children) {
  const f = { id: uid('f'), a: a || null, b: b || null, children: children || [] };
  tree.fams[f.id] = f;
  return f;
}
function canAdd() {
  if (people().length >= FREE_PEOPLE && needsPro(`The free version holds up to ${FREE_PEOPLE} people. Unlock Pro to keep growing your tree.`)) return false;
  return true;
}
function setParent(childId, sex) {
  const child = tree.people[childId];
  let f = parentFam(childId);
  if (!f) f = newFam(null, null, [childId]);
  const slot = sex === 'm' ? 'a' : 'b';
  if (f[slot]) return null;
  const p = newPerson({ sex, last: sex === 'm' ? child.last : '' });
  f[slot] = p.id;
  return p;
}
function addSpouse(pid) {
  const me = tree.people[pid];
  const sp = newPerson({ sex: me.sex === 'm' ? 'f' : me.sex === 'f' ? 'm' : '' });
  // reuse a single-parent family (children already entered) if there is one
  const solo = famsOf(pid).find((f) => !spouseIn(f, pid));
  if (solo) { if (solo.a === pid) solo.b = sp.id; else solo.a = sp.id; } else if (me.sex === 'f') newFam(sp.id, pid); else newFam(pid, sp.id);
  return sp;
}
function addChild(pid, famId) {
  const me = tree.people[pid];
  let f = famId ? tree.fams[famId] : null;
  if (!f) f = me.sex === 'f' ? newFam(null, pid) : newFam(pid, null);
  const father = tree.people[f.a];
  const c = newPerson({ last: (father || me).last });
  f.children.push(c.id);
  return c;
}
function addSibling(pid) {
  let f = parentFam(pid);
  if (!f) f = newFam(null, null, [pid]);
  const c = newPerson({ last: tree.people[pid].last });
  f.children.push(c.id);
  return c;
}
function cleanup() {
  Object.values(tree.fams).forEach((f) => {
    if (!tree.people[f.a]) f.a = null;
    if (!tree.people[f.b]) f.b = null;
    f.children = f.children.filter((c) => tree.people[c]);
    const members = (f.a ? 1 : 0) + (f.b ? 1 : 0) + f.children.length;
    if (members < 2) delete tree.fams[f.id];
  });
  if (!tree.people[tree.focus]) tree.focus = people()[0] ? people()[0].id : null;
  if (!tree.people[selected]) selected = null;
}
function removePerson(pid) { delete tree.people[pid]; cleanup(); }

// ---------- layout ----------
const CW = 190, CH = 84, HG = 22, SG = 34, VG = 64, PAD = 40;
function rootOptions() {
  const out = [];
  const names = ['parents', 'grandparents', 'great-grandparents', 'great-great-grandparents'];
  const walk = (pid, depth, seen) => {
    const f = parentFam(pid);
    if (!f || depth >= names.length || seen.has(f.id)) return;
    seen.add(f.id);
    const couple = [f.a, f.b].filter(Boolean).map((id) => fullName(tree.people[id])).join(' & ') || 'Unknown parents';
    out.push({ fam: f.id, label: `${couple} (${names[depth]})` });
    [f.a, f.b].filter(Boolean).forEach((id) => walk(id, depth + 1, seen));
  };
  if (tree.focus) walk(tree.focus, 0, new Set());
  return out;
}
function downNode(pid, seen) {
  seen.add(pid);
  const me = tree.people[pid];
  const fs = famsOf(pid);
  const withSp = fs.filter((f) => spouseIn(f, pid) && !seen.has(spouseIn(f, pid)));
  withSp.forEach((f) => seen.add(spouseIn(f, pid)));
  let cards;
  if (withSp.length >= 2) cards = [spouseIn(withSp[0], pid), pid, ...withSp.slice(1).map((f) => spouseIn(f, pid))];
  else if (withSp.length === 1) { const s = spouseIn(withSp[0], pid); cards = me.sex === 'f' && tree.people[s].sex !== 'f' ? [s, pid] : [pid, s]; } else cards = [pid];
  const order = [...withSp.slice(0, 1), ...fs.filter((f) => !withSp.includes(f)), ...withSp.slice(1)];
  const groups = order.map((f) => ({ fam: f, sp: withSp.includes(f) ? spouseIn(f, pid) : null, kids: f.children.filter((c) => !seen.has(c)).map((c) => downNode(c, seen)) })).filter((g) => g.kids.length);
  return { pid, cards, groups };
}
function famNode(f, seen) {
  const cards = [f.a, f.b].filter(Boolean);
  cards.forEach((c) => seen.add(c));
  const pid = cards[0] || null;
  const kids = f.children.filter((c) => !seen.has(c)).map((c) => downNode(c, seen));
  return { pid, cards, groups: kids.length ? [{ fam: f, sp: cards[1] || null, kids }] : [] };
}
function measure(n) {
  n.unitW = n.cards.length ? n.cards.length * CW + (n.cards.length - 1) * HG : 0;
  const kids = n.groups.flatMap((g) => g.kids);
  kids.forEach(measure);
  n.kidsW = kids.reduce((s, k) => s + k.w, 0) + Math.max(0, kids.length - 1) * SG;
  n.w = Math.max(n.unitW, n.kidsW);
}
function assign(n, x, y, out) {
  const ux = x + (n.w - n.unitW) / 2;
  n.pos = {};
  n.cards.forEach((pid, i) => { n.pos[pid] = ux + i * (CW + HG); out.cards.push({ pid, x: n.pos[pid], y }); });
  for (let i = 0; i + 1 < n.cards.length; i++) out.lines.push([ux + i * (CW + HG) + CW, y + CH / 2, ux + (i + 1) * (CW + HG), y + CH / 2]);
  let kx = x + (n.w - n.kidsW) / 2;
  n.groups.forEach((g, gi) => {
    const busY = y + CH + VG / 2 + (gi % 3) * 7 - 7;
    let ox = null, oy = y + CH;
    if (n.pid != null) {
      const i = n.cards.indexOf(n.pid), j = g.sp ? n.cards.indexOf(g.sp) : -1;
      if (j >= 0 && Math.abs(i - j) === 1) { ox = (n.pos[n.pid] + n.pos[g.sp]) / 2 + CW / 2; oy = y + CH / 2; } else ox = (j >= 0 ? n.pos[g.sp] : n.pos[n.pid]) + CW / 2;
    }
    const xs = [];
    g.kids.forEach((k) => {
      assign(k, kx, y + CH + VG, out);
      const cx = k.pos[k.pid] + CW / 2;
      xs.push(cx);
      out.lines.push([cx, busY, cx, y + CH + VG]);
      kx += k.w + SG;
    });
    if (ox != null) { out.lines.push([ox, oy, ox, busY]); xs.push(ox); }
    out.lines.push([Math.min(...xs), busY, Math.max(...xs), busY]);
  });
}
function upBlock(f, depth, seen) {
  seen.add(f.id);
  const cards = [f.a, f.b].filter(Boolean);
  const ups = [];
  if (depth < 6) cards.forEach((pid) => { const g = parentFam(pid); if (g && !seen.has(g.id) && (g.a || g.b)) ups.push({ pid, block: upBlock(g, depth + 1, seen) }); });
  const unitW = cards.length * CW + (cards.length - 1) * HG;
  const upsW = ups.reduce((s, u) => s + u.block.w, 0) + Math.max(0, ups.length - 1) * SG;
  return { cards, ups, unitW, upsW, w: Math.max(unitW, upsW) };
}
function placeUps(ups, upsW, centerX, y, childX, out) {
  // ups: [{pid, block}], drawn one row above y; childX(pid) gives the child's card x
  let bx = centerX - upsW / 2;
  ups.forEach((u) => {
    const b = u.block, by = y - CH - VG;
    const ux = bx + (b.w - b.unitW) / 2;
    const pos = {};
    b.cards.forEach((pid, i) => { pos[pid] = ux + i * (CW + HG); out.cards.push({ pid, x: pos[pid], y: by }); });
    if (b.cards.length === 2) out.lines.push([ux + CW, by + CH / 2, ux + CW + HG, by + CH / 2]);
    const gx = ux + b.unitW / 2, gy = b.cards.length === 2 ? by + CH / 2 : by + CH;
    const cx = childX(u.pid) + CW / 2, midY = y - VG / 2;
    out.lines.push([cx, y, cx, midY], [Math.min(cx, gx), midY, Math.max(cx, gx), midY], [gx, midY, gx, gy]);
    placeUps(b.ups, b.upsW, bx + b.w / 2, by, (pid) => pos[pid], out);
    bx += b.w + SG;
  });
}
function layout() {
  const out = { cards: [], lines: [], w: 0, h: 0 };
  if (!tree.focus || !tree.people[tree.focus]) return out;
  const opts = rootOptions();
  if (tree.rootFam !== 'self' && tree.rootFam !== 'hour' && !opts.some((o) => o.fam === tree.rootFam)) tree.rootFam = opts[0] ? opts[0].fam : 'self';
  const seen = new Set();
  const hour = tree.rootFam === 'hour';
  const rootF = tree.rootFam !== 'self' && !hour ? tree.fams[tree.rootFam] : null;
  const root = rootF ? famNode(rootF, seen) : downNode(tree.focus, seen);
  measure(root);
  assign(root, 0, 0, out);
  if (rootF || hour) {
    const fseen = new Set(rootF ? [rootF.id] : []);
    const ups = [];
    root.cards.forEach((pid) => { const g = parentFam(pid); if (g && (g.a || g.b)) ups.push({ pid, block: upBlock(g, 1, fseen) }); });
    const upsW = ups.reduce((s, u) => s + u.block.w, 0) + Math.max(0, ups.length - 1) * SG;
    const unitX = (root.w - root.unitW) / 2;
    placeUps(ups, upsW, unitX + root.unitW / 2, 0, (pid) => root.pos[pid], out);
  }
  const minX = Math.min(...out.cards.map((c) => c.x)), minY = Math.min(...out.cards.map((c) => c.y));
  const dx = PAD - minX, dy = PAD - minY;
  out.cards.forEach((c) => { c.x += dx; c.y += dy; });
  out.lines = out.lines.map((l) => [l[0] + dx, l[1] + dy, l[2] + dx, l[3] + dy]);
  out.w = Math.max(...out.cards.map((c) => c.x)) + CW + PAD;
  out.h = Math.max(...out.cards.map((c) => c.y)) + CH + PAD;
  // people with relatives that this view does not show
  const shown = new Set(out.cards.map((c) => c.pid));
  out.cards.forEach((c) => {
    const pf = parentFam(c.pid);
    const rel = [...(pf ? [pf.a, pf.b, ...pf.children] : []), ...famsOf(c.pid).flatMap((f) => [f.a, f.b, ...f.children])].filter(Boolean);
    c.more = rel.some((id) => !shown.has(id));
  });
  return out;
}

// ---------- drawing ----------
const THEME = {
  light: { bg: '#f4f6f2', card: '#ffffff', text: '#1a1f1b', muted: '#5f6b62', line: '#8a968c', m: '#3b82c4', f: '#c8548c', u: '#8a968c', sel: '#166534', selBg: '#e3f2e6' },
  dark: { bg: '#121613', card: '#1b211c', text: '#e9efe9', muted: '#9aa79d', line: '#6b776d', m: '#60a5fa', f: '#f472b6', u: '#6b776d', sel: '#4ade80', selBg: '#17301f' },
};
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
function svgBody(L, th, forExport) {
  let s = '';
  L.lines.forEach((l) => { s += `<line x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}" stroke="${th.line}" stroke-width="2" stroke-linecap="round"/>`; });
  L.cards.forEach((c) => {
    const p = tree.people[c.pid];
    const col = p.sex === 'm' ? th.m : p.sex === 'f' ? th.f : th.u;
    const isSel = !forExport && c.pid === selected;
    const first = clip(p.first || (p.last ? '' : '(no name yet)'), 15), last = clip(p.last || '', 15);
    const cx = c.x + 38, cy = c.y + CH / 2;
    s += `<g class="p" data-id="${esc(c.pid)}">`;
    s += `<rect x="${c.x}" y="${c.y}" width="${CW}" height="${CH}" rx="12" fill="${isSel ? th.selBg : th.card}" stroke="${isSel ? th.sel : col}" stroke-width="${isSel ? 4 : 2}"/>`;
    if (p.photo) s += `<clipPath id="cp${esc(c.pid)}"><circle cx="${cx}" cy="${cy}" r="27"/></clipPath><image href="${esc(p.photo)}" x="${cx - 27}" y="${cy - 27}" width="54" height="54" preserveAspectRatio="xMidYMid slice" clip-path="url(#cp${esc(c.pid)})"/><circle cx="${cx}" cy="${cy}" r="27" fill="none" stroke="${col}" stroke-width="2"/>`;
    else s += `<circle cx="${cx}" cy="${cy}" r="27" fill="${col}" opacity=".18"/><text x="${cx}" y="${cy + 7}" text-anchor="middle" font-size="20" font-weight="700" fill="${col}">${esc(((p.first || '?')[0] + ((p.last || '')[0] || '')).toUpperCase())}</text>`;
    const tx = c.x + 74;
    const span = lifespan(p);
    const rows = [first && [first, 15, 700, th.text], last && [last, 15, 700, th.text], span && [span, 13, 400, th.muted]].filter(Boolean);
    const y0 = cy - (rows.length - 1) * 9 + 5;
    rows.forEach((r, i) => { s += `<text x="${tx}" y="${y0 + i * 18}" font-size="${r[1]}" font-weight="${r[2]}" fill="${r[3]}">${esc(r[0])}</text>`; });
    if (c.more && !forExport) s += `<g><title>Has more relatives that are not shown here. Click, then choose “Show this person's family”.</title><circle cx="${c.x + CW - 14}" cy="${c.y + 14}" r="9" fill="${th.sel}"/><text x="${c.x + CW - 14}" y="${c.y + 19}" text-anchor="middle" font-size="14" font-weight="700" fill="${th.card}">+</text></g>`;
    s += '</g>';
  });
  return s;
}
// ---------- fan chart (ancestors of one person) ----------
const FAN_R0 = 86, FAN_IN = 92, FAN_OUT = 128;
const fanRad = (g) => (g === 0 ? FAN_R0 : g <= 3 ? FAN_R0 + g * FAN_IN : FAN_R0 + 3 * FAN_IN + (g - 3) * FAN_OUT);
function fanSlots(root, gens) {
  const out = [[root]];
  for (let g = 1; g <= gens; g++) {
    const row = [];
    out[g - 1].forEach((pid) => { const f = pid ? parentFam(pid) : null; row.push(f ? f.a : null, f ? f.b : null); });
    out.push(row);
  }
  return out;
}
function fanLayout() {
  const root = tree.people[tree.focus] ? tree.focus : (people()[0] || {}).id;
  const gens = tree.fanGen || 5;
  const R = fanRad(gens), pad = 30;
  const L = { fan: true, root, gens, slots: root ? fanSlots(root, gens) : [], w: R * 2 + pad * 2, h: R + FAN_R0 * 0.55 + pad * 2, cx: R + pad, cy: R + pad, cards: [] };
  L.slots.forEach((row) => row.forEach((pid) => pid && L.cards.push({ pid })));
  return L;
}
const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
const f1 = (n) => Math.round(n * 10) / 10;
function fanFill(g, k, p, th) {
  if (!p) return th.card;
  const dark = th === THEME.dark;
  if (g === 0) return dark ? '#24402c' : '#d9efdf';
  const hues = [205, 172, 330, 32];
  const br = g === 1 ? k * 2 : Math.floor(k / Math.pow(2, g - 2));
  const L = dark ? Math.min(34, 20 + g * 2) : Math.min(93, 76 + g * 3);
  return `hsl(${hues[br]} ${dark ? 35 : 55}% ${L}%)`;
}
function fanBody(L, th, forExport) {
  if (!L.root) return '';
  const { cx, cy } = L;
  let s = '', defs = '';
  for (let g = 1; g <= L.gens; g++) {
    const r0 = fanRad(g - 1), r1 = fanRad(g), n = Math.pow(2, g), rm = (r0 + r1) / 2;
    L.slots[g].forEach((pid, k) => {
      const a0 = Math.PI + Math.PI * k / n, a1 = Math.PI + Math.PI * (k + 1) / n;
      const [x0, y0] = polar(cx, cy, r1, a0), [x1, y1] = polar(cx, cy, r1, a1), [x2, y2] = polar(cx, cy, r0, a1), [x3, y3] = polar(cx, cy, r0, a0);
      const p = pid ? tree.people[pid] : null;
      const isSel = !forExport && pid && pid === selected;
      const d = `M${f1(x0)},${f1(y0)} A${r1},${r1} 0 0 1 ${f1(x1)},${f1(y1)} L${f1(x2)},${f1(y2)} A${r0},${r0} 0 0 0 ${f1(x3)},${f1(y3)} Z`;
      s += `<g${p ? ` class="p" data-id="${esc(pid)}"` : ''}><path d="${d}" fill="${fanFill(g, k, p, th)}" stroke="${isSel ? th.sel : p ? th.bg : th.line}" stroke-width="${isSel ? 4 : p ? 2 : 1}"${p ? '' : ' stroke-dasharray="4 4" opacity=".55"'}/>`;
      if (p) {
        const name = fullName(p), span = lifespan(p);
        const arcLen = rm * Math.PI / n;
        if (g <= 3) {
          // writing along the arc
          const fs = g === 1 ? 17 : g === 2 ? 15 : 13;
          const maxCh = Math.floor((arcLen - 14) / (fs * 0.56));
          const rows = [];
          if (g === 3 && name.length > maxCh && p.first && p.last) rows.push(clip(p.first, maxCh), clip(p.last, maxCh));
          else rows.push(clip(name, maxCh));
          if (span) rows.push(span);
          rows.forEach((txt, i) => {
            const rr = rm + ((rows.length - 1) / 2 - i) * (fs + 4) - fs * 0.35;
            const [ax, ay] = polar(cx, cy, rr, a0 + 0.004), [bx, by] = polar(cx, cy, rr, a1 - 0.004);
            const id = `fa${g}_${k}_${i}`;
            defs += `<path id="${id}" d="M${f1(ax)},${f1(ay)} A${f1(rr)},${f1(rr)} 0 0 1 ${f1(bx)},${f1(by)}"/>`;
            const isSpan = txt === span && i === rows.length - 1;
            s += `<text font-size="${isSpan ? fs - 3 : fs}" font-weight="${isSpan ? 400 : 700}" fill="${isSpan ? th.muted : th.text}" text-anchor="middle"><textPath href="#${id}" startOffset="50%">${esc(txt)}</textPath></text>`;
          });
        } else {
          // writing outwards along the radius
          const am = (a0 + a1) / 2, deg = am * 180 / Math.PI;
          const flip = am < Math.PI * 1.5;
          const fs = Math.max(8, Math.min(13, arcLen * 0.36));
          const maxCh = Math.floor((r1 - r0 - 12) / (fs * 0.56));
          const rows = arcLen > fs * 2.6 ? [clip(name, maxCh), span].filter(Boolean) : [clip(name + (span ? ' ' + span : ''), maxCh)];
          const [tx, ty] = polar(cx, cy, rm, am);
          s += `<g transform="translate(${f1(tx)},${f1(ty)}) rotate(${f1(flip ? deg + 180 : deg)})">`;
          rows.forEach((txt, i) => {
            const yy = ((i - (rows.length - 1) / 2) * (fs + 2)) + fs * 0.35;
            const isSpan = i === 1;
            s += `<text x="0" y="${f1(yy)}" text-anchor="middle" font-size="${isSpan ? fs - 1.5 : fs}" font-weight="${isSpan ? 400 : 700}" fill="${isSpan ? th.muted : th.text}">${esc(txt)}</text>`;
          });
          s += '</g>';
        }
      }
      s += '</g>';
    });
  }
  // the person in the middle
  const p = tree.people[L.root];
  const isSel = !forExport && L.root === selected;
  const r = FAN_R0;
  s += `<g class="p" data-id="${esc(L.root)}"><path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy} Z" fill="${fanFill(0, 0, p, th)}" stroke="${isSel ? th.sel : th.bg}" stroke-width="${isSel ? 4 : 2}"/>`;
  if (p.photo) s += `<clipPath id="fanc"><circle cx="${cx}" cy="${cy - r + 34}" r="24"/></clipPath><image href="${esc(p.photo)}" x="${cx - 24}" y="${cy - r + 10}" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#fanc)"/>`;
  const ty = p.photo ? cy - 16 : cy - 36; // with a photo there is room for one line of name above the dates
  (p.photo ? [clip(fullName(p), 18)] : [p.first, p.last].filter(Boolean).map((t) => clip(t, 16))).forEach((t, i) => { s += `<text x="${cx}" y="${ty + i * 19}" text-anchor="middle" font-size="16" font-weight="700" fill="${th.text}">${esc(t)}</text>`; });
  const span = lifespan(p);
  if (span) s += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="12" fill="${th.muted}">${esc(span)}</text>`;
  s += '</g>';
  // generation labels under the fan
  return `<defs>${defs}</defs>` + s;
}
const isFan = () => tree.chart === 'fan';
let view = { x: 0, y: 0, k: 1 };
let lastLayout = null;
const themeNow = () => (matchMedia('(prefers-color-scheme: dark)').matches ? THEME.dark : THEME.light);
function applyView() { const g = $('svg').querySelector('#vp'); if (g) g.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); }
function fit() {
  if (!lastLayout || !lastLayout.cards.length) return;
  const r = $('svg').getBoundingClientRect();
  const k = Math.min(1.25, r.width / lastLayout.w, r.height / lastLayout.h);
  view = { k, x: (r.width - lastLayout.w * k) / 2, y: (r.height - lastLayout.h * k) / 2 };
  applyView();
}
function drawTree(refit) {
  const L = lastLayout = isFan() ? fanLayout() : layout();
  $('svg').innerHTML = `<g id="vp" font-family="Segoe UI, system-ui, sans-serif">${isFan() ? fanBody(L, themeNow(), false) : svgBody(L, themeNow(), false)}</g>`;
  $('chartSel').value = isFan() ? 'fan' : 'tree';
  $('rootLab').hidden = isFan();
  $('genLab').hidden = !isFan();
  $('fanGen').value = String(tree.fanGen || 5);
  if (refit) fit(); else applyView();
  const sel = $('rootSel');
  const opts = rootOptions();
  const me = tree.people[tree.focus];
  sel.innerHTML = opts.map((o) => `<option value="${esc(o.fam)}">${esc(o.label)}</option>`).join('') + (me ? `<option value="hour">${esc(fullName(me))} – ancestors and descendants</option><option value="self">${esc(fullName(me))} – descendants only</option>` : '');
  sel.value = tree.rootFam || 'self';
  $('stageHint').hidden = !L.cards.length;
}
function exportSvg() {
  const L = isFan() ? fanLayout() : layout();
  const th = THEME.light;
  const title = tree.title.trim();
  const top = title ? 56 : 0;
  const w = L.w, h = L.h + top;
  const body = `<rect width="${w}" height="${h}" fill="#ffffff"/>` + (title ? `<text x="${w / 2}" y="44" text-anchor="middle" font-size="30" font-weight="700" fill="${th.text}">${esc(title)}</text>` : '') + `<g transform="translate(0,${top})">${isFan() ? fanBody(L, th, true) : svgBody(L, th, true)}</g>`;
  return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Segoe UI, system-ui, sans-serif">${body}</svg>` };
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast(`Saved ${name} to your Downloads folder`);
}
const fileBase = () => (tree.title.trim() || 'family-tree').replace(/[\\/:*?"<>|]+/g, ' ').trim();
async function savePicture(maxSide) {
  if (!people().length) return;
  const e = exportSvg();
  const scale = Math.max(0.5, Math.min(4, maxSide / Math.max(e.w, e.h)));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([e.svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = Math.round(e.w * scale); c.height = Math.round(e.h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => download(b, `${fileBase()}.png`), 'image/png');
}
function printTree() {
  if (!people().length) return;
  // own ids for the printed copy: the same ids on screen are inside a hidden svg, so photos would lose their round clip
  $('printArea').innerHTML = exportSvg().svg.replace(/ width="[\d.]+" height="[\d.]+"/, '').replace(/id="([^"]+)"/g, 'id="$1_pr"').replace(/url\(#([^)]+)\)/g, 'url(#$1_pr)').replace(/href="#([^"]+)"/g, 'href="#$1_pr"');
  window.print();
}


// ---------- wall poster ----------
const POSTER_STYLES = {
  classic: { name: 'Classic parchment', bg1: '#f7efdc', bg2: '#e6d5b1', frame: '#7c5a2e', title: '#4a3216', sub: '#7c5a2e', font: "Georgia, 'Times New Roman', serif", deco: 'flourish', tree: '#7c5a2e',
    th: { bg: '#f7efdc', card: '#fffaf0', text: '#3b2a14', muted: '#7c6a4f', line: '#a68a5b', m: '#4f7aa6', f: '#b0607e', u: '#a68a5b', sel: '#7c5a2e', selBg: '#fffaf0' } },
  botanical: { name: 'Botanical green', bg1: '#f8faf3', bg2: '#e9f0df', frame: '#4d7c0f', title: '#14532d', sub: '#4d7c0f', font: 'Georgia, serif', deco: 'leaves', tree: '#4d7c0f',
    th: { bg: '#f8faf3', card: '#ffffff', text: '#1a2e1a', muted: '#5f6b55', line: '#86a372', m: '#3b82c4', f: '#c8548c', u: '#86a372', sel: '#166534', selBg: '#ffffff' } },
  modern: { name: 'Modern white', bg1: '#ffffff', bg2: '#ffffff', frame: '#1f2937', title: '#111827', sub: '#6b7280', font: "'Segoe UI', system-ui, sans-serif", deco: 'line', tree: null,
    th: { bg: '#ffffff', card: '#ffffff', text: '#111827', muted: '#6b7280', line: '#9ca3af', m: '#2563eb', f: '#db2777', u: '#9ca3af', sel: '#111827', selBg: '#ffffff' } },
  heritage: { name: 'Heritage navy & gold', bg1: '#16244a', bg2: '#0b1530', frame: '#d4a017', title: '#f5d77a', sub: '#e5c869', font: 'Georgia, serif', deco: 'flourish', tree: '#d4a017',
    th: { bg: '#16244a', card: '#1e3061', text: '#f8f1dc', muted: '#cbbd8f', line: '#b8973d', m: '#8fbcf0', f: '#f2a7c7', u: '#b8973d', sel: '#d4a017', selBg: '#1e3061' } },
};
const POSTER_SIZES = { '18x24': ['18 × 24 in', 18, 24], '24x36': ['24 × 36 in', 24, 36], '16x20': ['16 × 20 in', 16, 20], '12x18': ['12 × 18 in', 12, 18], '11x17': ['11 × 17 in (Tabloid)', 11, 17], a1: ['A1 – 594 × 841 mm', 23.39, 33.11], a2: ['A2 – 420 × 594 mm', 16.54, 23.39], a3: ['A3 – 297 × 420 mm', 11.69, 16.54], letter: ['Letter – one sheet', 8.5, 11], a4: ['A4 – one sheet', 8.27, 11.69] };
const posterOpts = () => {
  const lastNames = people().map((p) => p.last).filter(Boolean);
  const common = lastNames.sort((a, b) => lastNames.filter((x) => x === b).length - lastNames.filter((x) => x === a).length)[0];
  tree.poster = Object.assign({ style: 'classic', title: tree.title.trim() || (common ? `The ${common} Family` : 'Our Family Tree'), sub: '', size: '18x24', orient: 'auto', paper: 'letter' }, tree.poster || {});
  return tree.poster;
};
function posterGeom(o, L) {
  const [, wi, hi] = POSTER_SIZES[o.size] || POSTER_SIZES['18x24'];
  const land = o.orient === 'land' || (o.orient === 'auto' && L.w > L.h * 1.15);
  return land ? [hi, wi] : [wi, hi];
}
function flourish(cx, y, w, c) {
  const h = w * 0.06;
  return `<g fill="none" stroke="${c}" stroke-width="${w * 0.006}" stroke-linecap="round"><path d="M${cx - w / 2},${y} C${cx - w * 0.3},${y - h} ${cx - w * 0.15},${y + h} ${cx - w * 0.04},${y}"/><path d="M${cx + w / 2},${y} C${cx + w * 0.3},${y - h} ${cx + w * 0.15},${y + h} ${cx + w * 0.04},${y}"/></g><path d="M${cx},${y - w * 0.03} L${cx + w * 0.03},${y} L${cx},${y + w * 0.03} L${cx - w * 0.03},${y}Z" fill="${c}"/>`;
}
function leafSprig(x, y, len, rot, c) {
  let s = `<g transform="translate(${x},${y}) rotate(${rot})" opacity=".85"><path d="M0,0 Q${len * 0.12},${len * 0.5} 0,${len}" stroke="${c}" stroke-width="${len * 0.02}" fill="none"/>`;
  for (let k = 1; k <= 7; k++) { const yy = len * k / 8, sd = k % 2 ? 1 : -1; s += `<ellipse cx="${sd * len * 0.1}" cy="${yy}" rx="${len * 0.09}" ry="${len * 0.04}" transform="rotate(${sd * 35} ${sd * len * 0.1} ${yy})" fill="${c}"/>`; }
  return s + '</g>';
}
function bigTree(cx, by, h, c) { // a soft tree silhouette behind the chart
  const tw = h * 0.06;
  let s = `<g fill="${c}" opacity=".07"><path d="M${cx - tw},${by} C${cx - tw * 0.6},${by - h * 0.25} ${cx - tw * 0.4},${by - h * 0.45} ${cx},${by - h * 0.55} C${cx + tw * 0.4},${by - h * 0.45} ${cx + tw * 0.6},${by - h * 0.25} ${cx + tw},${by}Z"/>`;
  [[0, 0.72, 0.3], [-0.24, 0.62, 0.22], [0.24, 0.62, 0.22], [-0.16, 0.82, 0.2], [0.16, 0.82, 0.2], [0, 0.9, 0.17], [-0.34, 0.5, 0.15], [0.34, 0.5, 0.15]].forEach(([dx, dy, r]) => { s += `<circle cx="${cx + dx * h}" cy="${by - dy * h}" r="${r * h}"/>`; });
  return s + '</g>';
}
function posterSvg() {
  const o = posterOpts(), st = POSTER_STYLES[o.style] || POSTER_STYLES.classic;
  const L = isFan() ? fanLayout() : layout();
  const [wi, hi] = posterGeom(o, L), W = wi * 72, H = hi * 72, u = Math.min(W, H);
  const m = u * 0.045;
  let b = `<defs><linearGradient id="pbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${st.bg1}"/><stop offset="1" stop-color="${st.bg2}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#pbg)"/>`;
  b += `<rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="${st.frame}" stroke-width="${u * 0.006}"/>`;
  if (st.deco !== 'line') b += `<rect x="${m * 1.35}" y="${m * 1.35}" width="${W - 2.7 * m}" height="${H - 2.7 * m}" fill="none" stroke="${st.frame}" stroke-width="${u * 0.0018}"/>`;
  const tfs = u * 0.062, sfs = u * 0.024, ty = m * 2.2 + tfs;
  const title = o.title.trim(), sub = o.sub.trim();
  const tsize = Math.min(tfs, (W - 5 * m) / Math.max(1, title.length * 0.55));
  if (title) b += `<text x="${W / 2}" y="${ty}" text-anchor="middle" font-family="${st.font}" font-size="${tsize}" font-weight="700" fill="${st.title}">${esc(title)}</text>`;
  let yy = ty + tfs * 0.45;
  if (st.deco === 'flourish' || st.deco === 'leaves') { b += flourish(W / 2, yy + u * 0.012, u * 0.34, st.frame); yy += u * 0.04; }
  else { b += `<line x1="${W / 2 - u * 0.12}" y1="${yy + u * 0.01}" x2="${W / 2 + u * 0.12}" y2="${yy + u * 0.01}" stroke="${st.frame}" stroke-width="${u * 0.003}"/>`; yy += u * 0.03; }
  if (sub) { b += `<text x="${W / 2}" y="${yy + sfs}" text-anchor="middle" font-family="${st.font}" font-size="${sfs}" font-style="italic" fill="${st.sub}">${esc(sub)}</text>`; yy += sfs * 1.6; }
  if (st.deco === 'leaves') b += leafSprig(m * 1.6, m * 1.6, u * 0.16, -40, st.frame) + leafSprig(W - m * 1.6, m * 1.6, u * 0.16, 40, st.frame) + leafSprig(m * 1.6, H - m * 1.6, u * 0.14, 220, st.frame) + leafSprig(W - m * 1.6, H - m * 1.6, u * 0.14, 140, st.frame);
  const ax = m * 2.2, ay = yy + m * 0.6, aw = W - 4.4 * m, ah = H - ay - m * 2.2;
  if (st.tree && !isFan()) b += bigTree(W / 2, ay + ah, ah * 0.98, st.tree);
  if (L.w && L.h) {
    const k = Math.min(aw / L.w, ah / L.h), ox = ax + (aw - L.w * k) / 2, oy = ay + (ah - L.h * k) / 2;
    b += `<g transform="translate(${ox.toFixed(2)},${oy.toFixed(2)}) scale(${k.toFixed(4)})" font-family="Segoe UI, system-ui, sans-serif">${isFan() ? fanBody(L, st.th, true) : svgBody(L, st.th, true)}</g>`;
  }
  return { w: W, h: H, wi, hi, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${b}</svg>` };
}
function renderPoster() {
  const o = posterOpts();
  $('poStyle').value = o.style; $('poSize').value = o.size; $('poOrient').value = o.orient; $('poPaper').value = o.paper;
  if (document.activeElement !== $('poTitle')) $('poTitle').value = o.title;
  if (document.activeElement !== $('poSub')) $('poSub').value = o.sub;
  const p = posterSvg();
  $('poPreview').innerHTML = p.svg.replace(/ width="[\d.]+" height="[\d.]+"/, ' preserveAspectRatio="xMidYMid meet"');
  const single = o.size === 'letter' || o.size === 'a4';
  const t = tiles(p, o);
  $('poPrintBtn').textContent = single ? '🖨 Print' : `🖨 Print on ${t.length} ${o.paper === 'a4' ? 'A4' : 'Letter'} sheets`;
  $('poPaperRow').hidden = single;
  $('poInfo').textContent = `${(POSTER_SIZES[o.size] || POSTER_SIZES['18x24'])[0]}, ${p.wi > p.hi ? 'landscape' : 'portrait'}` + (single ? '' : ` · or save the poster file and print it at a copy or photo shop`);
}
function tiles(p, o) { // pieces of the poster for a home printer, with a small overlap for taping
  const [pw, ph] = o.paper === 'a4' ? [8.27, 11.69] : [8.5, 11];
  const mg = 0.35, ov = 0.25, tw = pw - 2 * mg, th = ph - 2 * mg;
  const cols = Math.max(1, Math.ceil((p.wi - ov) / (tw - ov))), rows = Math.max(1, Math.ceil((p.hi - ov) / (th - ov)));
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ r, c, x: c * (tw - ov), y: r * (th - ov), tw, th, pw, ph, mg, rows, cols });
  return out;
}
function posterPrint() {
  if (needsPro('Printing and saving wall posters is part of Pro. You can design and preview your poster for free.')) return;
  const o = posterOpts(), p = posterSvg(), inner = p.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  let pages, size;
  if (o.size === 'letter' || o.size === 'a4') {
    size = `${o.size === 'a4' ? 'A4' : 'letter'} ${p.wi > p.hi ? 'landscape' : 'portrait'}`;
    pages = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${p.w} ${p.h}" style="width:${p.wi}in;height:${p.hi}in;display:block">${inner}</svg>`];
  } else {
    const T = tiles(p, o);
    size = `${o.paper === 'a4' ? 'A4' : 'letter'} portrait`;
    pages = T.map((t) => {
      const X = t.x * 72, Y = t.y * 72, w = t.tw * 72, h = t.th * 72, mk = 14;
      const marks = `<g stroke="#999" stroke-width=".6"><path d="M${X},${Y - mk} V${Y} H${X - mk}"/><path d="M${X + w},${Y - mk} V${Y} H${X + w + mk}"/><path d="M${X},${Y + h + mk} V${Y + h} H${X - mk}"/><path d="M${X + w},${Y + h + mk} V${Y + h} H${X + w + mk}"/></g>`;
      const label = `<text x="${X + 4}" y="${Y + h + 16}" font-size="8" fill="#888" font-family="Segoe UI, sans-serif">Row ${t.r + 1} of ${t.rows} · Column ${t.c + 1} of ${t.cols} – overlap ¼ in with the next sheet</text>`;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X - t.mg * 72} ${Y - t.mg * 72} ${t.pw * 72} ${t.ph * 72}" style="width:${t.pw}in;height:${t.ph}in;display:block;page-break-after:always">${inner.replace(/id="pbg"/g, 'id="pbg"')}${marks}${label}</svg>`;
    });
  }
  // every printed page gets its own ids: the preview in the closed dialog has the same ids, and hidden gradients and clip paths are not drawn
  pages = pages.map((pg, i) => pg.replace(/id="([^"]+)"/g, `id="$1_p${i}"`).replace(/url\(#([^)]+)\)/g, `url(#$1_p${i})`));
  $('pageRule').textContent = `@page { size: ${size}; margin: 0; } @media print { #printArea svg { max-height: none !important; width: auto !important; } }`;
  $('printArea').innerHTML = pages.join('');
  window.print();
  setTimeout(() => { $('pageRule').textContent = ''; }, 1000);
}
async function posterSave() {
  if (needsPro('Printing and saving wall posters is part of Pro. You can design and preview your poster for free.')) return;
  const p = posterSvg();
  const dpi = Math.min(300, Math.floor(Math.sqrt(40e6 / (p.wi * p.hi))));
  toast('Making your poster file…');
  const img = new Image(), url = URL.createObjectURL(new Blob([p.svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = Math.round(p.wi * dpi); c.height = Math.round(p.hi * dpi);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const o = posterOpts();
  c.toBlob((bl) => { download(bl, `${fileBase()}-poster-${o.size}.jpg`); toast(`Saved a ${(POSTER_SIZES[o.size] || [''])[0]} poster file (${c.width} × ${c.height} px, ${dpi} dpi). Upload it to a copy or photo shop to print.`); }, 'image/jpeg', 0.92);
}
function openPoster() {
  if (!people().length) { toast('Add some people to your tree first'); return; }
  renderPoster();
  if (!$('posterDlg').open) $('posterDlg').showModal();
}

// ---------- people list ----------
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('peopleList');
  ul.textContent = '';
  people().filter((p) => !q || fullName(p).toLowerCase().includes(q))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .forEach((p) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.innerHTML = `${esc(fullName(p))} <small>${esc(lifespan(p))}</small>`;
      if (p.id === selected) b.className = 'on';
      b.onclick = () => select(p.id, true);
      li.append(b);
      ul.append(li);
    });
  const n = people().length;
  $('countLine').textContent = n ? `${n} ${n === 1 ? 'person' : 'people'}` + (unlocked() ? '' : ` · free version holds ${FREE_PEOPLE}`) : '';
}

// ---------- person panel ----------
function select(pid, reveal) {
  selected = pid;
  if (reveal && pid && !(lastLayout && lastLayout.cards.some((c) => c.pid === pid))) { tree.focus = pid; tree.rootFam = null; drawTree(true); save(); } else drawTree(false);
  renderList();
  renderPanel();
}
function renderPanel() {
  const el = $('panel');
  const p = tree.people[selected];
  if (!p) {
    el.innerHTML = people().length ? '<p class="empty-panel">Click a person in the tree to see their details or to add their relatives.</p>' : '';
    return;
  }
  const pf = parentFam(p.id);
  const hasF = pf && pf.a, hasM = pf && pf.b;
  el.innerHTML = `
    <div class="photo-row">
      ${p.photo ? `<img class="photo" src="${esc(p.photo)}" alt="">` : `<div class="photo">${esc((p.first || '?')[0].toUpperCase())}</div>`}
      <div><button id="pPhoto" class="ghost">${p.photo ? 'Change photo' : 'Add a photo'}</button>${p.photo ? ' <button id="pNoPhoto" class="ghost">Remove</button>' : ''}</div>
    </div>
    <div class="two">
      <label class="field">First name<input id="pFirst" type="text" maxlength="40" value="${esc(p.first)}"></label>
      <label class="field">Last name<input id="pLast" type="text" maxlength="40" value="${esc(p.last)}"></label>
    </div>
    <div class="field">Gender<div class="seg" id="pSex"><button data-v="m" class="${p.sex === 'm' ? 'on' : ''}">Male</button><button data-v="f" class="${p.sex === 'f' ? 'on' : ''}">Female</button><button data-v="" class="${!p.sex ? 'on' : ''}">Not set</button></div></div>
    <div class="two">
      <label class="field">Born<input id="pBirth" type="text" maxlength="30" placeholder="e.g. 1958" value="${esc(p.birth)}"></label>
      <label class="field">Birthplace<input id="pPlace" type="text" maxlength="60" value="${esc(p.place)}"></label>
    </div>
    <label class="check"><input id="pDead" type="checkbox" ${p.deceased ? 'checked' : ''}> This person has passed away</label>
    ${p.deceased ? `<div class="two"><label class="field">Died<input id="pDeath" type="text" maxlength="30" placeholder="e.g. 2015" value="${esc(p.death)}"></label><label class="field">Place of death<input id="pDPlace" type="text" maxlength="60" value="${esc(p.deathPlace || '')}"></label></div>` : ''}
    <label class="field">Notes<textarea id="pNotes" maxlength="2000" placeholder="Job, stories, anything to remember…">${esc(p.notes)}</textarea></label>
    <p class="sect">Add a relative of ${esc(p.first || 'this person')}</p>
    <div class="rel">
      <button id="aFather" ${hasF ? 'disabled' : ''}>+ Father</button>
      <button id="aMother" ${hasM ? 'disabled' : ''}>+ Mother</button>
      <button id="aSpouse">+ Husband / wife</button>
      <button id="aChild">+ Child</button>
      <button id="aSib" class="wide">+ Brother / sister</button>
    </div>
    <p class="sect">Other</p>
    <button id="pCenter" class="ghost">Show this person's family</button>
    <button id="pDelete" class="ghost danger">Delete this person</button>`;
  const bind = (id, key) => { const i = $(id); if (i) i.addEventListener('input', () => { p[key] = i.value; drawTree(false); renderList(); save(); }); };
  bind('pFirst', 'first'); bind('pLast', 'last'); bind('pBirth', 'birth'); bind('pPlace', 'place'); bind('pDeath', 'death'); bind('pDPlace', 'deathPlace'); bind('pNotes', 'notes');
  $('pSex').querySelectorAll('button').forEach((b) => { b.onclick = () => { p.sex = b.dataset.v; drawTree(false); renderPanel(); save(); }; });
  $('pDead').onchange = (e) => { p.deceased = e.target.checked; if (!p.deceased) { p.death = ''; p.deathPlace = ''; } drawTree(false); renderList(); renderPanel(); save(); };
  $('pPhoto').onclick = () => pickFile('image/*', async (f) => { try { p.photo = await shrinkPhoto(f); } catch (_) { return; } drawTree(false); renderPanel(); save(); });
  if ($('pNoPhoto')) $('pNoPhoto').onclick = () => { p.photo = ''; drawTree(false); renderPanel(); save(); };
  const added = (np) => { if (!np) return; selected = np.id; drawTree(true); if (!lastLayout.cards.some((c) => c.pid === np.id)) { tree.focus = np.id; tree.rootFam = null; drawTree(true); } renderList(); renderPanel(); save(); const i = $('pFirst'); if (i) i.focus(); };
  $('aFather').onclick = () => canAdd() && added(setParent(p.id, 'm'));
  $('aMother').onclick = () => canAdd() && added(setParent(p.id, 'f'));
  $('aSpouse').onclick = () => canAdd() && added(addSpouse(p.id));
  $('aSib').onclick = () => canAdd() && added(addSibling(p.id));
  $('aChild').onclick = () => {
    if (!canAdd()) return;
    const fs = famsOf(p.id);
    if (fs.length <= 1) { added(addChild(p.id, fs[0] && fs[0].id)); return; }
    const list = $('pickList');
    list.textContent = '';
    fs.forEach((f) => {
      const b = document.createElement('button');
      const sp = tree.people[spouseIn(f, p.id)];
      b.textContent = sp ? fullName(sp) : 'Other parent not entered';
      b.onclick = () => { $('pick').close(); added(addChild(p.id, f.id)); };
      list.append(b);
    });
    $('pick').showModal();
  };
  $('pCenter').onclick = () => { tree.focus = p.id; tree.rootFam = null; drawTree(true); save(); };
  $('pDelete').onclick = () => {
    if (!confirm(`Delete ${fullName(p)} from the tree? Their relatives stay in the tree.`)) return;
    removePerson(p.id);
    drawTree(true); renderList(); renderPanel(); save();
    if (!people().length) openWelcome();
  };
}
function shrinkPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const S = 240, s = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = S;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, S, S);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That file is not a picture'); rej(new Error('bad image')); };
    img.src = url;
  });
}
function pickFile(accept, cb) {
  const i = $('fileIn');
  i.accept = accept;
  i.value = '';
  i.onchange = () => { if (i.files[0]) cb(i.files[0]); };
  i.click();
}

// ---------- GEDCOM ----------
const gedText = (v) => String(v || '').replace(/@/g, '@@');
function gedLong(L, lvl, tag, text) {
  // a long text is split into CONT (new line) and CONC (same line) pieces of at most 200 characters
  String(text).split(/\r?\n/).forEach((ln, i) => {
    const parts = gedText(ln).match(/[\s\S]{1,200}/g) || [''];
    parts.forEach((pt, j) => L.push(i === 0 && j === 0 ? (pt ? `${lvl} ${tag} ${pt}` : `${lvl} ${tag}`) : pt ? `${lvl + 1} ${j === 0 ? 'CONT' : 'CONC'} ${pt}` : `${lvl + 1} CONT`)); // keep spaces at CONC joins
  });
}
function toGedcom() {
  const ps = people(), fs = Object.values(tree.fams);
  const pi = new Map(ps.map((p, i) => [p.id, `@I${i + 1}@`])), fi = new Map(fs.map((f, i) => [f.id, `@F${i + 1}@`]));
  const d = new Date(), mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  const L = ['0 HEAD', '1 SOUR Kinleaf', '2 NAME Kinleaf family tree maker', `1 DATE ${d.getDate()} ${mon} ${d.getFullYear()}`, '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', '1 SUBM @U1@'];
  if (tree.title) L.push(`1 FILE ${gedText(tree.title)}`);
  L.push('0 @U1@ SUBM', '1 NAME Kinleaf user');
  ps.forEach((p) => {
    L.push(`0 ${pi.get(p.id)} INDI`, `1 NAME ${gedText(p.first)} /${gedText(p.last)}/`.replace(/\s+\/\//, ' //'));
    if (p.first) L.push(`2 GIVN ${gedText(p.first)}`);
    if (p.last) L.push(`2 SURN ${gedText(p.last)}`);
    if (p.sex) L.push(`1 SEX ${p.sex.toUpperCase()}`);
    if (p.birth || p.place) { L.push('1 BIRT'); if (p.birth) L.push(`2 DATE ${gedText(p.birth)}`); if (p.place) L.push(`2 PLAC ${gedText(p.place)}`); }
    if (p.deceased || p.death || p.deathPlace) {
      L.push(p.death || p.deathPlace ? '1 DEAT' : '1 DEAT Y');
      if (p.death) L.push(`2 DATE ${gedText(p.death)}`);
      if (p.deathPlace) L.push(`2 PLAC ${gedText(p.deathPlace)}`);
    }
    if (p.notes) gedLong(L, 1, 'NOTE', p.notes);
    const pf = parentFam(p.id);
    if (pf) L.push(`1 FAMC ${fi.get(pf.id)}`);
    famsOf(p.id).forEach((f) => L.push(`1 FAMS ${fi.get(f.id)}`));
  });
  fs.forEach((f) => {
    L.push(`0 ${fi.get(f.id)} FAM`);
    if (f.a) L.push(`1 HUSB ${pi.get(f.a)}`);
    if (f.b) L.push(`1 WIFE ${pi.get(f.b)}`);
    if (f.marr || f.marrPlace) { L.push('1 MARR'); if (f.marr) L.push(`2 DATE ${gedText(f.marr)}`); if (f.marrPlace) L.push(`2 PLAC ${gedText(f.marrPlace)}`); }
    f.children.forEach((c) => L.push(`1 CHIL ${pi.get(c)}`));
  });
  L.push('0 TRLR');
  return L.join('\r\n') + '\r\n';
}
// reads GEDCOM 5.5 / 5.5.1 / 7 files from Ancestry, MyHeritage, FamilySearch, Gramps, RootsMagic, Legacy …
function fromGedcom(text) {
  const t = { title: '', people: {}, fams: {}, focus: null, rootFam: null };
  const ids = {}, notes = {}, famc = [], fams = {};
  let cur = null, l1 = '', l2 = '', nameCount = 0, noteTarget = null;
  const blank = () => ({ id: uid('p'), first: '', last: '', sex: '', birth: '', place: '', death: '', deathPlace: '', deceased: false, notes: '', photo: '' });
  const un = (v) => String(v || '').replace(/@@/g, '@');
  text.replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((line) => {
    const m = /^\s*(\d+)\s+(@[^@]+@\s+)?(\S+)\s?(.*)$/.exec(line);
    if (!m) return;
    const lvl = Number(m[1]), xref = (m[2] || '').trim(), tag = m[3].toUpperCase(), val = un(m[4] || '');
    if (lvl === 0) {
      cur = null; l1 = ''; noteTarget = null;
      if (tag === 'HEAD') cur = { kind: 'h' };
      else if (tag === 'INDI') { cur = { kind: 'p', o: blank(), gv: '', sn: '' }; nameCount = 0; ids[xref] = cur.o.id; t.people[cur.o.id] = cur.o; }
      else if (tag === 'FAM') { cur = { kind: 'f', o: { id: uid('f'), a: null, b: null, children: [], marr: '', marrPlace: '' }, raw: { c: [] } }; fams[xref] = cur.o; t.fams[cur.o.id] = cur.o; cur.o._raw = cur.raw; }
      else if (tag === 'NOTE' || tag === 'SNOTE') { cur = { kind: 'n', x: xref }; notes[xref] = val; noteTarget = { o: notes, k: xref }; }
      return;
    }
    if (!cur) return;
    if (lvl === 1) { l1 = tag; l2 = ''; } else if (lvl === 2) l2 = tag;
    // CONT / CONC continue the text above them
    if ((tag === 'CONT' || tag === 'CONC') && noteTarget) { noteTarget.o[noteTarget.k] += (tag === 'CONT' ? '\n' : '') + val; return; }
    if (cur.kind === 'n') return;
    if (cur.kind === 'h') { if (lvl === 1 && tag === 'FILE' && val && !/\.(ged|txt)$/i.test(val)) t.title = val; return; }
    if (lvl === 1) noteTarget = null;
    if (cur.kind === 'p') {
      const p = cur.o;
      if (lvl === 1 && tag === 'NAME') {
        nameCount++;
        if (nameCount === 1) { const n = /^([^/]*)\/?([^/]*)\/?(.*)$/.exec(val); p.first = ((n[1] || '') + ' ' + (n[3] || '')).replace(/\s+/g, ' ').trim(); p.last = (n[2] || '').trim(); }
      }
      else if (lvl === 2 && l1 === 'NAME' && nameCount === 1 && tag === 'GIVN' && !p.first) p.first = val.trim();
      else if (lvl === 2 && l1 === 'NAME' && nameCount === 1 && tag === 'SURN' && !p.last) p.last = val.trim();
      else if (lvl === 1 && tag === 'SEX') p.sex = /^M/i.test(val) ? 'm' : /^F/i.test(val) ? 'f' : '';
      else if (lvl === 1 && (tag === 'DEAT' || tag === 'BURI' || tag === 'CREM')) p.deceased = true;
      else if (lvl === 1 && tag === 'NOTE') {
        if (/^@[^@]+@$/.test(val.trim())) { cur.noteRefs = (cur.noteRefs || []).concat(val.trim()); p._refs = cur.noteRefs; }
        else { p.notes += (p.notes ? '\n' : '') + val; noteTarget = { o: p, k: 'notes' }; }
      }
      else if (lvl === 1 && tag === 'OCCU' && val) p.notes += (p.notes ? '\n' : '') + 'Occupation: ' + val;
      else if (lvl === 1 && tag === 'FAMC') famc.push([p.id, val.trim()]);
      else if (lvl === 2 && tag === 'DATE' && (l1 === 'BIRT' || (l1 === 'CHR' || l1 === 'BAPM') && !p.birth)) p.birth = l1 === 'BIRT' ? val : 'bapt. ' + val;
      else if (lvl === 2 && tag === 'PLAC' && (l1 === 'BIRT' || (l1 === 'CHR' || l1 === 'BAPM') && !p.place)) p.place = val;
      else if (lvl === 2 && tag === 'DATE' && l1 === 'DEAT') p.death = val;
      else if (lvl === 2 && tag === 'PLAC' && l1 === 'DEAT') p.deathPlace = val;
    } else if (cur.kind === 'f') {
      if (lvl === 1 && tag === 'HUSB') cur.raw.a = val.trim();
      else if (lvl === 1 && tag === 'WIFE') cur.raw.b = val.trim();
      else if (lvl === 1 && tag === 'CHIL') cur.raw.c.push(val.trim());
      else if (lvl === 2 && l1 === 'MARR' && tag === 'DATE') cur.o.marr = val;
      else if (lvl === 2 && l1 === 'MARR' && tag === 'PLAC') cur.o.marrPlace = val;
    }
  });
  Object.values(t.people).forEach((p) => {
    if (p._refs) { p.notes = [p.notes].concat(p._refs.map((r) => notes[r] || '')).filter(Boolean).join('\n'); delete p._refs; }
    p.notes = p.notes.slice(0, 2000);
  });
  Object.values(t.fams).forEach((f) => { const r = f._raw; delete f._raw; f.a = ids[r.a] || null; f.b = ids[r.b] || null; f.children = r.c.map((x) => ids[x]).filter(Boolean); });
  // some programs list a child only on the child (FAMC) and not on the family (CHIL)
  famc.forEach(([pid, x]) => { const f = fams[x]; if (f && !Object.values(t.fams).some((g) => g.children.includes(pid))) f.children.push(pid); });
  return t;
}

// ---------- sample, welcome, load ----------
function sampleTree() {
  tree = { title: 'The Carter Family', people: {}, fams: {}, focus: null, rootFam: null };
  const P = (first, last, sex, birth, death, place) => newPerson({ first, last, sex, birth, death: death || '', deceased: !!death, place: place || '' }).id;
  const walter = P('Walter', 'Carter', 'm', '1931', '2009', 'Leeds'), rose = P('Rose', 'Carter', 'f', '1934', '2018', 'York');
  const frank = P('Frank', 'Hughes', 'm', '1929', '1998'), edna = P('Edna', 'Hughes', 'f', '1933', '2021');
  const john = P('John', 'Carter', 'm', '1958', '', 'Leeds'), mary = P('Mary', 'Carter', 'f', '1960', '', 'Bristol');
  const helen = P('Helen', 'Brooks', 'f', '1962'), paul = P('Paul', 'Brooks', 'm', '1961');
  const emma = P('Emma', 'Carter', 'f', '1985'), david = P('David', 'Carter', 'm', '1988'), sophie = P('Sophie', 'Carter', 'f', '1990');
  const tom = P('Tom', 'Brooks', 'm', '1991');
  const liam = P('Liam', 'Reed', 'm', '1984'), noah = P('Noah', 'Reed', 'm', '2014'), ava = P('Ava', 'Reed', 'f', '2017');
  newFam(walter, rose, [john, helen]);
  newFam(frank, edna, [mary]);
  newFam(john, mary, [emma, david, sophie]);
  newFam(paul, helen, [tom]);
  newFam(liam, emma, [noah, ava]);
  tree.focus = john;
  tree.rootFam = parentFam(john).id;
  selected = null;
}
function refreshAll(refit) { $('treeTitle').value = tree.title; drawTree(refit); renderList(); renderPanel(); }
function openWelcome() { ['wFirst', 'wLast', 'wBirth'].forEach((i) => { $(i).value = ''; }); if (!$('welcome').open) $('welcome').showModal(); }
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000); }
function validTree(t) { return t && t.people && t.fams && typeof t.people === 'object' && typeof t.fams === 'object' && Object.values(t.people).every((p) => p && typeof p === 'object') && Object.values(t.fams).every((f) => f && Array.isArray(f.children)); }
function loadTree(t) {
  tree = { title: t.title || '', people: t.people, fams: t.fams, focus: t.focus, rootFam: t.rootFam || null, chart: t.chart || 'tree', fanGen: t.fanGen || 5, poster: t.poster };
  selected = null;
  cleanup();
  refreshAll(true);
  save();
}

// ---------- wiring ----------
const svg = $('svg');
let drag = null;
svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target }; svg.setPointerCapture(e.pointerId); });
svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true;
  svg.classList.add('drag');
  view.x = drag.vx + dx; view.y = drag.vy + dy;
  applyView();
});
svg.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  svg.classList.remove('drag');
  if (!d || d.moved) return;
  const g = d.target.closest ? d.target.closest('.p') : null;
  select(g ? g.dataset.id : null, false);
});
function zoomAt(f, cx, cy) {
  const k = Math.max(0.15, Math.min(3, view.k * f));
  view.x = cx - (cx - view.x) * (k / view.k);
  view.y = cy - (cy - view.y) * (k / view.k);
  view.k = k;
  applyView();
}
svg.addEventListener('wheel', (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
const center = () => { const r = svg.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
$('zoomIn').onclick = () => zoomAt(1.25, ...center());
$('zoomOut').onclick = () => zoomAt(0.8, ...center());
$('zoomFit').onclick = fit;
window.addEventListener('resize', fit);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawTree(false));
$('rootSel').onchange = (e) => { tree.rootFam = e.target.value; drawTree(true); save(); };
$('search').addEventListener('input', renderList);
$('treeTitle').addEventListener('input', () => { tree.title = $('treeTitle').value; save(); });

const fanPro = () => isFan() && needsPro('Printing and saving fan charts is part of Pro. You can look at the fan chart for free.');
$('printBtn').onclick = () => { if (!fanPro()) printTree(); };
$('imgBtn').onclick = () => { if (!fanPro()) savePicture(isFan() ? 3600 : 2400); };
$('chartSel').onchange = (e) => {
  tree.chart = e.target.value;
  if (isFan() && selected && tree.people[selected]) tree.focus = selected;
  drawTree(true); save();
  if (isFan()) toast('Fan chart of ' + fullName(tree.people[tree.focus]) + '. Click someone, then “Show this person’s family” to put them in the middle.');
};
$('fanGen').onchange = (e) => { tree.fanGen = Number(e.target.value); drawTree(true); save(); };
$('moreBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
document.addEventListener('click', () => { $('menu').hidden = true; });

$('posterBtn').onclick = openPoster;
$('poClose').onclick = () => $('posterDlg').close();
['poStyle', 'poSize', 'poOrient', 'poPaper'].forEach((id) => { $(id).onchange = (e) => { const k = { poStyle: 'style', poSize: 'size', poOrient: 'orient', poPaper: 'paper' }[id]; posterOpts()[k] = e.target.value; renderPoster(); save(); }; });
$('poTitle').addEventListener('input', (e) => { posterOpts().title = e.target.value; renderPoster(); save(); });
$('poSub').addEventListener('input', (e) => { posterOpts().sub = e.target.value; renderPoster(); save(); });
$('poPrintBtn').onclick = posterPrint;
$('poSaveBtn').onclick = posterSave;
$('poStyle').innerHTML = Object.entries(POSTER_STYLES).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
$('poSize').innerHTML = Object.entries(POSTER_SIZES).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('');
$('bigImgBtn').onclick = () => { if (!needsPro('The large poster picture is part of Pro.')) savePicture(9000); };
$('backupBtn').onclick = () => download(new Blob([JSON.stringify({ app: 'kinleaf', v: 1, tree })], { type: 'application/json' }), `${fileBase()}.kinleaf.json`);
$('restoreFileBtn').onclick = () => pickFile('.json,application/json', async (f) => {
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'kinleaf' || !validTree(d.tree)) throw new Error('not a backup');
    if (people().length && !confirm('Replace the tree on screen with the one from this backup file?')) return;
    loadTree(d.tree);
    toast('Backup opened');
  } catch (_) { toast('That file is not a Kinleaf backup'); }
});
$('gedOutBtn').onclick = () => { if (!needsPro('GEDCOM export is part of Pro.')) download(new Blob([toGedcom()], { type: 'text/plain' }), `${fileBase()}.ged`); };
$('gedInBtn').onclick = () => {
  if (needsPro('GEDCOM import is part of Pro.')) return;
  pickFile('.ged,text/plain', async (f) => {
    const t = fromGedcom(await f.text());
    const n = Object.keys(t.people).length;
    if (!n) { toast('No people were found in that file'); return; }
    if (people().length && !confirm(`Replace the tree on screen with the ${n} people from this GEDCOM file?`)) return;
    if (!t.title) t.title = f.name.replace(/\.[^.]+$/, '');
    t.focus = Object.keys(t.people)[0];
    loadTree(t);
    toast(`Imported ${n} people`);
  });
};
$('sampleBtn').onclick = () => { if (people().length && !confirm('Replace the tree on screen with the sample family? Save a backup first if you want to keep it.')) return; sampleTree(); refreshAll(true); save(); };
$('clearBtn').onclick = () => { if (!confirm('Remove everyone and start a new empty tree? Save a backup first if you want to keep this one.')) return; tree = { title: '', people: {}, fams: {}, focus: null, rootFam: null }; selected = null; refreshAll(true); save(); openWelcome(); };

let wSex = '';
$('wSex').querySelectorAll('button').forEach((b) => { b.onclick = () => { wSex = b.dataset.v; $('wSex').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }; });
$('wStart').onclick = () => {
  const first = $('wFirst').value.trim(), last = $('wLast').value.trim();
  if (!first && !last) { $('wFirst').focus(); return; }
  const p = newPerson({ first, last, sex: wSex, birth: $('wBirth').value.trim() });
  tree.focus = p.id;
  if (!tree.title && last) tree.title = `The ${last} Family`;
  $('welcome').close();
  selected = p.id;
  refreshAll(true);
  save();
};
$('wSample').onclick = () => { $('welcome').close(); sampleTree(); refreshAll(true); save(); };
$('welcome').addEventListener('cancel', (e) => { if (!people().length) e.preventDefault(); });
$('pickCancel').onclick = () => $('pick').close();
$('proBtn').onclick = () => { if (!isPro) openPro(); };
$('buyBtn').onclick = buyPro;
$('restoreBtn').onclick = async () => { proMessage((await checkPro()) ? 'Pro restored. ★' : 'No Pro purchase found on this Microsoft account.'); };
$('closePro').onclick = () => $('proDialog').close();

(async () => {
  try { const t = await dbGet('tree'); if (validTree(t)) { tree = t; cleanup(); } } catch (_) {}
  setPro(isPro);
  refreshAll(true);
  if (!people().length) openWelcome();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  checkPro();
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
