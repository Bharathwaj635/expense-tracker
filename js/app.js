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
const accountSelect = $("account");
const fromSelect = $("fromAcct");
const toSelect = $("toAcct");
const dateInput = $("date");
const noteInput = $("note");
const deleteBtn = $("deleteBtn");
const typeButtons = document.querySelectorAll(".type-btn");

const searchInput = $("search");
const filterType = $("filterType");
const filterCategory = $("filterCategory");
const navButtons = document.querySelectorAll(".bottom-nav button");

// ---------- Small helpers for saving settings on this device ----------
function lsGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch (e) {}
}

// ---------- App state ----------
let currentType = "expense";   // expense | income | transfer
let editingId = null;
let editingKind = "tx";        // tx | transfer
let allTx = [];
let allTransfers = [];
let allGoals = [];
let accounts = [];
let customCats = [];
let budgets = {};              // like { Food: 5000, Bills: 2000 }
let lastCategory = "";
let currentScreen = "homeScreen";
let filters = { text: "", type: "all", category: "all" };
let viewMonth = todayString().slice(0, 7); // like "2026-10"
let selectedAccount = lsGet("et_account") || "all";

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

// ---------- Account helpers ----------
function acctName(id) {
  const a = accounts.find((x) => x.id === (id || "cash"));
  return a ? a.name : "Cash";
}

function acctIcon(id) {
  const a = accounts.find((x) => x.id === (id || "cash"));
  return a ? a.icon : "💵";
}

// Transactions for the account chip that is selected
function visibleTx() {
  if (selectedAccount === "all") return allTx;
  return allTx.filter((t) => (t.accountId || "cash") === selectedAccount);
}

// Transfers that touch the selected account
function visibleTransfers() {
  if (selectedAccount === "all") return allTransfers;
  return allTransfers.filter(
    (t) => t.fromId === selectedAccount || t.toId === selectedAccount
  );
}

// Money in the given accounts at the end of a month ("2026-10-31")
function balanceFor(ids, upTo) {
  const set = new Set(ids);
  let total = 0;

  accounts.forEach((a) => {
    if (set.has(a.id)) total += Number(a.opening) || 0;
  });

  allTx.forEach((t) => {
    if (t.date <= upTo && set.has(t.accountId || "cash")) {
      total += t.type === "income" ? t.amount : -t.amount;
    }
  });

  allTransfers.forEach((t) => {
    if (t.date <= upTo) {
      if (set.has(t.toId)) total += t.amount;
      if (set.has(t.fromId)) total -= t.amount;
    }
  });

  // Money moved into savings goals leaves the account
  allGoals.forEach((g) => {
    if (!g || !Array.isArray(g.contributions)) return;
    g.contributions.forEach((c) => {
      if (
        c &&
        typeof c.date === "string" &&
        c.date <= upTo &&
        set.has(c.accountId || "cash")
      ) {
        total -= Number(c.amount) || 0;
      }
    });
  });

  return total;
}

// Total spent per category in the month being viewed (all accounts, for budgets)
function spentThisMonth() {
  const spent = {};
  allTx.forEach((t) => {
    if (t.type === "expense" && t.date.startsWith(viewMonth)) {
      spent[t.category] = (spent[t.category] || 0) + t.amount;
    }
  });
  return spent;
}

// ---------- Account chips and cards ----------
function chooseAccount(id) {
  selectedAccount = id;
  lsSet("et_account", id);
  render();
}

function renderAccountBar() {
  const items = [{ id: "all", name: "All", icon: "🏦" }, ...accounts];
  $("acctBar").innerHTML = items
    .map(
      (a) =>
        `<button class="chip ${a.id === selectedAccount ? "active" : ""}" data-id="${escapeHtml(a.id)}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</button>`
    )
    .join("");
}

function renderAccountCards() {
  const box = $("acctCards");

  if (selectedAccount !== "all") {
    box.innerHTML = "";
    return;
  }

  const upTo = viewMonth + "-31";
  box.innerHTML =
    "<h2>Accounts</h2>" +
    '<div class="acct-grid">' +
    accounts
      .map(
        (a) => `
      <button class="acct-card" data-id="${escapeHtml(a.id)}">
        <span class="acct-icon">${escapeHtml(a.icon)}</span>
        <small>${escapeHtml(a.name)}</small>
        <b>${formatINR(balanceFor([a.id], upTo))}</b>
      </button>`
      )
      .join("") +
    "</div>";
}

$("acctBar").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (b) chooseAccount(b.dataset.id);
});

$("acctCards").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (b) chooseAccount(b.dataset.id);
});

