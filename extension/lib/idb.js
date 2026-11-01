/* Minimal IndexedDB helper. CryptoKey objects are structured-cloneable in modern Chromium. */
(function (root) {
  'use strict';
  const DB_NAME = 'guardian53-secure-v1';
  const STORE = 'secrets';
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open secure storage'));
    });
  }
  async function run(mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try { result = operation(store); } catch (error) { db.close(); reject(error); return; }
      tx.oncomplete = () => { db.close(); resolve(result && result.result); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('Secure storage transaction failed')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Secure storage transaction aborted')); };
    });
  }
  root.G53IDB = {
    get: async (key) => {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    },
    put: (key, value) => run('readwrite', store => store.put(value, key)),
    addIfAbsent: async (key, value) => {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        let conflict = false;
        const req = tx.objectStore(STORE).add(value, key);
        req.onerror = event => {
          if (req.error && req.error.name === 'ConstraintError') {
            conflict = true;
            event.preventDefault();
            event.stopPropagation();
          }
        };
        tx.oncomplete = async () => {
          db.close();
          if (!conflict) { resolve(value); return; }
          try { resolve(await root.G53IDB.get(key)); } catch (error) { reject(error); }
        };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('Secure storage transaction failed')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('Secure storage transaction aborted')); };
      });
    },
    delete: (key) => run('readwrite', store => store.delete(key)),
    clear: () => run('readwrite', store => store.clear())
  };
})(self);
