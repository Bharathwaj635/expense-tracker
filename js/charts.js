// ---------- Charts (uses the Chart.js library in lib/) ----------
let pieChart = null;
let barChart = null;

const PALETTE = [
  "#6C5CE7", "#00b894", "#ff7675", "#fdcb6e", "#0984e3",
  "#e17055", "#a29bfe", "#55efc4", "#fab1a0", "#74b9ff"
];

function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

// Doughnut: where this month's money went
function drawPie(transactions, month) {
  const totals = {};
  transactions.forEach((t) => {
    if (t.type === "expense" && t.date.startsWith(month)) {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    }
  });

  const labels = Object.keys(totals);
  const values = labels.map((l) => totals[l]);

  const canvas = document.getElementById("pieChart");
  const emptyNote = document.getElementById("pieEmpty");

  if (pieChart) {
    pieChart.destroy();
    pieChart = null;
  }

  if (labels.length === 0) {
    canvas.style.display = "none";
    emptyNote.hidden = false;
    return;
  }

  canvas.style.display = "block";
  emptyNote.hidden = true;

  pieChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [
        {
          data: values,
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: cssVar("--text"), boxWidth: 12, padding: 14 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => " " + ctx.label + ": " + formatINR(ctx.parsed)
          }
        }
      }
    }
  });
}

// Bars: income vs expenses for the last 6 months
function drawBar(transactions, month) {
  const [y, m] = month.split("-").map(Number);
  const labels = [];
  const income = [];
  const expense = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    labels.push(d.toLocaleDateString("en-IN", { month: "short" }));

    let inc = 0;
    let exp = 0;
    transactions.forEach((t) => {
      if (t.date.startsWith(key)) {
        if (t.type === "income") inc += t.amount;
        else exp += t.amount;
      }
    });
    income.push(inc);
    expense.push(exp);
  }

  if (barChart) {
    barChart.destroy();
    barChart = null;
  }

  const compact = new Intl.NumberFormat("en-IN", { notation: "compact" });
  const textColor = cssVar("--text");
  const gridColor = "rgba(150, 150, 170, 0.2)";

  barChart = new Chart(document.getElementById("barChart"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label: "Income", data: income, backgroundColor: "#00b894", borderRadius: 6 },
        { label: "Expenses", data: expense, backgroundColor: "#ff7675", borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => " " + ctx.dataset.label + ": " + formatINR(ctx.parsed.y)
          }
        }
      },
      scales: {
        x: { ticks: { color: textColor }, grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { color: textColor, callback: (v) => "₹" + compact.format(v) },
          grid: { color: gridColor }
        }
      }
    }
  });
}