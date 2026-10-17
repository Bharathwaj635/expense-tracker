// ---------- Built-in categories ----------
const CATEGORIES = {
  expense: [
    { name: "Food", icon: "🍔" },
    { name: "Transport", icon: "🚌" },
    { name: "Bills", icon: "💡" },
    { name: "Shopping", icon: "🛍️" },
    { name: "Health", icon: "💊" },
    { name: "Entertainment", icon: "🎬" },
    { name: "Other", icon: "📦" }
  ],
  income: [
    { name: "Salary", icon: "💼" },
    { name: "Gift", icon: "🎁" },
    { name: "Other", icon: "💰" }
  ]
};

const NEW_CAT = "__new__";

// ---------- Page elements ----------
const $ = (id) => document.getElementById(id);

const modal = $("modal");
const form = $("txForm");
const formTitle = $("formTitle");
const amountInput = $("amount");
const categorySelect = $("category");
const dateInput = $("date");
const noteInput = $("note");
const deleteBtn = $("deleteBtn");
const typeButtons = document.querySelectorAll(".type-btn");

const searchInput = $("search");
const filterType = $("filterType");
const filterCategory = $("filterCategory");
const navButtons = document.querySelectorAll(".bottom-nav button");

// ---------- App state ----------
let currentType = "expense";
let editingId = null;
let allTx = [];
let customCats = [];
let budgets = {};            // like { Food: 5000, Bills: 2000 }
let lastCategory = "";
let currentScreen = "homeScreen";
let filters = { text: "", type: "all", category: "all" };
let viewMonth = todayString().slice(0, 7); // like "2026-10"

// ---------- Helpers ----------
function formatINR(n) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(n);
}

function todayString() {
  const now = new Date();
  return new Date(now - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function prettyDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replace(/"/g, "&quot;");
}

// Built-in + your own categories for a type
function categoriesFor(type) {
  const mine = customCats.filter((c) => c.type === type);
  return [...CATEGORIES[type], ...mine];
}

function iconFor(type, name) {
  const found = categoriesFor(type).find((c) => c.name === name);
  return found ? found.icon : "📦";
}

// Total spent per category in the month being viewed
function spentThisMonth() {
  const spent = {};
  allTx.forEach((t) => {
    if (t.type === "expense" && t.date.startsWith(viewMonth)) {
      spent[t.category] = (spent[t.category] || 0) + t.amount;
    }
  });
  return spent;
}

// ---------- Screens (Home / Charts / Settings) ----------
function showScreen(id) {
  currentScreen = id;
  ["homeScreen", "chartsScreen", "settingsScreen"].forEach((s) => {
    $(s).hidden = s !== id;
  });
  navButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.screen === id);
  });
  if (id === "chartsScreen") renderCharts();
  if (id === "settingsScreen") renderSettings();
  window.scrollTo(0, 0);
}

navButtons.forEach((b) => {
  b.addEventListener("click", () => showScreen(b.dataset.screen));
});

// ---------- Month switcher ----------
function shiftMonth(delta) {
  const [y, m] = viewMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  viewMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  render();
}

$("prevMonth").addEventListener("click", () => shiftMonth(-1));
$("nextMonth").addEventListener("click", () => shiftMonth(1));

// ---------- Search and filters ----------
function fillFilterCategories() {
  const names = new Set();
  [...categoriesFor("expense"), ...categoriesFor("income")].forEach((c) =>
    names.add(c.name)
  );

  const keep = filterCategory.value || "all";
  filterCategory.innerHTML =
    '<option value="all">All categories</option>' +
    [...names]
      .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
      .join("");

  filterCategory.value = names.has(keep) ? keep : "all";
  filters.category = filterCategory.value;
}

searchInput.addEventListener("input", () => {
  filters.text = searchInput.value.trim();
  render();
});

filterType.addEventListener("change", () => {
  filters.type = filterType.value;
  render();
});

filterCategory.addEventListener("change", () => {
  filters.category = filterCategory.value;
  render();
});