// ---------- Screens (Home / Charts / Goals / Settings) ----------
function showScreen(id) {
  currentScreen = id;
  ["homeScreen", "chartsScreen", "goalsScreen", "settingsScreen"].forEach((s) => {
    $(s).hidden = s !== id;
  });
  navButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.screen === id);
  });
  if (id === "chartsScreen") renderCharts();
  if (id === "settingsScreen") renderSettings();
  if (id === "goalsScreen" && window.renderGoals) window.renderGoals();
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
  const upTo = viewMonth + "-31";
  const monthTx = visibleTx().filter((t) => t.date.startsWith(viewMonth));

  // Month income and expenses for the selected account(s)
  let income = 0;
  let expense = 0;
  monthTx.forEach((t) => {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
  });

  const ids = selectedAccount === "all" ? accounts.map((a) => a.id) : [selectedAccount];

  $("incomeTotal").textContent = formatINR(income);
  $("expenseTotal").textContent = formatINR(expense);
  $("balance").textContent = formatINR(balanceFor(ids, upTo));
  $("greeting").textContent =
    selectedAccount === "all" ? "Total balance" : acctName(selectedAccount) + " balance";

  const [y, m] = viewMonth.split("-").map(Number);
  $("monthLabel").textContent = new Date(y, m - 1, 1).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric" }
  );

  renderAccountBar();
  renderAccountCards();
  renderAlerts();
  if (window.renderDue) window.renderDue();
  if (window.renderInsights) window.renderInsights();
  renderList();
  if (currentScreen === "chartsScreen") renderCharts();
  if (currentScreen === "goalsScreen" && window.renderGoals) window.renderGoals();
}

function renderList() {
  const list = $("txList");

  // Combine this month's entries and transfers into one list
  const items = [];
  visibleTx()
    .filter((t) => t.date.startsWith(viewMonth))
    .forEach((t) => items.push({ kind: "tx", id: t.id, date: t.date, data: t }));
  visibleTransfers()
    .filter((t) => t.date.startsWith(viewMonth))
    .forEach((t) => items.push({ kind: "transfer", id: t.id, date: t.date, data: t }));

  items.sort((a, b) => {
    if (a.date === b.date) return b.id - a.id;
    return a.date < b.date ? 1 : -1;
  });

  if (items.length === 0) {
    list.innerHTML =
      '<li class="empty">No transactions in this month. Tap + to add one.</li>';
    return;
  }

  const text = filters.text.toLowerCase();
  const shown = items.filter((it) => {
    const t = it.data;

    if (it.kind === "transfer") {
      if (filters.type !== "all" && filters.type !== "transfer") return false;
      if (filters.category !== "all") return false;
      const hay = (
        "transfer " + acctName(t.fromId) + " " + acctName(t.toId) + " " + (t.note || "")
      ).toLowerCase();
      return !text || hay.includes(text);
    }

    if (filters.type !== "all" && t.type !== filters.type) return false;
    if (filters.category !== "all" && t.category !== filters.category) return false;
    const hay = ((t.note || "") + " " + t.category + " " + acctName(t.accountId)).toLowerCase();
    return !text || hay.includes(text);
  });

  if (shown.length === 0) {
    list.innerHTML = '<li class="empty">No matches. Try a different search or filter.</li>';
    return;
  }

  list.innerHTML = shown
    .map((it) => {
      const t = it.data;

      if (it.kind === "transfer") {
        let sign = "";
        let cls = "transfer";
        if (selectedAccount !== "all") {
          if (t.toId === selectedAccount) { sign = "+"; cls = "income"; }
          else { sign = "-"; cls = "expense"; }
        }
        const title = t.note ? escapeHtml(t.note) : "Transfer";
        return `
        <li class="tx" data-kind="transfer" data-id="${t.id}">
          <div class="tx-icon">🔁</div>
          <div class="tx-info">
            <b>${title}</b>
            <small>${escapeHtml(acctName(t.fromId))} → ${escapeHtml(acctName(t.toId))} • ${prettyDate(t.date)}</small>
          </div>
          <div class="tx-amount ${cls}">${sign}${formatINR(t.amount)}</div>
        </li>`;
      }

      const sign = t.type === "income" ? "+" : "-";
      const title = t.note ? escapeHtml(t.note) : escapeHtml(t.category);
      const where =
        selectedAccount === "all" ? " • " + escapeHtml(acctName(t.accountId)) : "";
      return `
        <li class="tx" data-kind="tx" data-id="${t.id}">
          <div class="tx-icon">${iconFor(t.type, t.category)}</div>
          <div class="tx-info">
            <b>${title}</b>
            <small>${escapeHtml(t.category)}${where} • ${prettyDate(t.date)}</small>
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
  $("chartScope").textContent =
    selectedAccount === "all"
      ? "Charts show all accounts together. Pick an account chip above to see one."
      : "Charts show only: " + acctIcon(selectedAccount) + " " + acctName(selectedAccount);

  drawPie(visibleTx(), viewMonth);
  drawBar(visibleTx(), viewMonth);
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
  allTransfers = await getAllTransfers();
  allGoals = await getGoals();
  accounts = await getAccounts();

  if (selectedAccount !== "all" && !accounts.some((a) => a.id === selectedAccount)) {
    selectedAccount = "all";
  }

  budgets = {};
  (await getBudgets()).forEach((b) => {
    budgets[b.category] = b.amount;
  });

  render();
}

// ---------- The Add / Edit form ----------
function fillCategories(selected) {
  const cats = categoriesFor(currentType === "income" ? "income" : "expense");
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

function fillAccountSelects() {
  const opts = accounts
    .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`)
    .join("");
  accountSelect.innerHTML = opts;
  fromSelect.innerHTML = opts;
  toSelect.innerHTML = opts;
}

function setType(type) {
  currentType = type;

  typeButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
  });

  const isTransfer = type === "transfer";
  $("catRow").hidden = isTransfer;
  $("acctRow").hidden = isTransfer;
  $("transferRow").hidden = !isTransfer;

  if (!isTransfer) fillCategories();
}

