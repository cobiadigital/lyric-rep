// Lyric Rep client. Plain JS, no build step.

const $ = (id) => document.getElementById(id);
const els = {
  composer: $("composer"), entry: $("entry"), saveBtn: $("saveBtn"), status: $("status"),
  list: $("list"), empty: $("empty"), count: $("count"),
  searchBtn: $("searchBtn"), shuffleBtn: $("shuffleBtn"),
  search: $("search"), q: $("q"), results: $("results"), searchHint: $("searchHint"), searchCancel: $("searchCancel"),
  sheet: $("sheet"), editBody: $("editBody"), editMeta: $("editMeta"),
  copyBtn: $("copyBtn"), updateBtn: $("updateBtn"), deleteBtn: $("deleteBtn"),
  auth: $("auth"), authForm: $("authForm"), password: $("password"),
  toast: $("toast"),
};

const KEYS = { cache: "lyrics.cache", pending: "lyrics.pending", token: "lyrics.token", draft: "lyrics.draft" };

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

let entries = store.get(KEYS.cache, []);
let pending = store.get(KEYS.pending, []);
let token = store.get(KEYS.token, "");
let current = null; // entry open in the sheet

class AuthError extends Error {}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------- Rendering ---------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function allEntries() {
  const known = new Set(entries.map((e) => e.id));
  return [...pending.filter((p) => !known.has(p.id)).map((p) => ({ ...p, pending: true })), ...entries];
}

function formatDate(ms) {
  const d = new Date(ms);
  const now = new Date();
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function highlight(text, terms) {
  const safe = escapeHtml(text);
  if (!terms.length) return safe;
  const pattern = terms.map((t) => escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return safe.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

function card(entry, terms = []) {
  const li = document.createElement("li");
  li.className = "card" + (entry.pending ? " pending" : "");
  li.dataset.id = entry.id;
  li.innerHTML = `<p class="card-body">${highlight(entry.body, terms)}</p><p class="card-meta">${formatDate(entry.created_at)}</p>`;
  return li;
}

function renderList() {
  const items = allEntries();
  els.list.replaceChildren(...items.map((e) => card(e)));
  els.empty.hidden = items.length > 0;
  els.count.textContent = items.length ? `${items.length} ${items.length === 1 ? "idea" : "ideas"} · shuffled` : "";
}

function setStatus(text) {
  els.status.textContent = text;
}

let toastTimer;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 1800);
}

/* ---------- Data ---------- */

async function load() {
  try {
    const { lyrics } = await api("/api/lyrics");
    entries = lyrics;
    store.set(KEYS.cache, entries);
    setStatus("");
    renderList();
  } catch (err) {
    if (err instanceof AuthError) return showAuth();
    setStatus("Offline · showing saved copy");
  }
}

let flushing = false;
async function flush() {
  if (flushing || !pending.length) return;
  flushing = true;
  try {
    for (const item of pending.slice()) {
      const { lyric } = await api("/api/lyrics", { method: "POST", body: JSON.stringify(item) });
      pending = pending.filter((p) => p.id !== item.id);
      store.set(KEYS.pending, pending);
      entries = [lyric, ...entries.filter((e) => e.id !== lyric.id)];
      store.set(KEYS.cache, entries);
    }
    setStatus("");
  } catch (err) {
    if (err instanceof AuthError) showAuth();
    else setStatus("Saved on phone · will sync when online");
  } finally {
    flushing = false;
    renderList();
  }
}

function saveEntry() {
  const body = els.entry.value.trim();
  if (!body) return;
  const item = { id: crypto.randomUUID(), body, created_at: Date.now() };
  pending.push(item);
  store.set(KEYS.pending, pending);
  els.entry.value = "";
  store.set(KEYS.draft, "");
  autosize(els.entry);
  updateSaveBtn();
  renderList();
  toast("Saved");
  flush();
}

/* ---------- Composer ---------- */

function autosize(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function updateSaveBtn() {
  els.saveBtn.disabled = !els.entry.value.trim();
}

els.entry.value = store.get(KEYS.draft, "");
updateSaveBtn();
requestAnimationFrame(() => autosize(els.entry));

els.entry.addEventListener("input", () => {
  autosize(els.entry);
  updateSaveBtn();
  store.set(KEYS.draft, els.entry.value);
});
els.entry.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    saveEntry();
  }
});
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  saveEntry();
});