// ---------- Draw the screen ----------
function render() {
  const monthTx = allTx.filter((t) => t.date.startsWith(viewMonth));

  // Header totals (always the whole month, ignoring filters)
  let income = 0;
  let expense = 0;
  monthTx.forEach((t) => {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
  });

  $("incomeTotal").textContent = formatINR(income);
  $("expenseTotal").textContent = formatINR(expense);
  $("balance").textContent = formatINR(income - expense);

  const [y, m] = viewMonth.split("-").map(Number);
  $("monthLabel").textContent = new Date(y, m - 1, 1).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric" }
  );

  renderAlerts();
  renderList(monthTx);
  if (currentScreen === "chartsScreen") renderCharts();
}

function renderList(monthTx) {
  const list = $("txList");

  if (monthTx.length === 0) {
    list.innerHTML =
      '<li class="empty">No transactions in this month. Tap + to add one.</li>';
    return;
  }

  const text = filters.text.toLowerCase();
  const shown = monthTx.filter((t) => {
    if (filters.type !== "all" && t.type !== filters.type) return false;
    if (filters.category !== "all" && t.category !== filters.category) return false;
    if (text && !((t.note || "") + " " + t.category).toLowerCase().includes(text)) {
      return false;
    }
    return true;
  });

  if (shown.length === 0) {
    list.innerHTML = '<li class="empty">No matches. Try a different search or filter.</li>';
    return;
  }

  list.innerHTML = shown
    .map((t) => {
      const sign = t.type === "income" ? "+" : "-";
      const title = t.note ? escapeHtml(t.note) : escapeHtml(t.category);
      return `
        <li class="tx" data-id="${t.id}">
          <div class="tx-icon">${iconFor(t.type, t.category)}</div>
          <div class="tx-info">
            <b>${title}</b>
            <small>${escapeHtml(t.category)} • ${prettyDate(t.date)}</small>
          </div>
          <div class="tx-amount ${t.type}">${sign}${formatINR(t.amount)}</div>
        </li>`;
    })
    .join("");
}

// ---------- Budget warnings on Home ----------
function renderAlerts() {
  const spent = spentThisMonth();
  const messages = [];

  Object.keys(budgets).forEach((cat) => {
    const limit = budgets[cat];
    const used = spent[cat] || 0;

    if (used > limit) {
      messages.push({
        cls: "over",
        text: `🚨 ${cat}: over budget by ${formatINR(used - limit)}`
      });
    } else if (used >= limit * 0.8) {
      messages.push({
        cls: "warn",
        text: `⚠️ ${cat}: ${Math.round((used / limit) * 100)}% of budget used (${formatINR(used)} of ${formatINR(limit)})`
      });
    }
  });

  $("alerts").innerHTML = messages
    .map((m) => `<div class="alert ${m.cls}">${escapeHtml(m.text)}</div>`)
    .join("");
}

// ---------- Charts screen ----------
function renderCharts() {
  drawPie(allTx, viewMonth);
  drawBar(allTx, viewMonth);
  renderBudgets();
}

function renderBudgets() {
  const spent = spentThisMonth();

  $("budgetList").innerHTML = categoriesFor("expense")
    .map((c) => {
      const limit = budgets[c.name];
      const used = spent[c.name] || 0;
      let status = "No limit set";
      let bar = "";

      if (limit) {
        const pct = Math.min(100, (used / limit) * 100);
        const cls = used > limit ? "over" : used >= limit * 0.8 ? "warn" : "ok";
        status = `${formatINR(used)} / ${formatINR(limit)}`;
        bar = `<div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>`;
      }

      return `
        <li class="budget" data-cat="${escapeHtml(c.name)}">
          <div class="tx-icon">${c.icon}</div>
          <div class="tx-info">
            <b>${escapeHtml(c.name)}</b>
            <small>${status}</small>
            ${bar}
          </div>
          <span>✏️</span>
        </li>`;
    })
    .join("");
}

