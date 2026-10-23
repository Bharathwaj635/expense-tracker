// ---------- Recurring entries (the app always asks before adding) ----------
(function () {
  const FREQS = ["daily", "weekly", "monthly", "yearly"];
  const FREQ_LABEL = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  let rules = [];
  let busy = false;
  let editingRuleId = null;

  const byId = (id) => document.getElementById(id);

  // ----- date helpers -----
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toStr(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function daysIn(y, m) {
    return new Date(y, m, 0).getDate(); // m is 1 to 12
  }

  function validDate(s) {
    if (typeof s !== "string" || !DATE_RE.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  // The date after "dateStr". "anchor" is the day of the month you chose,
  // so a rent on the 31st lands on the last day of shorter months.
  function nextDate(dateStr, freq, anchor) {
    const [y, m, d] = dateStr.split("-").map(Number);

    if (freq === "daily") return toStr(new Date(y, m - 1, d + 1));
    if (freq === "weekly") return toStr(new Date(y, m - 1, d + 7));

    if (freq === "monthly") {
      let ny = y;
      let nm = m + 1;
      if (nm > 12) { nm = 1; ny++; }
      return ny + "-" + pad(nm) + "-" + pad(Math.min(anchor, daysIn(ny, nm)));
    }

    // yearly
    const yy = y + 1;
    return yy + "-" + pad(m) + "-" + pad(Math.min(anchor, daysIn(yy, m)));
  }

  // ----- keep only valid entries (also protects against bad backup files) -----
  function clean(r) {
    if (!r || !Number.isInteger(r.id)) return null;
    if (r.type !== "expense" && r.type !== "income") return null;
    const amount = Number(r.amount);
    if (!(amount > 0)) return null;
    if (!FREQS.includes(r.frequency)) return null;
    if (!validDate(r.nextDue)) return null;

    const anchor = Number(r.anchorDay);
    return {
      id: r.id,
      type: r.type,
      amount: amount,
      category: String(r.category || "Other").slice(0, 40),
      accountId: String(r.accountId || "cash").slice(0, 30),
      note: String(r.note || "").slice(0, 80),
      frequency: r.frequency,
      nextDue: r.nextDue,
      anchorDay: anchor >= 1 && anchor <= 31 ? anchor : Number(r.nextDue.slice(8, 10)),
      active: r.active !== false
    };
  }

  async function reloadRules() {
    const raw = await getRecurring();
    rules = raw
      .map(clean)
      .filter(Boolean)
      .sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1));
    renderDue();
    fillRecurringCard();
  }

  function realAccount(id) {
    return accounts.some((a) => a.id === id) ? id : "cash";
  }

  // How many dates are waiting for this entry (counts up to 60)
  function dueInfo(r) {
    const today = todayString();
    let count = 0;
    let d = r.nextDue;
    while (d <= today && count < 60) {
      count++;
      d = nextDate(d, r.frequency, r.anchorDay);
    }
    return { count: count, capped: d <= today };
  }

  // =====================================================
  //  "DUE NOW" CARDS ON HOME
  // =====================================================
  function renderDue() {
    const box = byId("dueCards");
    if (!box) return;
    if (!accounts.length) return; // app is still starting

    const today = todayString();
    const due = rules.filter((r) => r.active && r.nextDue <= today);

    if (!due.length) {
      box.innerHTML = "";
      return;
    }

    box.innerHTML =
      "<h2>Due now</h2>" +
      due
        .map((r) => {
          const info = dueInfo(r);
          const sign = r.type === "income" ? "+" : "-";
          const acct = realAccount(r.accountId);
          const title = escapeHtml(r.note || r.category);
          let more = "";
          if (info.capped) more = '<p class="more">Many more dates are waiting after this one</p>';
          else if (info.count > 1) more = `<p class="more">${info.count - 1} more due after this</p>`;

          return `
        <div class="due-card">
          <div class="due-top">
            <div class="tx-icon">🔁</div>
            <div class="tx-info">
              <b>${title}</b>
              <small>Due ${prettyDate(r.nextDue)} • ${FREQ_LABEL[r.frequency]} • ${escapeHtml(acctIcon(acct))} ${escapeHtml(acctName(acct))}</small>
            </div>
            <div class="tx-amount ${r.type}">${sign}${formatINR(r.amount)}</div>
          </div>
          ${more}
          <div class="due-actions">
            <button class="go" data-do="add" data-id="${r.id}">✅ Add</button>
            <button data-do="edit" data-id="${r.id}">✏️ Edit amount</button>
            <button data-do="skip" data-id="${r.id}">⏭ Skip</button>
          </div>
        </div>`;
        })
        .join("");
  }

  async function advance(r) {
    await updateRecurring(r.id, {
      nextDue: nextDate(r.nextDue, r.frequency, r.anchorDay)
    });
  }

  byId("dueCards").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-do]");
    if (!b || busy) return;

    const r = rules.find((x) => x.id === Number(b.dataset.id));
    if (!r) return;

    busy = true;
    try {
      const action = b.dataset.do;

      if (action === "skip") {
        await advance(r);
      } else {
        let amount = r.amount;

        if (action === "edit") {
          const answer = prompt(
            "Amount in ₹ for " + prettyDate(r.nextDue) + " only:\n(to change it for every time, edit it in Settings)",
            r.amount
          );
          if (answer === null) return; // Cancel pressed
          amount = Number(String(answer).replace(/,/g, "").trim());
          if (!(amount > 0)) {
            alert("Please enter an amount greater than 0.");
            return;
          }
        }

        // Add the entry and move to the next date together, so it can never happen twice
        await db.transaction("rw", db.transactions, db.recurring, async () => {
          await addTransaction({
            type: r.type,
            amount: amount,
            category: r.category,
            accountId: realAccount(r.accountId),
            date: r.nextDue,
            note: r.note
          });
          await advance(r);
        });
      }

      await reloadRules();
      await refresh();
    } finally {
      busy = false;
    }
  });

  // =====================================================
  //  SETTINGS LIST
  // =====================================================
  function fillRecurringCard() {
    const box = byId("recurringCard");
    if (!box) return;

    const rows = rules.length
      ? rules
          .map((r) => {
            const sign = r.type === "income" ? "+" : "-";
            const when = r.active ? "next " + prettyDate(r.nextDue) : "Paused";
            return `
        <div class="cat-row rec-row" data-rec="edit" data-id="${r.id}">
          <span class="tx-icon">${escapeHtml(iconFor(r.type, r.category))}</span>
          <span class="grow"><b>${escapeHtml(r.note || r.category)}</b><br><small>${sign}${formatINR(r.amount)} • ${FREQ_LABEL[r.frequency]} • ${when}</small></span>
          <span>✏️</span>
        </div>`;
          })
          .join("")
      : "<p>No recurring entries yet.</p>";

    box.innerHTML =
      rows +
      `<button class="set-btn main" data-rec="new">➕ Add recurring entry</button>
       <small>Nothing is added on its own. When an entry is due, a card on Home asks you to Add, Edit, or Skip it.</small>`;
  }

  byId("settingsBody").addEventListener("click", (e) => {
    const el = e.target.closest("[data-rec]");
    if (!el) return;

    if (el.dataset.rec === "new") {
      openForm(null);
    } else {
      const r = rules.find((x) => x.id === Number(el.dataset.id));
      if (r) openForm(r);
    }
  });

  // =====================================================
  //  ADD / EDIT FORM
  // =====================================================
  const modal = byId("recModal");
  const nameInput = byId("recName");
  const typeSelect = byId("recType");
  const amountInput = byId("recAmount");
  const catSelect = byId("recCategory");
  const acctSelect = byId("recAccount");
  const freqSelect = byId("recFreq");
  const dateInput = byId("recDate");
  const activeBox = byId("recActive");
  const deleteBtn = byId("recDelete");

  function fillRecCategories(type, selected) {
    const cats = categoriesFor(type);
    let html = cats
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.icon)} ${escapeHtml(c.name)}</option>`)
      .join("");

    if (selected && !cats.some((c) => c.name === selected)) {
      html += `<option value="${escapeHtml(selected)}">📦 ${escapeHtml(selected)}</option>`;
    }

    catSelect.innerHTML = html;
    if (selected) catSelect.value = selected;
  }

  function openForm(rule) {
    editingRuleId = rule ? rule.id : null;
    byId("recTitle").textContent = rule ? "Edit recurring entry" : "New recurring entry";
    deleteBtn.style.display = rule ? "block" : "none";

    acctSelect.innerHTML = accounts
      .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`)
      .join("");

    nameInput.value = rule ? rule.note : "";
    typeSelect.value = rule ? rule.type : "expense";
    fillRecCategories(typeSelect.value, rule ? rule.category : null);
    amountInput.value = rule ? rule.amount : "";
    acctSelect.value = rule
      ? realAccount(rule.accountId)
      : selectedAccount !== "all" ? selectedAccount : "cash";
    freqSelect.value = rule ? rule.frequency : "monthly";
    dateInput.value = rule ? rule.nextDue : todayString();
    activeBox.checked = rule ? rule.active : true;

    modal.classList.add("open");
    nameInput.focus();
  }

  function closeForm() {
    modal.classList.remove("open");
  }

  typeSelect.addEventListener("change", () => fillRecCategories(typeSelect.value, null));
  byId("recCancel").addEventListener("click", closeForm);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeForm();
  });

  byId("recForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const note = nameInput.value.trim();
    const amount = Number(amountInput.value);

    if (!note) {
      alert("Please give it a name, for example Rent.");
      return;
    }
    if (!(amount > 0)) {
      alert("Please enter an amount greater than 0.");
      return;
    }
    if (!validDate(dateInput.value)) {
      alert("Please choose a valid date.");
      return;
    }

    const data = {
      type: typeSelect.value,
      amount: amount,
      category: catSelect.value,
      accountId: acctSelect.value,
      note: note,
      frequency: freqSelect.value,
      nextDue: dateInput.value,
      anchorDay: Number(dateInput.value.slice(8, 10)),
      active: activeBox.checked
    };

    if (editingRuleId) await updateRecurring(editingRuleId, data);
    else await addRecurring(data);

    closeForm();
    await reloadRules();
  });

  deleteBtn.addEventListener("click", async () => {
    if (!editingRuleId) return;
    if (confirm("Delete this recurring entry?\nEntries already added stay in your list.")) {
      await deleteRecurring(editingRuleId);
      closeForm();
      await reloadRules();
    }
  });

  // =====================================================
  //  START
  // =====================================================
  window.reloadRules = reloadRules;
  window.renderDue = renderDue;
  window.fillRecurringCard = fillRecurringCard;

  // Check again whenever you come back to the app (a new day may have started)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Vault.isOpen()) reloadRules();
  });

  // Waits for the unlock when encryption is on
  Vault.onUnlock(reloadRules);
})();
