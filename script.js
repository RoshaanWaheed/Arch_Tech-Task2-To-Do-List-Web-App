const $ = (s) => document.querySelector(s);
const KEY = "taskboard.tasks.v2";
let tasks = [], filter = "all", editingId = null, undoTimer = null, lastDeleted = null;

// ---- Storage: all data lives in the browser's localStorage ----
function loadStore() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { return []; }
}
function saveStore() {
  try { localStorage.setItem(KEY, JSON.stringify(tasks)); showMsg(""); }
  catch { showMsg("Could not save. Browser storage may be full or blocked."); }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const showMsg = (t) => ($("#msg").textContent = t);

// ---- Theme ----
const root = document.documentElement;
try { root.dataset.theme = localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch {}
$("#theme").onclick = () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
};

// ---- Dates ----
const local = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
function dueInfo(t) {
  if (!t.due) return null;
  const today = local();
  const label = new Date(t.due + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (t.done) return { text: label, cls: "" };
  if (t.due < today) return { text: "Overdue · " + label, cls: "late" };
  if (t.due === today) return { text: "Due today", cls: "today" };
  return { text: "Due " + label, cls: "" };
}

// ---- Filtering and sorting ----
const rank = { high: 0, medium: 1, low: 2 };
function visible() {
  const q = $("#search").value.trim().toLowerCase();
  let list = tasks.filter((t) =>
    (filter === "all" || (filter === "done") === t.done) &&
    (!q || (t.title + " " + t.category).toLowerCase().includes(q)));
  const s = $("#sort").value;
  if (s === "due") list.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  if (s === "priority") list.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return list;
}

// ---- Rendering ----
function render() {
  const list = $("#list");
  list.innerHTML = "";
  const shown = visible();
  if (!shown.length) {
    list.innerHTML = '<li class="empty">' + (tasks.length ? "No tasks match this view." : "Nothing here yet. Add your first task above.") + "</li>";
  }
  shown.forEach((t) => {
    const li = document.createElement("li");
    li.className = "item" + (t.done ? " done" : "");
    li.dataset.p = t.priority;

    const box = document.createElement("input");
    box.type = "checkbox"; box.checked = t.done;
    box.setAttribute("aria-label", "Mark done: " + t.title);
    box.onchange = () => update(t.id, { done: box.checked });

    const body = document.createElement("div");
    body.className = "body";
    const title = document.createElement("div");
    title.className = "title"; title.textContent = t.title;     // textContent prevents HTML injection
    const meta = document.createElement("div");
    meta.className = "meta";
    const add = (text, cls = "") => { const b = document.createElement("span"); b.className = "badge " + cls; b.textContent = text; meta.appendChild(b); };
    add(t.priority[0].toUpperCase() + t.priority.slice(1));
    if (t.category) add("#" + t.category);
    const d = dueInfo(t); if (d) add(d.text, d.cls);
    body.append(title, meta);

    const act = document.createElement("div");
    act.className = "act";
    const edit = document.createElement("button"); edit.textContent = "Edit"; edit.onclick = () => openEdit(t);
    const del = document.createElement("button"); del.textContent = "Delete"; del.className = "del"; del.onclick = () => remove(t);
    act.append(edit, del);

    li.append(box, body, act);
    list.appendChild(li);
  });

  // stats, progress ring, category suggestions
  const done = tasks.filter((t) => t.done).length, today = local();
  const late = tasks.filter((t) => !t.done && t.due && t.due < today).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  $("#sTotal").textContent = tasks.length; $("#sDone").textContent = done;
  $("#sOpen").textContent = tasks.length - done; $("#sLate").textContent = late;
  $("#pct").textContent = pct + "%";
  $("#arc").style.strokeDashoffset = 113.1 * (1 - pct / 100);
  $("#left").textContent = tasks.length - done + " open";
  $("#cats").innerHTML = [...new Set(tasks.map((t) => t.category).filter(Boolean))].map((c) => '<option value="' + c.replace(/"/g, "&quot;") + '">').join("");
}

// ---- Actions ----
const PRIORITIES = ["low", "medium", "high"];
function clean(t) {
  return {
    title: String(t.title || "").trim().slice(0, 120),
    priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
    category: String(t.category || "").trim().slice(0, 24),
    due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || "") ? t.due : "",
  };
}
function create(body) {
  tasks.unshift({ id: uid(), done: !!body.done, createdAt: new Date().toISOString(), ...clean(body) });
  saveStore(); render();
}
function update(id, patch) {
  tasks = tasks.map((t) => {
    if (t.id !== id) return t;
    const next = { ...t, ...patch };
    return { ...next, ...clean(next), done: !!next.done };
  });
  saveStore(); render();
}
function remove(t) {
  tasks = tasks.filter((x) => x.id !== t.id);
  saveStore(); render();
  lastDeleted = t; toast("Task deleted");
}
function toast(text) {
  const el = $("#toast");
  el.innerHTML = "<span></span><button>Undo</button>";
  el.firstChild.textContent = text;
  el.lastChild.onclick = () => {
    el.classList.remove("show");
    const { title, priority, category, due, done } = lastDeleted;
    create({ title, priority, category, due, done });
  };
  el.classList.add("show");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => el.classList.remove("show"), 5000);
}

// ---- Edit dialog ----
function openEdit(t) {
  editingId = t.id;
  $("#eTitle").value = t.title; $("#ePriority").value = t.priority;
  $("#eDue").value = t.due; $("#eCategory").value = t.category;
  $("#dlg").showModal(); $("#eTitle").focus();
}
$("#editForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const title = $("#eTitle").value.trim();
  if (!title) return;
  update(editingId, { title, priority: $("#ePriority").value, due: $("#eDue").value, category: $("#eCategory").value });
});

// ---- Events ----
$("#addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = $("#title").value.trim();
  if (!title) return showMsg("Type a task before adding it.");
  showMsg("");
  create({ title, priority: $("#priority").value, due: $("#due").value, category: $("#category").value });
  $("#title").value = ""; $("#due").value = ""; $("#category").value = ""; $("#title").focus();
});
document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
  filter = b.dataset.f;
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  render();
});
$("#search").oninput = render; $("#sort").onchange = render;
$("#clear").onclick = () => { tasks = tasks.filter((t) => !t.done); saveStore(); render(); };
addEventListener("keydown", (e) => {
  if (e.target.matches("input,select,textarea") || e.metaKey || e.ctrlKey) return;
  if (e.key === "n") { e.preventDefault(); $("#title").focus(); }
  if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
});

$("#today").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
tasks = loadStore();
render();