// ---------- Settings: theme, PIN lock, backup, categories ----------
(function () {
  const root = document.documentElement;
  const PIN_KEY = "et_pin";
  const THEME_KEY = "et_theme";
  const BACKUP_KEY = "et_last_backup";

  // ----- tiny helpers for saving small settings on this device -----
  function readKey(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function saveKey(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }
  function removeKey(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  }

  // =====================================================
  //  THEME
  // =====================================================
  function applyTheme(t) {
    root.dataset.theme = t;
    saveKey(THEME_KEY, t);
  }

  // =====================================================
  //  PIN LOCK
  // =====================================================
  let pinMode = "unlock";   // unlock | verify | new | confirm
  let entered = "";
  let firstPin = "";
  let afterVerify = null;
  let busy = false;

  function getPin() {
    try {
      const p = JSON.parse(readKey(PIN_KEY));
      return p && p.salt && p.hash ? p : null;
    } catch (e) {
      return null;
    }
  }

  function makeSalt() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(salt + ":" + pin);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function drawDots() {
    [...$("dots").children].forEach((d, i) => {
      d.classList.toggle("on", i < entered.length);
    });
  }

  function setMsg(text) {
    $("lockMsg").textContent = text || "";
  }

  function openPad(mode, title, cancellable) {
    pinMode = mode;
    entered = "";
    busy = false;
    $("lockTitle").textContent = title;
    $("lockCancel").hidden = !cancellable;
    setMsg("");
    drawDots();
    root.classList.add("locked");
  }

  function closePad() {
    root.classList.remove("locked");
    entered = "";
    firstPin = "";
    afterVerify = null;
    busy = false;
    drawDots();
  }

  function wrongPin(message) {
    setMsg(message);
    entered = "";
    const dots = $("dots");
    dots.classList.remove("shake");
    void dots.offsetWidth; // restart the animation
    dots.classList.add("shake");
    drawDots();
    busy = false;
  }

  async function submitPin() {
    const pin = entered;
    busy = true;

    try {
      if (pinMode === "unlock" || pinMode === "verify") {
        const saved = getPin();
        if (!saved) { closePad(); return; }

        const ok = (await hashPin(pin, saved.salt)) === saved.hash;
        if (!ok) { wrongPin("Wrong PIN, try again"); return; }

        if (pinMode === "unlock") {
          closePad();
        } else {
          const next = afterVerify;
          afterVerify = null;
          busy = false;
          if (next) next();
        }
      } else if (pinMode === "new") {
        firstPin = pin;
        openPad("confirm", "Confirm your PIN", true);
      } else if (pinMode === "confirm") {
        if (pin !== firstPin) {
          openPad("new", "Create a 4-digit PIN", true);
          setMsg("PINs did not match. Start again.");
          return;
        }
        const salt = makeSalt();
        saveKey(PIN_KEY, JSON.stringify({ salt: salt, hash: await hashPin(pin, salt) }));
        closePad();
        renderSettings();
        alert("PIN lock is on. The app will ask for it every time you open it.");
      }
    } catch (err) {
      busy = false;
      closePad();
      alert("PIN lock could not run here. It needs a secure page (https or localhost).");
    }
  }

  function pressKey(k) {
    if (busy) return;
    if (k === "back") {
      entered = entered.slice(0, -1);
    } else if (entered.length < 4) {
      entered += k;
    }
    drawDots();
    if (entered.length === 4) setTimeout(submitPin, 120);
  }

  $("keypad").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (b) pressKey(b.dataset.key);
  });

  $("lockCancel").addEventListener("click", closePad);

  // Keyboard support on a computer
  document.addEventListener("keydown", (e) => {
    if (!root.classList.contains("locked")) return;
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === "Backspace") pressKey("back");
    else if (e.key === "Escape" && !$("lockCancel").hidden) closePad();
  });

  // Lock again whenever you leave the app and come back
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && getPin()) openPad("unlock", "Enter PIN", false);
  });

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

  async function exportJSON() {
    const data = {
      app: "expense-tracker",
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: await db.transactions.toArray(),
      categories: await db.categories.toArray(),
      budgets: await db.budgets.toArray()
    };
    download(
      "expense-backup-" + todayString() + ".json",
      JSON.stringify(data, null, 2),
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
    const list = await getAllTransactions();
    const rows = ["Date,Type,Category,Amount (INR),Note"];
    list.forEach((t) => {
      rows.push([t.date, t.type, t.category, t.amount, t.note].map(csvCell).join(","));
    });
    download(
      "expenses-" + todayString() + ".csv",
      "\uFEFF" + rows.join("\r\n"),
      "text/csv;charset=utf-8"
    );
  }

  async function importBackup(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      alert("That file is not a valid backup.");
      return;
    }

    if (!data || data.app !== "expense-tracker" || !Array.isArray(data.transactions)) {
      alert("That file is not an Expense Tracker backup.");
      return;
    }

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
        note: String(t.note || "")
      }));

    const cats = (Array.isArray(data.categories) ? data.categories : [])
      .filter((c) => c && c.name && (c.type === "expense" || c.type === "income"))
      .map((c) => ({ type: c.type, name: String(c.name), icon: String(c.icon || "🏷️") }));

    const buds = (Array.isArray(data.budgets) ? data.budgets : [])
      .filter((b) => b && b.category && Number(b.amount) > 0)
      .map((b) => ({ category: String(b.category), amount: Number(b.amount) }));

    const ok = confirm(
      "This will REPLACE everything in the app with the backup:\n\n" +
        txs.length + " transactions, " + cats.length + " custom categories, " +
        buds.length + " budgets.\n\nContinue?"
    );
    if (!ok) return;

    await db.transaction("rw", db.transactions, db.categories, db.budgets, async () => {
      await db.transactions.clear();
      await db.categories.clear();
      await db.budgets.clear();
      await db.transactions.bulkAdd(txs);
      await db.categories.bulkAdd(cats);
      await db.budgets.bulkPut(buds);
    });

    customCats = await getCustomCategories();
    fillFilterCategories();
    await refresh();
    renderSettings();
    alert("Backup restored.");
  }

  // =====================================================
  //  SETTINGS SCREEN
  // =====================================================
  function renderSettings() {
    const theme = readKey(THEME_KEY) || "auto";
    const hasPin = !!getPin();
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
        <p>PIN lock is <b>${hasPin ? "ON" : "OFF"}</b></p>
        ${
          hasPin
            ? `<button class="set-btn" data-act="changepin">Change PIN</button>
               <button class="set-btn danger" data-act="removepin">Remove PIN</button>`
            : `<button class="set-btn main" data-act="setpin">Set a 4-digit PIN</button>`
        }
        <small>The PIN keeps others out of the app. If you forget it, clearing this site's data in Chrome removes it, along with all your entries, so keep a backup.</small>
      </div>

      <h3 class="set-title">Backup</h3>
      <div class="card">
        <p>${allTx.length} transactions saved on this device.</p>
        <button class="set-btn main" data-act="exportjson">📤 Export backup (JSON)</button>
        <button class="set-btn" data-act="exportcsv">📄 Export for Excel (CSV)</button>
        <label class="set-btn" for="importFile">📥 Restore from backup</label>
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
  }

  // Make renderSettings available to app.js
  window.renderSettings = renderSettings;

  $("settingsBody").addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;

    if (act === "theme") {
      applyTheme(el.dataset.value);
      renderSettings();
    } else if (act === "setpin") {
      openPad("new", "Create a 4-digit PIN", true);
    } else if (act === "changepin") {
      afterVerify = () => openPad("new", "Enter your new PIN", true);
      openPad("verify", "Enter current PIN", true);
    } else if (act === "removepin") {
      afterVerify = () => {
        removeKey(PIN_KEY);
        closePad();
        renderSettings();
        alert("PIN lock removed.");
      };
      openPad("verify", "Enter PIN to remove lock", true);
    } else if (act === "exportjson") {
      await exportJSON();
    } else if (act === "exportcsv") {
      await exportCSV();
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

  // ----- on start -----
  // If the lock was switched on by the page header but no valid PIN exists, unlock.
  if (!getPin()) root.classList.remove("locked");
  renderSettings();
})();