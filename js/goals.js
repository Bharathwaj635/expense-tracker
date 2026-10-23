// ---------- Savings goals ----------
(function () {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const byId = (id) => document.getElementById(id);

  let editingGoalId = null;
  let moneyGoalId = null;
  let moneyMode = "add"; // add | take
  let busy = false;

  // ----- helpers -----
  function validDate(s) {
    if (typeof s !== "string" || !DATE_RE.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function newId() {
    return Date.now() * 1000 + Math.floor(Math.random() * 1000);
  }

  function realAccount(id) {
    return accounts.some((a) => a.id === id) ? id : "cash";
  }

  // Keeps only valid goals (also protects against bad backup files)
  function cleanGoal(g) {
    if (!g || !Number.isInteger(g.id)) return null;
    const target = Number(g.target);
    if (!(target > 0)) return null;
    const start = Number(g.startSaved);

    const contributions = (Array.isArray(g.contributions) ? g.contributions : [])
      .filter(
        (c) =>
          c &&
          Number.isFinite(Number(c.amount)) &&
          Number(c.amount) !== 0 &&
          validDate(c.date)
      )
      .map((c) => ({
        id: Number.isFinite(Number(c.id)) ? Number(c.id) : newId(),
        date: c.date,
        accountId: String(c.accountId || "cash").slice(0, 30),
        amount: Number(c.amount)
      }));

    return {
      id: g.id,
      name: String(g.name || "Goal").slice(0, 40),
      icon: String(g.icon || "🎯").slice(0, 8),
      target: target,
      startSaved: start > 0 ? start : 0,
      targetDate: validDate(g.targetDate) ? g.targetDate : "",
      createdAt: validDate(g.createdAt) ? g.createdAt : todayString(),
      contributions: contributions
    };
  }

  function goalList() {
    return allGoals
      .map(cleanGoal)
      .filter(Boolean)
      .sort((a, b) => a.id - b.id);
  }

  function savedOf(g) {
    let total = g.startSaved;
    g.contributions.forEach((c) => { total += c.amount; });
    return total;
  }

  function hintFor(g, saved) {
    const left = g.target - saved;
    if (left <= 0) return "🎉 Goal reached!";

    let text = formatINR(left) + " to go";

    if (g.targetDate) {
      const today = todayString();
      if (g.targetDate <= today) {
        return text + " • Target date " + prettyDate(g.targetDate) + " has passed";
      }
      const [y, m] = today.split("-").map(Number);
      const [ty, tm] = g.targetDate.split("-").map(Number);
      const months = Math.max(1, (ty - y) * 12 + (tm - m));
      text +=
        " • Save about " + formatINR(Math.ceil(left / months)) +
        " per month to finish by " + prettyDate(g.targetDate);
    }
    return text;
  }

  // =====================================================
  //  GOALS SCREEN
  // =====================================================
  function renderGoals() {
    const box = byId("goalsBody");
    if (!box || !accounts.length) return;

    const goals = goalList();
    let totalSaved = 0;
    let totalTarget = 0;
    goals.forEach((g) => {
      totalSaved += savedOf(g);
      totalTarget += g.target;
    });

    let html = "";

    if (goals.length) {
      html += `
        <div class="card goal-sum">
          <small>Saved across ${goals.length} goal${goals.length > 1 ? "s" : ""}</small>
          <b>${formatINR(totalSaved)}</b>
          <small>of ${formatINR(totalTarget)}</small>
        </div>`;
    } else {
      html += '<p class="empty">No savings goals yet. Create your first one!</p>';
    }

    html += goals
      .map((g) => {
        const saved = savedOf(g);
        const pct = saved >= g.target ? 100 : Math.max(0, Math.floor((saved / g.target) * 100));
        const done = saved >= g.target;

        const history = g.contributions
          .slice()
          .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
          .map((c) => {
            const sign = c.amount > 0 ? "+" : "-";
            const cls = c.amount > 0 ? "income" : "expense";
            return `
          <div class="g-hist-row">
            <span>${prettyDate(c.date)} • ${escapeHtml(acctName(realAccount(c.accountId)))}</span>
            <b class="tx-amount ${cls}">${sign}${formatINR(Math.abs(c.amount))}</b>
            <button data-g="delc" data-id="${g.id}" data-cid="${c.id}" aria-label="Delete entry">🗑️</button>
          </div>`;
          })
          .join("");

        return `
      <div class="goal-card ${done ? "done" : ""}">
        <div class="goal-top">
          <div class="tx-icon">${escapeHtml(g.icon)}</div>
          <div class="tx-info">
            <b>${escapeHtml(g.name)}</b>
            <small>${formatINR(saved)} of ${formatINR(g.target)}</small>
          </div>
          <b class="goal-pct">${pct}%</b>
        </div>
        <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
        <p class="goal-note">${escapeHtml(hintFor(g, saved))}</p>
        <div class="due-actions">
          <button class="go" data-g="add" data-id="${g.id}">➕ Add money</button>
          <button data-g="take" data-id="${g.id}">➖ Take out</button>
          <button data-g="edit" data-id="${g.id}">✏️ Edit</button>
        </div>
        ${
          history
            ? `<details class="g-hist"><summary>History (${g.contributions.length})</summary>${history}</details>`
            : ""
        }
      </div>`;
      })
      .join("");

    html += '<button class="set-btn main" data-g="new">➕ New goal</button>';
    html +=
      '<p class="hint goal-hint">Money added to a goal leaves the account you choose, but it is not counted as spending.</p>';

    box.innerHTML = html;
  }

  window.renderGoals = renderGoals;

  byId("goalsBody").addEventListener("click", async (e) => {
    const el = e.target.closest("[data-g]");
    if (!el || busy) return;

    const act = el.dataset.g;
    const id = Number(el.dataset.id);

    if (act === "new") openGoalForm(null);
    else if (act === "edit") openGoalForm(goalList().find((g) => g.id === id));
    else if (act === "add") openMoney(id, "add");
    else if (act === "take") openMoney(id, "take");
    else if (act === "delc") {
      if (!confirm("Delete this entry? The money goes back to how it was before.")) return;
      busy = true;
      try {
        await db.transaction("rw", db.goals, async () => {
          const g = cleanGoal(await db.goals.get(id));
          if (!g) return;
          g.contributions = g.contributions.filter((c) => c.id !== Number(el.dataset.cid));
          await db.goals.put(g);
        });
        await refresh();
      } finally {
        busy = false;
      }
    }
  });

  // =====================================================
  //  GOAL FORM (new / edit)
  // =====================================================
  const goalModal = byId("goalModal");
  const gName = byId("gName");
  const gIcon = byId("gIcon");
  const gTarget = byId("gTarget");
  const gStart = byId("gStart");
  const gDate = byId("gDate");
  const gDelete = byId("gDelete");

  function openGoalForm(g) {
    if (g === undefined && editingGoalId !== null) return;

    editingGoalId = g ? g.id : null;
    byId("goalTitle").textContent = g ? "Edit goal" : "New savings goal";
    gDelete.style.display = g ? "block" : "none";

    gName.value = g ? g.name : "";
    gIcon.value = g ? g.icon : "🎯";
    gTarget.value = g ? g.target : "";
    gStart.value = g ? g.startSaved : "";
    gDate.value = g ? g.targetDate : "";

    goalModal.classList.add("open");
    gName.focus();
  }

  function closeGoalForm() {
    goalModal.classList.remove("open");
    editingGoalId = null;
  }

  byId("gCancel").addEventListener("click", closeGoalForm);
  goalModal.addEventListener("click", (e) => {
    if (e.target === goalModal) closeGoalForm();
  });

  byId("goalForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = gName.value.trim();
    const target = Number(gTarget.value);
    const start = Number(gStart.value || 0);

    if (!name) {
      alert("Please give your goal a name, for example Smartphone.");
      return;
    }
    if (!(target > 0)) {
      alert("Please enter a target amount greater than 0.");
      return;
    }
    if (!(start >= 0)) {
      alert("Already saved can't be negative.");
      return;
    }
    if (gDate.value && !validDate(gDate.value)) {
      alert("Please choose a valid date, or leave it empty.");
      return;
    }

    const fields = {
      name: name,
      icon: gIcon.value.trim() || "🎯",
      target: target,
      startSaved: start,
      targetDate: gDate.value || ""
    };

    if (editingGoalId) {
      await db.transaction("rw", db.goals, async () => {
        const g = cleanGoal(await db.goals.get(editingGoalId));
        if (g) await db.goals.put({ ...g, ...fields });
      });
    } else {
      await addGoal({ ...fields, createdAt: todayString(), contributions: [] });
    }

    closeGoalForm();
    await refresh();
  });

  gDelete.addEventListener("click", async () => {
    if (!editingGoalId) return;
    const g = goalList().find((x) => x.id === editingGoalId);
    if (!g) return;

    let fromAccounts = 0;
    g.contributions.forEach((c) => { fromAccounts += c.amount; });

    let msg = 'Delete the goal "' + g.name + '"?';
    if (fromAccounts > 0) {
      msg += "\n\nThe " + formatINR(fromAccounts) + " you moved into it goes back to your accounts.";
    }
    if (!confirm(msg)) return;

    await deleteGoal(editingGoalId);
    closeGoalForm();
    await refresh();
  });

  // =====================================================
  //  ADD MONEY / TAKE OUT
  // =====================================================
  const moneyModal = byId("gmModal");
  const gmAmount = byId("gmAmount");
  const gmAccount = byId("gmAccount");
  const gmDate = byId("gmDate");

  function openMoney(goalId, mode) {
    const g = goalList().find((x) => x.id === goalId);
    if (!g) return;

    moneyGoalId = goalId;
    moneyMode = mode;

    byId("gmTitle").textContent =
      (mode === "add" ? "Add money to " : "Take money out of ") + g.name;
    byId("gmHint").textContent =
      mode === "add"
        ? "This money leaves the account you pick and goes into the goal. It is not counted as spending."
        : "This money leaves the goal and goes back into the account you pick.";
    byId("gmAccountLabel").textContent = mode === "add" ? "From account" : "Back to account";

    gmAccount.innerHTML = accounts
      .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`)
      .join("");

    let start = selectedAccount !== "all" ? selectedAccount : lsGet("et_goal_acct");
    gmAccount.value = accounts.some((a) => a.id === start) ? start : "cash";

    gmAmount.value = "";
    gmDate.value = todayString();

    moneyModal.classList.add("open");
    gmAmount.focus();
  }

  function closeMoney() {
    moneyModal.classList.remove("open");
    moneyGoalId = null;
  }

  byId("gmCancel").addEventListener("click", closeMoney);
  moneyModal.addEventListener("click", (e) => {
    if (e.target === moneyModal) closeMoney();
  });

  byId("gmForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    const goal = goalList().find((x) => x.id === moneyGoalId);
    if (!goal) return;

    const amount = Number(gmAmount.value);
    const accountId = gmAccount.value;
    const date = gmDate.value;

    if (!(amount > 0)) {
      alert("Please enter an amount greater than 0.");
      return;
    }
    if (!validDate(date)) {
      alert("Please choose a valid date.");
      return;
    }

    const savedBefore = savedOf(goal);

    if (moneyMode === "take" && amount > savedBefore) {
      alert("This goal only holds " + formatINR(savedBefore) + ".");
      return;
    }
        if (moneyMode === "add") {
      const remaining = goal.target - savedBefore;

      if (remaining <= 0.005) {
        alert(
          "This goal is already complete (" + formatINR(savedBefore) + " of " + formatINR(goal.target) + ").\n\n" +
          "To keep saving, tap ✏️ Edit and raise the target amount."
        );
        return;
      }

      if (amount > remaining + 0.005) {
        alert(
          "This goal only needs " + formatINR(remaining) + " more to reach " + formatINR(goal.target) + ".\n\n" +
          "Enter " + formatINR(remaining) + " or less, or tap ✏️ Edit to raise the target."
        );
        return;
      }
    }

    if (moneyMode === "add") {
      const bal = balanceFor([accountId], date);
      if (bal - amount < 0) {
        const ok = confirm(
          acctName(accountId) + " would go below ₹0 (it has " + formatINR(bal) + " on that date).\n\nContinue anyway?"
        );
        if (!ok) return;
      }
    }

    busy = true;
    try {
      await db.transaction("rw", db.goals, async () => {
        const g = cleanGoal(await db.goals.get(moneyGoalId));
        if (!g) return;
        g.contributions.push({
          id: newId(),
          date: date,
          accountId: accountId,
          amount: moneyMode === "add" ? amount : -amount
        });
        await db.goals.put(g);
      });

      lsSet("et_goal_acct", accountId);
      closeMoney();
      await refresh();

      if (moneyMode === "add" && savedBefore < goal.target && savedBefore + amount >= goal.target) {
        alert("🎉 You reached your goal: " + goal.name + "!");
      }
    } finally {
      busy = false;
    }
  });
})();