$("budgetList").addEventListener("click", async (e) => {
  const row = e.target.closest(".budget");
  if (!row) return;

  const cat = row.dataset.cat;
  const current = budgets[cat] || "";
  const answer = prompt(
    `Monthly budget for ${cat} in ₹\n(leave empty or enter 0 to remove it):`,
    current
  );
  if (answer === null) return; // Cancel pressed

  const value = Number(answer.trim() === "" ? 0 : answer);
  if (isNaN(value) || value < 0) {
    alert("Please enter a valid number.");
    return;
  }

  if (value === 0) await deleteBudget(cat);
  else await setBudget(cat, value);

  await refresh();
});

async function refresh() {
  allTx = await getAllTransactions();

  budgets = {};
  (await getBudgets()).forEach((b) => {
    budgets[b.category] = b.amount;
  });

  render();
}

// ---------- The Add / Edit form ----------
function fillCategories(selected) {
  const cats = categoriesFor(currentType);
  const options = cats.map(
    (c) =>
      `<option value="${escapeHtml(c.name)}">${c.icon} ${escapeHtml(c.name)}</option>`
  );
  options.push(`<option value="${NEW_CAT}">➕ New category…</option>`);
  categorySelect.innerHTML = options.join("");

  if (selected && cats.some((c) => c.name === selected)) {
    categorySelect.value = selected;
  }
  lastCategory = categorySelect.value;
}

function setType(type) {
  currentType = type;
  typeButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
  });
  fillCategories();
}

function openForm(tx) {
  editingId = tx ? tx.id : null;
  formTitle.textContent = tx ? "Edit Transaction" : "Add Transaction";
  deleteBtn.style.display = tx ? "block" : "none";

  setType(tx ? tx.type : "expense");
  if (tx) fillCategories(tx.category);

  amountInput.value = tx ? tx.amount : "";
  dateInput.value = tx ? tx.date : todayString();
  noteInput.value = tx ? tx.note : "";

  modal.classList.add("open");
  amountInput.focus();
}

function closeForm() {
  modal.classList.remove("open");
}

// ---------- Creating a new category ----------
categorySelect.addEventListener("change", async () => {
  if (categorySelect.value !== NEW_CAT) {
    lastCategory = categorySelect.value;
    return;
  }

  const name = (prompt("Name of the new category (e.g. Groceries):") || "").trim();
  if (!name) {
    categorySelect.value = lastCategory;
    return;
  }

  const exists = categoriesFor(currentType).some(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (exists) {
    alert("That category already exists.");
    categorySelect.value = lastCategory;
    return;
  }

  const icon = (prompt("Type one emoji for it (optional):", "🏷️") || "").trim() || "🏷️";

  await addCustomCategory({ type: currentType, name: name, icon: icon });
  customCats = await getCustomCategories();
  fillCategories(name);
  fillFilterCategories();
});

// ---------- Button actions ----------
$("addBtn").addEventListener("click", () => openForm(null));
$("cancelBtn").addEventListener("click", closeForm);

// Tap outside the white sheet to close
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeForm();
});

typeButtons.forEach((b) => {
  b.addEventListener("click", () => setType(b.dataset.type));
});

// Tap a transaction to edit it
$("txList").addEventListener("click", (e) => {
  const row = e.target.closest(".tx");
  if (!row) return;
  const tx = allTx.find((t) => t.id === Number(row.dataset.id));
  if (tx) openForm(tx);
});

// Save
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const data = {
    type: currentType,
    amount: Number(amountInput.value),
    category: categorySelect.value,
    date: dateInput.value,
    note: noteInput.value.trim()
  };

  if (!(data.amount > 0)) {
    alert("Please enter an amount greater than 0.");
    return;
  }
  if (data.category === NEW_CAT) {
    alert("Please choose a category.");
    return;
  }

  if (editingId) {
    await updateTransaction(editingId, data);
  } else {
    await addTransaction(data);
  }

  // Jump to the month of the saved transaction so you can see it
  viewMonth = data.date.slice(0, 7);

  closeForm();
  await refresh();
});

// Delete
deleteBtn.addEventListener("click", async () => {
  if (!editingId) return;
  if (confirm("Delete this transaction?")) {
    await deleteTransaction(editingId);
    closeForm();
    await refresh();
  }
});

// ---------- Start ----------
async function start() {
  customCats = await getCustomCategories();
  fillFilterCategories();
  await refresh();
}
start();