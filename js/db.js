// ---------- Database (stored privately on your device) ----------
const DB_PLAIN = "ExpenseTrackerDB";
const DB_SECURE = "ExpenseTrackerSecure";

// The three starting accounts (you can rename them in Settings)
const DEFAULT_ACCOUNTS = [
  { id: "cash",     name: "Cash",      icon: "💵", opening: 0, order: 1 },
  { id: "digital1", name: "Digital 1", icon: "📱", opening: 0, order: 2 },
  { id: "digital2", name: "Digital 2", icon: "💳", opening: 0, order: 3 }
];

// ----- The normal (not encrypted) database -----
function makePlainDb() {
  const d = new Dexie(DB_PLAIN);

  // Older versions are kept so existing data upgrades safely
  d.version(1).stores({
    transactions: "++id, type, category, date"
  });

  d.version(2).stores({
    transactions: "++id, type, category, date",
    categories: "++id, type, name"
  });

  d.version(3).stores({
    transactions: "++id, type, category, date",
    categories: "++id, type, name",
    budgets: "category"
  });

  // Version 4 (App 2.0): accounts, transfers, recurring entries, goals
  d.version(4)
    .stores({
      transactions: "++id, type, category, date, accountId",
      categories: "++id, type, name",
      budgets: "category",
      accounts: "id, order",
      transfers: "++id, date, fromId, toId",
      recurring: "++id, nextDue",
      goals: "++id"
    })
    .upgrade(async (tx) => {
      // Every existing entry moves into Cash
      await tx.table("transactions").toCollection().modify((t) => {
        if (!t.accountId) t.accountId = "cash";
      });
      await tx.table("accounts").bulkPut(DEFAULT_ACCOUNTS);
    });

  // Brand-new installs start with the three accounts
  d.on("populate", (tx) => {
    tx.table("accounts").bulkAdd(DEFAULT_ACCOUNTS);
  });

  return d;
}

// ----- The encrypted database: no readable columns, only row numbers -----
const SECURE_STORES = {
  transactions: "++id",
  categories: "++id",
  budgets: "++id",
  accounts: "id",
  transfers: "++id",
  recurring: "++id",
  goals: "++id"
};

function makeSecureDb() {
  const d = new Dexie(DB_SECURE);
  d.version(1).stores(SECURE_STORES);
  d.use(Vault.middleware());
  return d;
}

const db = Vault.isEnabled() ? makeSecureDb() : makePlainDb();

// ---------- Transactions ----------
async function addTransaction(tx) {
  if (!tx.accountId) tx.accountId = "cash";
  return db.transactions.add(tx);
}

async function updateTransaction(id, changes) {
  return db.transactions.update(id, changes);
}

async function deleteTransaction(id) {
  return db.transactions.delete(id);
}

// Returns all transactions, newest first
async function getAllTransactions() {
  const list = await db.transactions.toArray();
  return list.sort((a, b) => {
    if (a.date === b.date) return b.id - a.id;
    return a.date < b.date ? 1 : -1;
  });
}

// ---------- Accounts ----------
async function getAccounts() {
  const list = await db.accounts.toArray();
  return list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

async function updateAccount(id, changes) {
  return db.accounts.update(id, changes);
}

// ---------- Custom categories ----------
async function getCustomCategories() {
  return db.categories.toArray();
}

async function addCustomCategory(cat) {
  return db.categories.add(cat);
}

// ---------- Budgets ----------
async function getBudgets() {
  return db.budgets.toArray();
}

async function setBudget(category, amount) {
  const found = (await db.budgets.toArray()).find((b) => b.category === category);
  if (found && found.id !== undefined) {
    return db.budgets.put({ id: found.id, category: category, amount: amount });
  }
  return db.budgets.put({ category: category, amount: amount });
}

async function deleteBudget(category) {
  const found = (await db.budgets.toArray()).find((b) => b.category === category);
  if (found && found.id !== undefined) return db.budgets.delete(found.id);
  return db.budgets.delete(category);
}

// ---------- Transfers between accounts ----------
async function getAllTransfers() {
  return db.transfers.toArray();
}

async function addTransfer(t) {
  return db.transfers.add(t);
}

async function updateTransfer(id, changes) {
  return db.transfers.update(id, changes);
}

async function deleteTransfer(id) {
  return db.transfers.delete(id);
}

// ---------- Recurring entries ----------
async function getRecurring() {
  return db.recurring.toArray();
}

async function addRecurring(r) {
  return db.recurring.add(r);
}

async function updateRecurring(id, changes) {
  return db.recurring.update(id, changes);
}

async function deleteRecurring(id) {
  return db.recurring.delete(id);
}

// ---------- Savings goals ----------
async function getGoals() {
  return db.goals.toArray();
}

async function addGoal(g) {
  return db.goals.add(g);
}

async function deleteGoal(id) {
  return db.goals.delete(id);
}

// =====================================================
//  TURNING ON ENCRYPTION (one time)
// =====================================================
const DATA_TABLES = ["transactions", "categories", "budgets", "accounts", "transfers", "recurring", "goals"];

// A stable text form of a row, used to compare before and after
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") {
    return (
      "{" +
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canon(v[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v);
}

// Copies everything into an encrypted database, checks every row,
// and only then switches over and removes the readable copy.
async function enableVault(secret, type, onStep) {
  if (Vault.isEnabled()) throw new Error("Encryption is already on.");
  const step = onStep || function () {};

  step("Reading your data…");
  const plain = {};
  for (const t of DATA_TABLES) plain[t] = await db[t].toArray();

  step("Creating your key… (this takes a moment)");
  const made = await Vault.create(secret, type);
  Vault.useKey(made.key);

  const sdb = makeSecureDb();
  try {
    step("Encrypting your data…");
    await sdb.open();
    await sdb.transaction("rw", DATA_TABLES.map((t) => sdb[t]), async () => {
      for (const t of DATA_TABLES) await sdb[t].clear();
      for (const t of DATA_TABLES) {
        const rows = plain[t].map((r) =>
          t === "budgets" ? { category: r.category, amount: r.amount } : r
        );
        if (rows.length) await sdb[t].bulkAdd(rows);
      }
    });

    step("Checking every entry…");
    for (const t of DATA_TABLES) {
      let back = await sdb[t].toArray();
      let want = plain[t];
      if (t === "budgets") {
        back = back.map((r) => ({ category: r.category, amount: r.amount }));
        want = want.map((r) => ({ category: r.category, amount: r.amount }));
      }
      const a = back.map(canon).sort().join("\n");
      const b = want.map(canon).sort().join("\n");
      if (back.length !== want.length || a !== b) {
        throw new Error("The check failed for " + t + ". Nothing was changed.");
      }
    }
    sdb.close();
  } catch (err) {
    try { sdb.close(); } catch (e) {}
    try { await Dexie.delete(DB_SECURE); } catch (e) {}
    Vault.lockKey();
    throw err;
  }

  // Everything checked out: switch over
  Vault.saveHeader(made.header);
  try {
    localStorage.removeItem("et_pin");
    localStorage.removeItem("et_fail");
  } catch (e) {}

  step("Removing the readable copy…");
  let cleaned = true;
  try {
    db.close();
    await Dexie.delete(DB_PLAIN);
  } catch (e) {
    cleaned = false;
  }
  return { cleaned: cleaned };
}
