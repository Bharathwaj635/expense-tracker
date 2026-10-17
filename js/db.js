// ---------- Database (stored privately on your device) ----------
const db = new Dexie("ExpenseTrackerDB");

// Older versions are kept so your existing data upgrades safely
db.version(1).stores({
  transactions: "++id, type, category, date"
});

db.version(2).stores({
  transactions: "++id, type, category, date",
  categories: "++id, type, name"
});

// Version 3 adds budgets (one limit per category)
db.version(3).stores({
  transactions: "++id, type, category, date",
  categories: "++id, type, name",
  budgets: "category"
});

async function addTransaction(tx) {
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
  return db.budgets.put({ category: category, amount: amount });
}

async function deleteBudget(category) {
  return db.budgets.delete(category);
}