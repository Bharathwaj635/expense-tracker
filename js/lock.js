// ---------- Lock screen: unlock, lockout, auto-lock, code setup ----------
const Lock = (function () {
  const root = document.documentElement;
  const byId = (id) => document.getElementById(id);

  const PIN_KEY = "et_pin";          // the older "screen lock only" PIN
  const FAIL_KEY = "et_fail";
  const AUTOLOCK_KEY = "et_autolock";

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // =====================================================
  //  WHAT KIND OF LOCK IS ON
  // =====================================================
  function getLegacy() {
    try {
      const p = JSON.parse(lsGet(PIN_KEY));
      if (p && p.salt && p.hash) {
        p.len = p.v === 2 && p.len >= 4 && p.len <= 8 ? p.len : 4;
        return p;
      }
    } catch (e) {}
    return null;
  }

  function kind() {
    if (Vault.isEnabled()) return "vault";
    if (getLegacy()) return "legacy";
    return "none";
  }

  function state() {
    const k = kind();
    const v = Vault.info();
    const l = getLegacy();
    return {
      kind: k,
      type: k === "vault" ? v.type : "digits",
      len: k === "vault" ? v.len : l ? l.len : 0
    };
  }

  // The older PIN used a plain hash. Kept only so an existing PIN still works.
  async function legacyHash(pin, salt, v) {
    const enc = new TextEncoder();
    const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
    if (v === 2) {
      const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
      return hex(await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: enc.encode(salt), iterations: 200000, hash: "SHA-256" }, key, 256
      ));
    }
    return hex(await crypto.subtle.digest("SHA-256", enc.encode(salt + ":" + pin)));
  }

  // =====================================================
  //  WRONG-TRY LOCKOUT
  // =====================================================
  function getFail() {
    try {
      const f = JSON.parse(lsGet(FAIL_KEY));
      if (f && Number.isFinite(f.n) && Number.isFinite(f.until)) return f;
    } catch (e) {}
    return { n: 0, until: 0 };
  }

  function delayFor(n) {
    if (n >= 9) return 1800;
    if (n >= 7) return 600;
    if (n >= 5) return 120;
    if (n >= 3) return 30;
    return 0;
  }

  function lockedFor() {
    return Math.max(0, Math.ceil((getFail().until - Date.now()) / 1000));
  }

  function fmtTime(s) {
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // =====================================================
  //  THE LOCK SCREEN
  // =====================================================
  let mode = "unlock";      // unlock | verify | new | confirm
  let entryType = "digits"; // digits | pass
  let len = 6;
  let entered = "";
  let firstCode = "";
  let busy = false;
  let countdown = null;
  let onVerified = null;    // called with the code after a successful "verify"
  let onNewCode = null;     // called with the code after a new code is confirmed

  function setMsg(t) { byId("lockMsg").textContent = t || ""; }

  function drawDots() {
    [...byId("dots").children].forEach((d, i) => d.classList.toggle("on", i < entered.length));
  }

  function showEntry(type, n) {
    entryType = type;
    len = n;
    const digits = type === "digits";
    byId("dots").hidden = !digits;
    byId("keypad").hidden = !digits;
    byId("passForm").hidden = digits;
    if (digits) byId("dots").innerHTML = "<span></span>".repeat(n);
    byId("passInput").value = "";
    entered = "";
    drawDots();
  }

  function tick() {
    const s = lockedFor();
    if (s > 0) {
      setMsg("Too many wrong tries. Try again in " + fmtTime(s));
      byId("keypad").classList.add("disabled");
      byId("passForm").classList.add("disabled");
    } else {
      stopCountdown();
      if (byId("lockMsg").textContent.startsWith("Too many")) setMsg("");
    }
  }

  function stopCountdown() {
    clearInterval(countdown);
    countdown = null;
    byId("keypad").classList.remove("disabled");
    byId("passForm").classList.remove("disabled");
  }

  function startCountdown() {
    stopCountdown();
    if (lockedFor() > 0) {
      tick();
      countdown = setInterval(tick, 1000);
    }
  }

  function openPad(m, title, cancellable, type, n) {
    mode = m;
    busy = false;
    firstCode = "";
    byId("lockTitle").textContent = title;
    byId("lockCancel").hidden = !cancellable;
    setMsg("");

    if (m === "unlock" || m === "verify") {
      const s = state();
      showEntry(s.type, s.len || 6);
    } else {
      showEntry(type || "digits", n || 6);
    }

    root.classList.add("locked");
    if (m === "unlock" || m === "verify") startCountdown();
    else stopCountdown();

    if (entryType === "pass") setTimeout(() => byId("passInput").focus(), 50);
  }

  function closePad() {
    stopCountdown();
    root.classList.remove("locked");
    entered = "";
    firstCode = "";
    busy = false;
    onVerified = null;
    onNewCode = null;
    byId("passInput").value = "";
    drawDots();
    resetIdle();
  }

  function wrong(message) {
    setMsg(message);
    entered = "";
    byId("passInput").value = "";
    const dots = byId("dots");
    dots.classList.remove("shake");
    void dots.offsetWidth;
    dots.classList.add("shake");
    drawDots();
    busy = false;
  }

  async function checkCode(secret) {
    const k = kind();
    try {
      if (k === "vault") {
        if (mode === "unlock") { await Vault.unlock(secret); return true; }
        return await Vault.verify(secret);
      }
      if (k === "legacy") {
        const p = getLegacy();
        return (await legacyHash(secret, p.salt, p.v)) === p.hash;
      }
    } catch (e) {
      return false;
    }
    return true;
  }

  async function submit(secret) {
    if (busy) return;
    busy = true;

    try {
      if (mode === "unlock" || mode === "verify") {
        if (lockedFor() > 0) { busy = false; startCountdown(); return; }

        setMsg("Checking…");
        const ok = await checkCode(secret);

        if (!ok) {
          const f = getFail();
          f.n += 1;
          const wait = delayFor(f.n);
          f.until = wait ? Date.now() + wait * 1000 : 0;
          lsSet(FAIL_KEY, JSON.stringify(f));

          if (wait) {
            wrong("");
            startCountdown();
          } else {
            const left = 3 - f.n;
            wrong("Wrong code. " + left + (left === 1 ? " try" : " tries") + " left before a lock.");
          }
          return;
        }

        lsDel(FAIL_KEY);

        if (mode === "unlock") {
          setMsg("Opening…");
          await Vault.open(); // loads your data
          closePad();
        } else {
          const next = onVerified;
          onVerified = null;
          busy = false;
          setMsg("");
          if (next) next(secret);
        }
      } else if (mode === "new") {
        const problem = Vault.checkCode(secret, "digits");
        if (problem) { wrong(problem); return; }
        const cb = onNewCode;
        openPad("confirm", "Confirm your code", true, "digits", 6);
        onNewCode = cb;
        firstCode = secret; // set after openPad, which clears it
      } else if (mode === "confirm") {
        if (secret !== firstCode) {
          const cb = onNewCode;
          openPad("new", "Create a 6-digit code", true, "digits", 6);
          onNewCode = cb;
          setMsg("Codes did not match. Start again.");
          return;
        }
        const cb = onNewCode;
        closePad();
        if (cb) cb(secret);
      }
    } catch (err) {
      busy = false;
      setMsg("Something went wrong. Please try again.");
    }
  }

  function pressKey(k) {
    if (busy || entryType !== "digits") return;
    if ((mode === "unlock" || mode === "verify") && lockedFor() > 0) return;

    if (k === "back") entered = entered.slice(0, -1);
    else if (entered.length < len) entered += k;

    drawDots();
    if (entered.length === len) setTimeout(() => submit(entered), 120);
  }

  byId("keypad").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (b) pressKey(b.dataset.key);
  });

  byId("passForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = byId("passInput").value;
    if (!v || busy) return;
    if ((mode === "unlock" || mode === "verify") && lockedFor() > 0) return;
    submit(v);
  });

  byId("lockCancel").addEventListener("click", closePad);

  // Keyboard digits on a computer (only for the keypad)
  document.addEventListener("keydown", (e) => {
    if (!root.classList.contains("locked")) return;
    if (e.key === "Escape" && !byId("lockCancel").hidden) { closePad(); return; }
    if (entryType !== "digits") return;
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === "Backspace") pressKey("back");
  });

  // =====================================================
  //  A SMALL PASSWORD PROMPT (used for passphrases and backups)
  // =====================================================
  function askSecret(opts) {
    return new Promise((resolve) => {
      const modal = byId("secretModal");
      const f1 = byId("secret1");
      const f2 = byId("secret2");
      const wantConfirm = !!opts.confirm;
      const min = opts.min || 1;

      byId("secretTitle").textContent = opts.title || "Enter passphrase";
      byId("secretHint").textContent = opts.hint || "";
      byId("secretMsg").textContent = "";
      byId("secret2Row").hidden = !wantConfirm;
      f1.value = "";
      f2.value = "";
      modal.classList.add("open");
      setTimeout(() => f1.focus(), 50);

      function done(value) {
        modal.classList.remove("open");
        byId("secretForm").removeEventListener("submit", onSubmit);
        byId("secretCancel").removeEventListener("click", onCancel);
        f1.value = "";
        f2.value = "";
        resolve(value);
      }

      function onCancel() { done(null); }

      function onSubmit(e) {
        e.preventDefault();
        const a = f1.value;
        if (a.length < min) {
          byId("secretMsg").textContent = "Use at least " + min + " characters.";
          return;
        }
        if (opts.check) {
          const problem = opts.check(a);
          if (problem) { byId("secretMsg").textContent = problem; return; }
        }
        if (wantConfirm && a !== f2.value) {
          byId("secretMsg").textContent = "The two entries do not match.";
          return;
        }
        done(a);
      }

      byId("secretForm").addEventListener("submit", onSubmit);
      byId("secretCancel").addEventListener("click", onCancel);
    });
  }

  // =====================================================
  //  BUSY SCREEN (while encrypting)
  // =====================================================
  function showBusy(text) {
    byId("busyMsg").textContent = text || "Working…";
    byId("busy").classList.add("open");
  }
  function hideBusy() { byId("busy").classList.remove("open"); }

  // =====================================================
  //  SETTING UP, CHANGING AND REMOVING
  // =====================================================
  function getNewCode(type, cb) {
    if (type === "digits") {
      openPad("new", "Create a 6-digit code", true, "digits", 6);
      onNewCode = cb;
    } else {
      askSecret({
        title: "Create your passphrase",
        hint: "At least 8 characters. Four random words work well, for example: maple river tiger lamp. If you forget it, your data cannot be recovered.",
        confirm: true,
        min: 8,
        check: (v) => Vault.checkCode(v, "pass")
      }).then((v) => { if (v) cb(v); });
    }
  }

  function refreshSettings() {
    if (window.renderSettings) window.renderSettings();
  }

  // Turn on encryption (works from "no lock" or from an older PIN)
  function setup(type) {
    if (Vault.isEnabled()) return;
    if (!confirm(
      "Encryption converts all your data once.\n\n" +
      "A backup first is strongly recommended. Press OK to continue, or Cancel to go back and export a backup first."
    )) return;

    getNewCode(type, async (secret) => {
      showBusy("Encrypting… please keep the app open");
      try {
        const result = await enableVault(secret, type, showBusy);
        hideBusy();
        alert(
          "Encryption is on. Your data is now unreadable without your code." +
          (result.cleaned ? "" : "\n\nNote: the old readable copy could not be removed. It will be removed next time you open the app.") +
          "\n\nThe app will reload now."
        );
        location.reload();
      } catch (err) {
        hideBusy();
        alert("Encryption could not finish, so nothing was changed. Your data is safe.\n\n" + (err && err.message ? err.message : ""));
      }
    });
  }

  // Change the code (asks for the current one first)
  function change(type) {
    if (!Vault.isEnabled()) return;
    onVerified = (oldSecret) => {
      getNewCode(type, async (newSecret) => {
        showBusy("Saving your new code…");
        try {
          await Vault.changeCode(oldSecret, newSecret, type);
          hideBusy();
          alert("Your code was changed. Use the new code from now on.");
          refreshSettings();
        } catch (err) {
          hideBusy();
          alert("The code could not be changed. Your old code still works.");
        }
      });
    };
    openPad("verify", "Enter your current code", true);
  }

  function removeLegacy() {
    if (kind() !== "legacy") return;
    onVerified = () => {
      lsDel(PIN_KEY);
      lsDel(FAIL_KEY);
      closePad();
      refreshSettings();
      alert("PIN lock removed.");
    };
    openPad("verify", "Enter PIN to remove lock", true);
  }

  // =====================================================
  //  AUTO-LOCK
  // =====================================================
  function getAutoLock() {
    const v = lsGet(AUTOLOCK_KEY);
    return ["0", "1", "5", "15"].includes(v) ? Number(v) : 0;
  }

  function setAutoLock(v) {
    lsSet(AUTOLOCK_KEY, String(v));
    resetIdle();
  }

  let hiddenAt = 0;
  let needsReload = false;
  let pausedUntil = 0;
  let idleTimer = null;

  // Used while the phone's file picker is open, so the app does not lock under it
  function pause(seconds) {
    pausedUntil = Date.now() + seconds * 1000;
  }

  // Locking an encrypted app forgets the key and reloads, which also clears the screen
  function lockNow() {
    const k = kind();
    if (k === "vault") {
      Vault.lockKey();
      needsReload = true;
      location.reload();
    } else if (k === "legacy") {
      openPad("unlock", "Enter PIN", false);
    }
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    const mins = getAutoLock();
    if (kind() === "none" || mins === 0) return;
    idleTimer = setTimeout(() => {
      if (!root.classList.contains("locked")) lockNow();
    }, mins * 60000);
  }

  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((ev) => {
    document.addEventListener(ev, () => {
      if (!root.classList.contains("locked")) resetIdle();
    }, { passive: true, capture: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (kind() === "none") return;
    const mins = getAutoLock();

    if (document.hidden) {
      if (Date.now() < pausedUntil) return;
      hiddenAt = Date.now();
      if (mins === 0) lockNow();
    } else {
      if (needsReload) { location.reload(); return; }
      if (mins > 0 && hiddenAt && Date.now() - hiddenAt >= mins * 60000) lockNow();
      hiddenAt = 0;
      resetIdle();
    }
  });

  // =====================================================
  //  START
  // =====================================================
  const k0 = kind();
  if (k0 === "vault") {
    openPad("unlock", "Enter your code", false);
  } else if (k0 === "legacy") {
    openPad("unlock", "Enter PIN", false);
    Vault.open();
  } else {
    root.classList.remove("locked");
    Vault.open();
  }

  // Safety: if an older readable copy was left behind, remove it
  Vault.onUnlock(() => {
    if (Vault.isEnabled() && typeof Dexie !== "undefined") {
      Dexie.delete(DB_PLAIN).catch(() => {});
    }
  });

  resetIdle();

  return {
    state: state,
    setup: setup,
    change: change,
    removeLegacy: removeLegacy,
    lockNow: lockNow,
    getAutoLock: getAutoLock,
    setAutoLock: setAutoLock,
    askSecret: askSecret,
    pause: pause
  };
})();