els.shuffleBtn.addEventListener("click", () => {
  entries = shuffle(entries);
  renderList();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------- Search ---------- */

let searchSeq = 0;
let searchTimer;

function termsOf(q) {
  return q.trim().split(/\s+/).filter(Boolean);
}

function localMatches(terms) {
  const lower = terms.map((t) => t.toLowerCase());
  return allEntries()
    .filter((e) => lower.every((t) => e.body.toLowerCase().includes(t)))
    .sort((a, b) => b.created_at - a.created_at);
}

function renderResults(items, terms) {
  els.results.replaceChildren(...items.map((e) => card(e, terms)));
  els.searchHint.hidden = items.length > 0;
  els.searchHint.textContent = terms.length ? "No matches." : "Start typing to find a line.";
}

function runSearch() {
  const q = els.q.value;
  const terms = termsOf(q);
  if (!terms.length) return renderResults([], []);

  // Instant results from what's already on the phone, then refresh from the server.
  renderResults(localMatches(terms), terms);

  clearTimeout(searchTimer);
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    try {
      const { lyrics } = await api(`/api/lyrics?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return;
      const ids = new Set(lyrics.map((l) => l.id));
      const extra = pending.filter((p) => !ids.has(p.id) && terms.every((t) => p.body.toLowerCase().includes(t.toLowerCase())));
      renderResults([...extra.map((p) => ({ ...p, pending: true })), ...lyrics], terms);
    } catch (err) {
      if (err instanceof AuthError) showAuth();
    }
  }, 180);
}

function openSearch() {
  els.search.hidden = false;
  els.q.value = "";
  renderResults([], []);
  // Focusing inside the tap handler lets iOS raise the keyboard.
  els.q.focus();
}

function closeSearch() {
  els.q.blur();
  els.search.hidden = true;
}

els.searchBtn.addEventListener("click", openSearch);
els.searchCancel.addEventListener("click", closeSearch);
els.q.addEventListener("input", runSearch);
els.q.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.q.blur();
  if (e.key === "Escape") closeSearch();
});

/* ---------- Entry sheet ---------- */

function findEntry(id) {
  return allEntries().find((e) => e.id === id);
}

function openSheet(entry) {
  current = entry;
  els.editBody.value = entry.body;
  const edited = entry.updated_at && entry.updated_at - entry.created_at > 60000 ? ` · edited ${formatDate(entry.updated_at)}` : "";
  els.editMeta.textContent = `Added ${new Date(entry.created_at).toLocaleString()}${edited}`;
  els.sheet.hidden = false;
  requestAnimationFrame(() => autosize(els.editBody));
}

function closeSheet() {
  els.editBody.blur();
  els.sheet.hidden = true;
  current = null;
}

function onCardTap(e) {
  const li = e.target.closest(".card");
  if (!li) return;
  const entry = findEntry(li.dataset.id);
  if (entry) openSheet(entry);
}

els.list.addEventListener("click", onCardTap);
els.results.addEventListener("click", onCardTap);
els.sheet.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeSheet();
});
els.editBody.addEventListener("input", () => autosize(els.editBody));

els.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.editBody.value);
    toast("Copied");
  } catch {
    toast("Couldn't copy");
  }
});

els.updateBtn.addEventListener("click", async () => {
  if (!current) return;
  const body = els.editBody.value.trim();
  if (!body) return toast("Entry is empty");
  const id = current.id;

  const p = pending.find((x) => x.id === id);
  if (p) {
    p.body = body;
    store.set(KEYS.pending, pending);
  } else {
    try {
      const { updated_at } = await api(`/api/lyrics/${id}`, { method: "PUT", body: JSON.stringify({ body }) });
      entries = entries.map((e) => (e.id === id ? { ...e, body, updated_at } : e));
      store.set(KEYS.cache, entries);
    } catch (err) {
      if (err instanceof AuthError) return showAuth();
      return toast("Couldn't save, you're offline");
    }
  }
  closeSheet();
  renderList();
  if (!els.search.hidden) runSearch();
  toast("Updated");
});

els.deleteBtn.addEventListener("click", async () => {
  if (!current) return;
  if (!confirm("Delete this entry?")) return;
  const id = current.id;

  if (pending.some((x) => x.id === id)) {
    pending = pending.filter((x) => x.id !== id);
    store.set(KEYS.pending, pending);
  } else {
    try {
      await api(`/api/lyrics/${id}`, { method: "DELETE" });
    } catch (err) {
      if (err instanceof AuthError) return showAuth();
      return toast("Couldn't delete, you're offline");
    }
    entries = entries.filter((e) => e.id !== id);
    store.set(KEYS.cache, entries);
  }
  closeSheet();
  renderList();
  if (!els.search.hidden) runSearch();
  toast("Deleted");
});

/* ---------- Password ---------- */

function showAuth() {
  if (!els.auth.hidden) return;
  els.auth.hidden = false;
  setTimeout(() => els.password.focus(), 50);
}

els.authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  token = els.password.value;
  try {
    await api("/api/auth");
    store.set(KEYS.token, token);
    els.password.value = "";
    els.auth.hidden = true;
    await flush();
    await load();
  } catch (err) {
    toast(err instanceof AuthError ? "Wrong password" : "Can't reach server");
  }
});

/* ---------- Startup ---------- */

entries = shuffle(entries);
renderList();
flush().then(load);

window.addEventListener("online", () => flush().then(load));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") flush();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
