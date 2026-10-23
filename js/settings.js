// ---------- Settings: theme, security, backup, accounts, categories ----------
(function () {
  const THEME_KEY = "et_theme";
  const BACKUP_KEY = "et_last_backup";
  const root = document.documentElement;

  function readKey(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function saveKey(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }

  // =====================================================
  //  THEME
  // =====================================================
  function applyTheme(t) {
    root.dataset.theme = t;
    saveKey(THEME_KEY, t);
  }

  // =====================================================
  //  BACKUP AND RESTORE
  // =====================================================
  function download(filename, text, type) {
    const blob = new Blob([text], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function backupObject() {
    return {
      app: "expense-tracker",
      version: 2,
      exportedAt: new Date().toISOString(),
      transactions: await db.transactions.toArray(),
      categories: await db.categories.toArray(),
      budgets: await db.budgets.toArray(),
      accounts: await db.accounts.toArray(),
      transfers: await db.transfers.toArray(),
      recurring: await db.recurring.toArray(),
      goals: await db.goals.toArray()
    };
  }

  // Readable backup (anyone with the file can read it)
  async function exportPlain() {
    if (!confirm(
      "This backup file is NOT encrypted. Anyone who gets the file can read all your entries.\n\n" +
      "Tip: use \"Export encrypted backup\" instead.\n\nContinue?"
    )) return;

    download(
      "expense-backup-" + todayString() + ".json",
      JSON.stringify(await backupObject(), null, 2),
      "application/json"
    );
    saveKey(BACKUP_KEY, todayString());
    renderSettings();
  }

  // Encrypted backup (needs its own passphrase to open)
  async function exportEncrypted() {
    const pass = await Lock.askSecret({
      title: "Backup passphrase",
      hint: "You will need this passphrase to restore the backup. It cannot be recovered, so keep it safe. It can be different from your app code.",
      confirm: true,
      min: 8,
      check: (v) => Vault.checkCode(v, "pass")
    });
    if (!pass) return;

    const wrapped = await Vault.encryptBackup(JSON.stringify(await backupObject()), pass);
    download(
      "expense-backup-" + todayString() + "-encrypted.json",
      JSON.stringify(wrapped),
      "application/json"
    );
    saveKey(BACKUP_KEY, todayString());
    renderSettings();
  }

  function csvCell(v) {
    let s = String(v === undefined || v === null ? "" : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // keeps spreadsheets from running text as formulas
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  async function exportCSV() {
    if (!confirm("The CSV file is NOT encrypted. Anyone who gets the file can read it.\n\nContinue?")) return;

    const list = await getAllTransactions();
    const names = {};
    (await db.accounts.toArray()).forEach((a) => { names[a.id] = a.name; });

    const rows = ["Date,Type,Category,Amount (INR),Account,Note"];
    list.forEach((t) => {
      rows.push(
        [t.date, t.type, t.category, t.amount, names[t.accountId] || "Cash", t.note]
          .map(csvCell)
          .join(",")
      );
    });
    download(
      "expenses-" + todayString() + ".csv",
      "\uFEFF" + rows.join("\r\n"),
      "text/csv;charset=utf-8"
    );
  }

  // Keeps only plain objects from a list in a backup file
  function plainList(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter((o) => o && typeof o === "object" && !Array.isArray(o))
      .slice(0, 20000)
      .map((o) => {
        const copy = JSON.parse(JSON.stringify(o));
        if (!(Number.isInteger(copy.id) && copy.id > 0)) delete copy.id;
        return copy;
      });
  }

  async function importBackup(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      alert("That file is not a valid backup.");
      return;
    }

    // Encrypted backups need their passphrase first
    if (data && data.encrypted === true) {
      const pass = await Lock.askSecret({
        title: "Backup passphrase",
        hint: "Enter the passphrase you chose when you made this backup."
      });
      if (!pass) return;
      try {
        data = JSON.parse(await Vault.decryptBackup(data, pass));
      } catch (e) {
        alert("Wrong passphrase, or the file is damaged.");
        return;
      }
    }

    if (!data || data.app !== "expense-tracker" || !Array.isArray(data.transactions)) {
      alert("That file is not an Expense Tracker backup.");
      return;
    }

    // ----- accounts (old Version 1 backups have none, so use the defaults) -----
    let accts = (Array.isArray(data.accounts) ? data.accounts : [])
      .filter((a) => a && typeof a.id === "string" && /^[a-z0-9_-]{1,30}$/.test(a.id) && a.name)
      .map((a, i) => ({
        id: a.id,
        name: String(a.name).slice(0, 30),
        icon: String(a.icon || "💰").slice(0, 8),
        opening: Number(a.opening) || 0,
        order: Number(a.order) || i + 1
      }));
    if (accts.length === 0) accts = DEFAULT_ACCOUNTS.map((a) => ({ ...a }));

    const accountIds = new Set(accts.map((a) => a.id));
    const fallbackId = accountIds.has("cash") ? "cash" : accts[0].id;

    // ----- transactions -----
    const txs = data.transactions
      .filter(
        (t) =>
          t &&
          (t.type === "expense" || t.type === "income") &&
          Number(t.amount) > 0 &&
          typeof t.category === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(t.date)
      )
      .map((t) => ({
        type: t.type,
        amount: Number(t.amount),
        category: t.category,
        date: t.date,
        note: String(t.note || ""),
        accountId: accountIds.has(t.accountId) ? t.accountId : fallbackId
      }));

    // ----- categories and budgets -----
    const cats = (Array.isArray(data.categories) ? data.categories : [])
      .filter((c) => c && c.name && (c.type === "expense" || c.type === "income"))
      .map((c) => ({ type: c.type, name: String(c.name), icon: String(c.icon || "🏷️") }));

    const buds = (Array.isArray(data.budgets) ? data.budgets : [])
      .filter((b) => b && b.category && Number(b.amount) > 0)
      .map((b) => ({ category: String(b.category), amount: Number(b.amount) }));

    // ----- transfers between accounts -----
    const transfers = (Array.isArray(data.transfers) ? data.transfers : [])
      .filter(
        (t) =>
          t &&
          accountIds.has(t.fromId) &&
          accountIds.has(t.toId) &&
          t.fromId !== t.toId &&
          Number(t.amount) > 0 &&
          /^\d{4}-\d{2}-\d{2}$/.test(t.date)
      )
      .map((t) => ({
        date: t.date,
        fromId: t.fromId,
        toId: t.toId,
        amount: Number(t.amount),
        note: String(t.note || "")
      }));

    // ----- recurring entries and goals -----
    const recurring = plainList(data.recurring);
    const goals = plainList(data.goals);

    const ok = confirm(
      "This will REPLACE everything in the app with the backup:\n\n" +
        txs.length + " transactions, " + cats.length + " custom categories, " +
        buds.length + " budgets, " + accts.length + " accounts, " +
        transfers.length + " transfers.\n\nContinue?"
    );
    if (!ok) return;

    await db.transaction(
      "rw",
      db.transactions, db.categories, db.budgets,
      db.accounts, db.transfers, db.recurring, db.goals,
      async () => {
        await db.transactions.clear();
        await db.categories.clear();
        await db.budgets.clear();
        await db.accounts.clear();
        await db.transfers.clear();
        await db.recurring.clear();
        await db.goals.clear();

        await db.accounts.bulkAdd(accts);
        await db.transactions.bulkAdd(txs);
        await db.categories.bulkAdd(cats);
        await db.budgets.bulkPut(buds);
        await db.transfers.bulkAdd(transfers);
        await db.recurring.bulkAdd(recurring);
        await db.goals.bulkAdd(goals);
      }
    );

    customCats = await getCustomCategories();
    fillFilterCategories();
    await refresh();
    renderSettings();
    if (window.reloadRules) await window.reloadRules();
    alert("Backup restored.");
  }

  // =====================================================
  //  ACCOUNTS (rename, emoji, opening balance)
  // =====================================================
  function fillAccountPreview() {
    const box = document.getElementById("acctPreview");
    if (!box) return;

    const upTo = viewMonth + "-31";
    box.innerHTML =
      accounts
        .map((a) => {
          const bal = balanceFor([a.id], upTo);
          return `
        <div class="cat-row acct-edit" data-act="editacct" data-id="${escapeHtml(a.id)}">
          <span class="tx-icon">${escapeHtml(a.icon)}</span>
          <span class="grow"><b>${escapeHtml(a.name)}</b><br><small>Balance ${formatINR(bal)} • Opening ${formatINR(Number(a.opening) || 0)}</small></span>
          <span>✏️</span>
        </div>`;
        })
        .join("") +
      "<small>Tap an account to rename it, change its emoji, or set its opening balance (money you already had in it before you started tracking).</small>";
  }

  async function editAccount(id) {
    const a = accounts.find((x) => x.id === id);
    if (!a) return;

    const name = prompt("Account name:", a.name);
    if (name === null) return;

    const icon = prompt("One emoji for this account:", a.icon);
    if (icon === null) return;

    const op = prompt(
      "Opening balance in ₹\n(money already in this account before you started tracking):",
      a.opening || 0
    );
    if (op === null) return;

    const opening = Number(String(op).replace(/,/g, "").trim() || 0);
    if (!name.trim() || isNaN(opening)) {
      alert("Please enter a valid name and number.");
      return;
    }

    await updateAccount(id, {
      name: name.trim().slice(0, 30),
      icon: (icon.trim() || a.icon).slice(0, 8),
      opening: opening
    });

    await refresh();
    renderSettings();
  }

  // =====================================================
  //  SETTINGS SCREEN
  // =====================================================
  function securityHtml() {
    const s = Lock.state();
    const auto = String(Lock.getAutoLock());
    const autoBtn = (value, label) =>
      `<button data-act="autolock" data-value="${value}" class="${auto === value ? "active" : ""}">${label}</button>`;

    const autoBlock = `
        <p class="sub-label">Auto-lock</p>
        <div class="seg">
          ${autoBtn("0", "Right away")}
          ${autoBtn("1", "1 min")}
          ${autoBtn("5", "5 min")}
          ${autoBtn("15", "15 min")}
        </div>
        <small>Right away locks the app as soon as you leave it. The other choices lock it after you have been away or untouched for that long.</small>`;

    if (s.kind === "vault") {
      return `
        <p>🔐 Encryption is <b>ON</b> (AES-256)</p>
        <p>Your code: <b>${s.type === "digits" ? s.len + " digits" : "passphrase"}</b></p>
        ${
          s.type === "digits"
            ? '<p class="warn-note">A 6-digit code can be guessed quickly by someone who copies your stored data. A passphrase of four or more random words is far stronger. Tap "Switch to a passphrase".</p>'
            : ""
        }
        <button class="set-btn main" data-act="locknow">🔒 Lock now</button>
        ${
          s.type === "digits"
            ? `<button class="set-btn" data-act="change" data-type="pass">Switch to a passphrase (stronger)</button>
               <button class="set-btn" data-act="change" data-type="digits">Change 6-digit code</button>`
            : `<button class="set-btn" data-act="change" data-type="pass">Change passphrase</button>
               <button class="set-btn" data-act="change" data-type="digits">Switch to a 6-digit code</button>`
        }
        ${autoBlock}`;
    }

    if (s.kind === "legacy") {
      return `
        <p>PIN lock is <b>ON</b> (${s.len} digits)</p>
        <p class="warn-note">This PIN only covers the screen. Your data is <b>not encrypted</b>. Tap one of the encryption buttons below to protect it properly.</p>
        <button class="set-btn main" data-act="setup" data-type="pass">🔐 Encrypt with a passphrase (strongest)</button>
        <button class="set-btn" data-act="setup" data-type="digits">🔐 Encrypt with a 6-digit code</button>
        <button class="set-btn" data-act="locknow">🔒 Lock now</button>
        <button class="set-btn danger" data-act="removepin">Remove PIN</button>
        ${autoBlock}`;
    }

    return `
        <p>Lock and encryption are <b>OFF</b>. Your data is stored readable on this device.</p>
        <button class="set-btn main" data-act="setup" data-type="pass">🔐 Encrypt with a passphrase (strongest)</button>
        <button class="set-btn" data-act="setup" data-type="digits">🔐 Encrypt with a 6-digit code</button>`;
  }

  function renderSettings() {
    const theme = readKey(THEME_KEY) || "auto";
    const last = readKey(BACKUP_KEY);

    const themeBtn = (value, label) =>
      `<button data-act="theme" data-value="${value}" class="${theme === value ? "active" : ""}">${label}</button>`;

    const catRows = customCats.length
      ? customCats
          .map(
            (c) => `
        <div class="cat-row">
          <span class="tx-icon">${escapeHtml(c.icon)}</span>
          <span class="grow"><b>${escapeHtml(c.name)}</b><br><small>${c.type === "income" ? "Income" : "Expense"}</small></span>
          <button class="cat-del" data-act="delcat" data-id="${c.id}" aria-label="Delete category">🗑️</button>
        </div>`
          )
          .join("")
      : "<p>You haven't created any custom categories yet.</p>";

    $("settingsBody").innerHTML = `
      <h3 class="set-title">Appearance</h3>
      <div class="card">
        <p>Theme</p>
        <div class="seg">
          ${themeBtn("auto", "Auto")}
          ${themeBtn("light", "☀️ Light")}
          ${themeBtn("dark", "🌙 Dark")}
        </div>
      </div>

      <h3 class="set-title">Security</h3>
      <div class="card">
        ${securityHtml()}
        <small>After 3 wrong tries the keypad locks for a short time, and the wait grows with more wrong tries. <b>If you forget your code, your data cannot be recovered.</b> Keep an encrypted backup and remember its passphrase.</small>
      </div>

      <h3 class="set-title">Accounts</h3>
      <div class="card" id="acctPreview"><p>Loading…</p></div>

      <h3 class="set-title">Recurring entries</h3>
      <div class="card" id="recurringCard"></div>

      <h3 class="set-title">Backup</h3>
      <div class="card">
        <p>${allTx.length} transactions saved on this device.</p>
        <button class="set-btn main" data-act="exportenc">🔐 Export encrypted backup</button>
        <button class="set-btn" data-act="exportjson">📤 Export readable backup (JSON)</button>
        <button class="set-btn" data-act="exportcsv">📄 Export for Excel (CSV)</button>
        <label class="set-btn" for="importFile" id="importLabel">📥 Restore from backup</label>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
        <small>${last ? "Last backup: " + prettyDate(last) : "No backup yet. Make one now!"}</small>
      </div>

      <h3 class="set-title">My categories</h3>
      <div class="card">${catRows}</div>

      <h3 class="set-title">About</h3>
      <div class="card">
        <p>🔒 All data stays on this device. No internet, no accounts, no tracking.</p>
      </div>
    `;

    fillAccountPreview();
    if (window.fillRecurringCard) window.fillRecurringCard();
  }

  // Make renderSettings available to the other files
  window.renderSettings = renderSettings;

  $("settingsBody").addEventListener("click", async (e) => {
    // The phone's file picker can hide the app for a moment: do not lock under it
    if (e.target.closest("#importLabel")) Lock.pause(180);

    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;

    if (act === "theme") {
      applyTheme(el.dataset.value);
      renderSettings();
    } else if (act === "setup") {
      Lock.setup(el.dataset.type);
    } else if (act === "change") {
      Lock.change(el.dataset.type);
    } else if (act === "removepin") {
      Lock.removeLegacy();
    } else if (act === "locknow") {
      Lock.lockNow();
    } else if (act === "autolock") {
      Lock.setAutoLock(el.dataset.value);
      renderSettings();
    } else if (act === "exportenc") {
      await exportEncrypted();
    } else if (act === "exportjson") {
      await exportPlain();
    } else if (act === "exportcsv") {
      await exportCSV();
    } else if (act === "editacct") {
      await editAccount(el.dataset.id);
    } else if (act === "delcat") {
      const c = customCats.find((x) => x.id === Number(el.dataset.id));
      if (!c) return;
      if (!confirm('Delete the category "' + c.name + '"?\nOld transactions keep its name.')) return;

      await db.categories.delete(c.id);
      if (c.type === "expense") await deleteBudget(c.name);

      customCats = await getCustomCategories();
      fillFilterCategories();
      await refresh();
      renderSettings();
    }
  });

  $("settingsBody").addEventListener("change", async (e) => {
    if (e.target.id === "importFile" && e.target.files[0]) {
      await importBackup(e.target.files[0]);
      e.target.value = "";
    }
  });

  renderSettings();
})();