// The account a new entry starts with
function defaultAccount() {
  if (selectedAccount !== "all") return selectedAccount;
  const last = lsGet("et_last_acct");
  return accounts.some((a) => a.id === last) ? last : "cash";
}

function openForm(item, kind) {
  editingId = item ? item.id : null;
  editingKind = item ? kind : "tx";
  deleteBtn.style.display = item ? "block" : "none";

  fillAccountSelects();

  // While editing, only show the types that make sense
  typeButtons.forEach((b) => {
    if (!item) b.hidden = false;
    else if (kind === "transfer") b.hidden = b.dataset.type !== "transfer";
    else b.hidden = b.dataset.type === "transfer";
  });

  if (item && kind === "transfer") {
    formTitle.textContent = "Edit Transfer";
    setType("transfer");
    fromSelect.value = item.fromId;
    toSelect.value = item.toId;
    amountInput.value = item.amount;
    dateInput.value = item.date;
    noteInput.value = item.note || "";
  } else {
    formTitle.textContent = item ? "Edit Transaction" : "Add Transaction";
    setType(item ? item.type : "expense");
    if (item) fillCategories(item.category);

    accountSelect.value = item ? item.accountId || "cash" : defaultAccount();
    amountInput.value = item ? item.amount : "";
    dateInput.value = item ? item.date : todayString();
    noteInput.value = item ? item.note : "";
  }

  // Sensible starting values for a new transfer
  if (!item) {
    fromSelect.value = defaultAccount();
    const other = accounts.find((a) => a.id !== fromSelect.value);
    if (other) toSelect.value = other.id;
  }

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

  const kindOfCat = currentType === "income" ? "income" : "expense";
  const name = (prompt("Name of the new category (e.g. Groceries):") || "").trim();
  if (!name) {
    categorySelect.value = lastCategory;
    return;
  }

  const exists = categoriesFor(kindOfCat).some(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (exists) {
    alert("That category already exists.");
    categorySelect.value = lastCategory;
    return;
  }

  const icon = (prompt("Type one emoji for it (optional):", "🏷️") || "").trim() || "🏷️";

  await addCustomCategory({ type: kindOfCat, name: name, icon: icon });
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

// Tap a transaction or transfer to edit it
$("txList").addEventListener("click", (e) => {
  const row = e.target.closest(".tx");
  if (!row) return;
  const id = Number(row.dataset.id);

  if (row.dataset.kind === "transfer") {
    const t = allTransfers.find((x) => x.id === id);
    if (t) openForm(t, "transfer");
  } else {
    const t = allTx.find((x) => x.id === id);
    if (t) openForm(t, "tx");
  }
});

// Save
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const amount = Number(amountInput.value);
  if (!(amount > 0)) {
    alert("Please enter an amount greater than 0.");
    return;
  }

  if (currentType === "transfer") {
    const fromId = fromSelect.value;
    const toId = toSelect.value;
    if (fromId === toId) {
      alert("Please choose two different accounts.");
      return;
    }

    const data = {
      date: dateInput.value,
      fromId: fromId,
      toId: toId,
      amount: amount,
      note: noteInput.value.trim()
    };

    if (editingId && editingKind === "transfer") await updateTransfer(editingId, data);
    else await addTransfer(data);

    viewMonth = data.date.slice(0, 7);
  } else {
    const data = {
      type: currentType,
      amount: amount,
      category: categorySelect.value,
      accountId: accountSelect.value,
      date: dateInput.value,
      note: noteInput.value.trim()
    };

    if (data.category === NEW_CAT) {
      alert("Please choose a category.");
      return;
    }

    if (editingId && editingKind === "tx") await updateTransaction(editingId, data);
    else await addTransaction(data);

    lsSet("et_last_acct", data.accountId);
    viewMonth = data.date.slice(0, 7);
  }

  closeForm();
  await refresh();
});

// Delete
deleteBtn.addEventListener("click", async () => {
  if (!editingId) return;
  const what = editingKind === "transfer" ? "transfer" : "transaction";
  if (confirm("Delete this " + what + "?")) {
    if (editingKind === "transfer") await deleteTransfer(editingId);
    else await deleteTransaction(editingId);
    closeForm();
    await refresh();
  }
});

// ---------- Start (waits for the unlock when encryption is on) ----------
async function start() {
  customCats = await getCustomCategories();
  fillFilterCategories();
  await refresh();
}
Vault.onUnlock(start);
