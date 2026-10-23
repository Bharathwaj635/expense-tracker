// ---------- Spending insights (worked out on your device: no AI, no internet) ----------
(function () {
  const byId = (id) => document.getElementById(id);

  // ----- small helpers -----
  function monthName(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric"
    });
  }

  function prevKey(key) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function daysIn(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  function sum(list) {
    return list.reduce((s, t) => s + t.amount, 0);
  }

  function groupBy(list, field, fallback) {
    const out = {};
    list.forEach((t) => {
      const k = t[field] || fallback;
      out[k] = (out[k] || 0) + t.amount;
    });
    return out;
  }

  const money = (n) => formatINR(Math.round(n));

  // =====================================================
  //  WORK OUT THE INSIGHTS
  // =====================================================
  function compute() {
    const out = [];
    const today = todayString();
    const thisKey = today.slice(0, 7);

    if (viewMonth > thisKey) return out; // a future month has nothing to say yet

    const isCurrent = viewMonth === thisKey;
    const dim = daysIn(viewMonth);
    const day = isCurrent ? Number(today.slice(8, 10)) : dim;
    const pKey = prevKey(viewMonth);
    const cutoff = isCurrent ? Math.min(day, daysIn(pKey)) : daysIn(pKey);

    const nowP = isCurrent ? "this month" : "in " + monthName(viewMonth);
    const thenP = isCurrent ? "the same days last month" : monthName(pKey);

    const list = visibleTx();
    const curExp = list.filter((t) => t.type === "expense" && t.date.startsWith(viewMonth));
    const curInc = list.filter((t) => t.type === "income" && t.date.startsWith(viewMonth));
    const prevExp = list.filter(
      (t) =>
        t.type === "expense" &&
        t.date.startsWith(pKey) &&
        Number(t.date.slice(8, 10)) <= cutoff
    );

    const totalNow = sum(curExp);
    const totalPrev = sum(prevExp);
    const income = sum(curInc);

    // Nothing at all this month
    if (totalNow === 0 && income === 0) {
      out.push({
        p: 0,
        empty: true,
        tone: "info",
        icon: "📭",
        text: "No entries for " + monthName(viewMonth) + " yet. Insights appear as you add transactions."
      });
      return out;
    }

    // ----- 1. Category up or down compared with last month -----
    const cur = groupBy(curExp, "category", "Other");
    const prev = groupBy(prevExp, "category", "Other");
    const ups = [];
    const downs = [];

    new Set([...Object.keys(cur), ...Object.keys(prev)]).forEach((c) => {
      const a = cur[c] || 0;
      const b = prev[c] || 0;
      const diff = a - b;
      if (Math.abs(diff) < 100) return;               // ignore tiny changes
      if (b > 0 && Math.abs(diff) / b < 0.1) return;  // ignore changes under 10%
      (diff > 0 ? ups : downs).push({ c: c, a: a, b: b, diff: diff });
    });

    ups.sort((x, y) => y.diff - x.diff);
    downs.sort((x, y) => x.diff - y.diff);

    ups.slice(0, 2).forEach((u, i) => {
      const text =
        u.b === 0
          ? "You spent " + money(u.a) + " on " + u.c + " " + nowP + ", and nothing on it during " + thenP + "."
          : "You spent " + money(u.diff) + " more on " + u.c + " " + nowP + " compared with " + thenP + ".";
      out.push({ p: i === 0 ? 2 : 4, tone: "up", icon: iconFor("expense", u.c), text: text });
    });

    if (downs.length) {
      const d = downs[0];
      out.push({
        p: 5,
        tone: "down",
        icon: iconFor("expense", d.c),
        text:
          "You spent " + money(-d.diff) + " less on " + d.c + " " + nowP + " compared with " + thenP + ". Nice!"
      });
    }

    // ----- 2. Total spending change -----
    if (totalPrev > 0 && Math.abs(totalNow - totalPrev) >= 100) {
      const diff = totalNow - totalPrev;
      const pct = Math.round((Math.abs(diff) / totalPrev) * 100);
      out.push({
        p: 3,
        tone: diff > 0 ? "up" : "down",
        icon: diff > 0 ? "📈" : "📉",
        text:
          "Overall you spent " + money(Math.abs(diff)) + " (" + pct + "%) " +
          (diff > 0 ? "more " : "less ") + nowP + " compared with " + thenP + "."
      });
    }

    // ----- 3. Budgets running ahead of pace (current month only) -----
    if (isCurrent && day >= 5) {
      const spent = spentThisMonth();
      const frac = day / dim;
      const pace = [];

      Object.keys(budgets).forEach((cat) => {
        const limit = budgets[cat];
        const used = spent[cat] || 0;
        if (!(limit > 0) || used >= limit * 0.8) return; // 80% and over already has a warning on Home

        const projected = used / frac;
        if (projected >= limit * 1.05) pace.push({ cat: cat, limit: limit, projected: projected });
      });

      pace.sort((x, y) => y.projected / y.limit - x.projected / x.limit);
      pace.slice(0, 2).forEach((b) => {
        out.push({
          p: 1,
          tone: "warn",
          icon: "⏱️",
          text:
            "At this pace " + b.cat + " will reach about " + money(b.projected) +
            " by month end, above your " + formatINR(b.limit) + " budget."
        });
      });
    }

    // ----- 4. Daily average and month-end projection -----
    if (totalNow > 0) {
      const avg = totalNow / day;

      if (isCurrent && day >= 3) {
        out.push({
          p: 6,
          tone: "info",
          icon: "📅",
          text:
            "You're spending about " + money(avg) + " a day. At this pace you'll spend about " +
            money(avg * dim) + " by the end of the month."
        });
      } else if (!isCurrent) {
        out.push({
          p: 6,
          tone: "info",
          icon: "📅",
          text: "You spent about " + money(avg) + " per day " + nowP + "."
        });
      }
    }

    // ----- 5. Biggest category -----
    if (totalNow > 0) {
      const top = Object.keys(cur).sort((x, y) => cur[y] - cur[x])[0];
      const share = Math.round((cur[top] / totalNow) * 100);
      out.push({
        p: 7,
        tone: "info",
        icon: iconFor("expense", top),
        text:
          top + " is your biggest spending category " + nowP + ": " + money(cur[top]) +
          " (" + share + "% of everything you spent)."
      });
    }

    // ----- 6. Biggest single expense -----
    if (curExp.length >= 2) {
      const big = curExp.slice().sort((x, y) => y.amount - x.amount)[0];
      const note = big.note ? " (" + big.note + ")" : "";
      out.push({
        p: 8,
        tone: "info",
        icon: "💸",
        text:
          "Your biggest expense " + nowP + " was " + money(big.amount) + " on " + big.category +
          note + ", on " + prettyDate(big.date) + "."
      });
    }

    // ----- 7. How much of your income you kept -----
    if (income > 0) {
      const left = income - totalNow;
      if (left >= 0) {
        const pct = Math.round((left / income) * 100);
        out.push({
          p: 9,
          tone: pct >= 20 ? "good" : "info",
          icon: "🐷",
          text:
            "You kept " + pct + "% of your income " + nowP + " (" + money(left) + " left of " +
            money(income) + ")."
        });
      } else {
        out.push({
          p: 9,
          tone: "up",
          icon: "⚠️",
          text: "You spent " + money(-left) + " more than you earned " + nowP + "."
        });
      }
    }

    // ----- 8. Which account carried the spending -----
    if (selectedAccount === "all" && totalNow > 0) {
      const byAcct = groupBy(curExp, "accountId", "cash");
      const ids = Object.keys(byAcct);
      if (ids.length >= 2) {
        const top = ids.sort((x, y) => byAcct[y] - byAcct[x])[0];
        const share = Math.round((byAcct[top] / totalNow) * 100);
        out.push({
          p: 10,
          tone: "info",
          icon: acctIcon(top),
          text: share + "% of your spending " + nowP + " went through " + acctName(top) + "."
        });
      }
    }

    return out;
  }

  // =====================================================
  //  DRAW THEM
  // =====================================================
  function card(i) {
    return `
      <div class="insight ${i.tone}">
        <span class="ins-icon">${escapeHtml(i.icon)}</span>
        <p>${escapeHtml(i.text)}</p>
      </div>`;
  }

  function renderInsights() {
    const home = byId("homeInsights");
    const charts = byId("chartInsights");
    if (!home || !charts || !accounts.length) return;

    const all = compute().sort((a, b) => a.p - b.p);
    const real = all.filter((i) => !i.empty);
    const scope = selectedAccount === "all" ? "" : " • " + acctName(selectedAccount);

    if (!real.length) {
      home.innerHTML = "";
    } else {
      home.innerHTML =
        "<h2>💡 Insights" + escapeHtml(scope) + "</h2>" +
        real.slice(0, 3).map(card).join("") +
        (real.length > 3
          ? `<button class="link-btn" data-go="charts">See all ${real.length} insights →</button>`
          : "");
    }

    charts.innerHTML = all.length
      ? all.map(card).join("")
      : '<p class="empty">Insights will appear here as you add entries.</p>';
  }

  window.renderInsights = renderInsights;

  byId("homeInsights").addEventListener("click", (e) => {
    if (e.target.closest("[data-go]")) showScreen("chartsScreen");
  });
})();