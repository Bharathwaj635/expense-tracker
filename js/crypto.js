// ---------- Vault: AES-256 encryption for your data ----------
// Everything here runs on your device. The data key exists only in memory
// while the app is unlocked, and is never saved anywhere.
const Vault = (function () {
  const HEADER_KEY = "et_vault";
  const ITER = 600000; // slow on purpose, to make code guessing expensive
  const te = new TextEncoder();
  const td = new TextDecoder();
  const WRAP_AAD = te.encode("expense-tracker:key-wrap:v1");
  const BACKUP_AAD = te.encode("expense-tracker:backup:v1");

  let dek = null;       // the data key (only in memory)
  let opened = false;   // true once the app may read the database
  const queue = [];     // start-up jobs that wait for the unlock

  // ----- small helpers -----
  function rand(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  function toB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function fromB64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // ----- the small header that holds the wrapped key -----
  function readHeader() {
    try {
      const h = JSON.parse(localStorage.getItem(HEADER_KEY));
      if (
        h && h.v === 1 &&
        (h.type === "digits" || h.type === "pass") &&
        typeof h.salt === "string" && typeof h.iv === "string" && typeof h.wrapped === "string" &&
        Number.isInteger(h.iter) && h.iter >= 100000 && h.iter <= 5000000
      ) {
        return h;
      }
    } catch (e) {}
    return null;
  }

  function saveHeader(h) {
    localStorage.setItem(HEADER_KEY, JSON.stringify(h));
  }

  function isEnabled() {
    return !!readHeader();
  }

  function info() {
    const h = readHeader();
    return h ? { type: h.type, len: h.len || 0 } : null;
  }

  // ----- turning your code into a key -----
  async function kekFrom(secret, salt, iter) {
    const base = await crypto.subtle.importKey(
      "raw", te.encode(String(secret).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function makeHeader(secret, type, rawKey) {
    const salt = rand(16);
    const iv = rand(12);
    const kek = await kekFrom(secret, salt, ITER);
    const wrapped = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: WRAP_AAD }, kek, rawKey
    );
    return {
      v: 1,
      type: type,
      len: type === "digits" ? String(secret).length : 0,
      iter: ITER,
      salt: toB64(salt),
      iv: toB64(iv),
      wrapped: toB64(wrapped)
    };
  }

  // Returns the raw data key, or throws if the code is wrong
  async function unwrapRaw(secret, h) {
    const kek = await kekFrom(secret, fromB64(h.salt), h.iter);
    const raw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(h.iv), additionalData: WRAP_AAD }, kek, fromB64(h.wrapped)
    );
    return new Uint8Array(raw);
  }

  function importDataKey(raw) {
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  // ----- public: create / unlock / verify / change -----
  async function create(secret, type) {
    const raw = rand(32);
    const header = await makeHeader(secret, type, raw);
    const key = await importDataKey(raw);
    raw.fill(0);
    return { header: header, key: key };
  }

  async function unlock(secret) {
    const h = readHeader();
    if (!h) throw new Error("No vault");
    const raw = await unwrapRaw(secret, h); // throws on a wrong code
    dek = await importDataKey(raw);
    raw.fill(0);
  }

  async function verify(secret) {
    const h = readHeader();
    if (!h) return false;
    try {
      const raw = await unwrapRaw(secret, h);
      raw.fill(0);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Only the small header changes. Your data is not touched.
  async function changeCode(oldSecret, newSecret, newType) {
    const h = readHeader();
    if (!h) throw new Error("No vault");
    const raw = await unwrapRaw(oldSecret, h); // throws if the old code is wrong
    try {
      saveHeader(await makeHeader(newSecret, newType, raw));
    } finally {
      raw.fill(0);
    }
  }

  function useKey(k) { dek = k; }
  function lockKey() { dek = null; }

  // ----- start-up jobs that must wait for the unlock -----
  function onUnlock(fn) {
    if (opened) {
      Promise.resolve().then(fn);
    } else {
      queue.push(fn);
    }
  }

  async function open() {
    opened = true;
    while (queue.length) {
      const fn = queue.shift();
      try { await fn(); } catch (e) { console.error(e); }
    }
  }

  function isOpen() {
    return opened && (!isEnabled() || dek !== null);
  }

  // ----- rules for new codes -----
  const COMMON = ["password", "12345678", "123456789", "qwertyui", "qwertyuiop", "iloveyou", "11111111", "abcdefgh", "letmein1"];

  function checkCode(secret, type) {
    if (type === "digits") {
      if (!/^\d{6}$/.test(secret)) return "Use exactly 6 digits.";
      if (/^(\d)\1+$/.test(secret)) return "That code is too easy to guess. Choose another.";
      if (/^(\d\d)\1+$/.test(secret) || /^(\d\d\d)\1$/.test(secret)) return "That code is too easy to guess. Choose another.";
      if ("01234567890".includes(secret) || "09876543210".includes(secret)) return "That code is too easy to guess. Choose another.";
      return "";
    }
    if (secret.length < 8) return "Use at least 8 characters. Four random words work well.";
    if (/^(.)\1+$/.test(secret)) return "That passphrase is too easy to guess. Choose another.";
    if (COMMON.includes(secret.toLowerCase())) return "That passphrase is too common. Choose another.";
    return "";
  }

  // =====================================================
  //  ENCRYPTING THE DATABASE (Dexie middleware)
  // =====================================================
  // Every row is stored as { id, _e: <encrypted bytes> }. Only the row's
  // number (id) stays readable. The IndexedDB transaction is kept alive
  // while the browser's crypto engine works (Dexie.waitFor).
  function waitFor(p) {
    return typeof Dexie !== "undefined" && Dexie.waitFor ? Dexie.waitFor(p) : p;
  }

  function needKey() {
    if (!dek) throw new Error("The app is locked.");
    return dek;
  }

  async function encRow(table, pk, obj) {
    const key = needKey();
    const rest = {};
    Object.keys(obj).forEach((k) => { if (k !== pk) rest[k] = obj[k]; });

    const iv = rand(12);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: te.encode("row:" + table) },
      key,
      te.encode(JSON.stringify(rest))
    );
    const bytes = new Uint8Array(12 + ct.byteLength);
    bytes.set(iv, 0);
    bytes.set(new Uint8Array(ct), 12);

    const out = { _e: bytes };
    if (obj[pk] !== undefined) out[pk] = obj[pk];
    return out;
  }

  async function decRow(table, pk, row) {
    if (!row || !row._e) return row;
    const key = needKey();
    const bytes = new Uint8Array(row._e);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: te.encode("row:" + table) },
      key,
      bytes.slice(12)
    );
    const obj = JSON.parse(td.decode(pt));
    if (row[pk] !== undefined) obj[pk] = row[pk];
    return obj;
  }

  function middleware() {
    return {
      stack: "dbcore",
      name: "etVault",
      create: function (down) {
        return Object.assign({}, down, {
          table: function (name) {
            const t = down.table(name);
            const pk = t.schema.primaryKey.keyPath;

            return Object.assign({}, t, {
              mutate: function (req) {
                if ((req.type === "add" || req.type === "put") && req.values) {
                  return waitFor(Promise.all(req.values.map((v) => encRow(name, pk, v))))
                    .then((vals) => t.mutate(Object.assign({}, req, { values: vals })));
                }
                return t.mutate(req);
              },
              get: function (req) {
                return t.get(req).then((v) => (v ? waitFor(decRow(name, pk, v)) : v));
              },
              getMany: function (req) {
                return t.getMany(req).then((vs) =>
                  waitFor(Promise.all(vs.map((v) => (v ? decRow(name, pk, v) : v))))
                );
              },
              query: function (req) {
                return t.query(req).then((res) => {
                  if (!req.values) return res;
                  return waitFor(Promise.all(res.result.map((v) => decRow(name, pk, v))))
                    .then((result) => Object.assign({}, res, { result: result }));
                });
              },
              openCursor: function () {
                throw new Error("Cursors are not supported on encrypted tables.");
              }
            });
          }
        });
      }
    };
  }

  // =====================================================
  //  ENCRYPTED BACKUP FILES
  // =====================================================
  async function encryptBackup(text, passphrase) {
    const salt = rand(16);
    const iv = rand(12);
    const key = await kekFrom(passphrase, salt, ITER);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: BACKUP_AAD }, key, te.encode(text)
    );
    return {
      app: "expense-tracker",
      encrypted: true,
      v: 1,
      kdf: "PBKDF2-SHA256",
      iter: ITER,
      salt: toB64(salt),
      iv: toB64(iv),
      data: toB64(ct)
    };
  }

  async function decryptBackup(obj, passphrase) {
    if (
      !obj || obj.encrypted !== true || obj.v !== 1 ||
      typeof obj.salt !== "string" || typeof obj.iv !== "string" || typeof obj.data !== "string" ||
      !Number.isInteger(obj.iter) || obj.iter < 100000 || obj.iter > 5000000
    ) {
      throw new Error("Not a valid encrypted backup.");
    }
    const key = await kekFrom(passphrase, fromB64(obj.salt), obj.iter);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(obj.iv), additionalData: BACKUP_AAD }, key, fromB64(obj.data)
    );
    return td.decode(pt);
  }

  return {
    isEnabled: isEnabled,
    info: info,
    create: create,
    unlock: unlock,
    verify: verify,
    changeCode: changeCode,
    saveHeader: saveHeader,
    useKey: useKey,
    lockKey: lockKey,
    onUnlock: onUnlock,
    open: open,
    isOpen: isOpen,
    checkCode: checkCode,
    middleware: middleware,
    encryptBackup: encryptBackup,
    decryptBackup: decryptBackup
  };
})();
