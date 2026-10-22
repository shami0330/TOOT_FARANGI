/* v100.93 — لایهٔ سازگاری پوشه برای Electron (فقط وقتی preload.js پل tfBridge را داده باشد فعال می‌شود؛ در Chrome اصلاً اجرا نمی‌شود).
   ۱) showDirectoryPicker را می‌پوشاند: اول انتخاب‌گر بومی؛ اگر نشد یا نوشتن در پوشه ممکن نبود، انتخاب‌گر پل (dialog سیستم).
   ۲) handleهای پل شکل FileSystemDirectoryHandle / FileSystemFileHandle دارند و به‌صورت ساده در IndexedDB ذخیره می‌شوند؛
      window.tfRevive آن‌ها را بعد از خواندن از IndexedDB دوباره می‌سازد. */
(function () {
  'use strict';
  var B = window.tfBridge;
  if (!B || window.__tfShim) return;
  window.__tfShim = 1; window.tfElectron = true;
  var log = function () { try { console.log.apply(console, ['[tf]'].concat([].slice.call(arguments))); } catch (e) {} };
  var err = function (n, m) { return new DOMException(m || n, n); };
  var conv = function (e) { var m = String((e && e.message) || e), x = /TF:(\w+)/.exec(m); return err(x ? x[1] : 'UnknownError', m); };
  var call = async function (fn) { try { return await fn(); } catch (e) { throw conv(e); } };
  var enc = new TextEncoder();

  class Base {
    constructor(kind, root, parts, rn) { this.kind = kind; this.name = parts.length ? parts[parts.length - 1] : rn; this.__tfp = { root: root, parts: parts, rn: rn }; }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async isSameEntry(o) { var a = this.__tfp, b = o && o.__tfp; return !!(b && a.root === b.root && a.parts.join('/') === b.parts.join('/')); }
  }
  class Writable {
    constructor(p, init) { this.p = p; this.buf = init || new Uint8Array(0); this.len = this.buf.length; this.pos = 0; this.done = 0; }
    _ens(n) { if (n > this.buf.length) { var nb = new Uint8Array(Math.max(n, this.buf.length * 2, 1024)); nb.set(this.buf.subarray(0, this.len)); this.buf = nb; } }
    async write(d) {
      if (this.done) throw err('InvalidStateError');
      var pos = this.pos;
      if (d && typeof d === 'object' && !(d instanceof Blob) && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d) && d.type) {
        if (d.type === 'seek') { this.pos = d.position; return; }
        if (d.type === 'truncate') return this.truncate(d.size);
        if (d.type !== 'write') throw new TypeError('Invalid write params');
        if (typeof d.position === 'number') pos = d.position;
        d = d.data;
      }
      var u;
      if (typeof d === 'string') u = enc.encode(d);
      else if (d instanceof Blob) u = new Uint8Array(await d.arrayBuffer());
      else if (d instanceof ArrayBuffer) u = new Uint8Array(d);
      else if (ArrayBuffer.isView(d)) u = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      else throw new TypeError('Invalid data');
      this._ens(pos + u.length);
      if (pos > this.len) this.buf.fill(0, this.len, pos);
      this.buf.set(u, pos); this.len = Math.max(this.len, pos + u.length); this.pos = pos + u.length;
    }
    async seek(p) { this.pos = p; }
    async truncate(n) { this._ens(n); if (n > this.len) this.buf.fill(0, this.len, n); this.len = n; if (this.pos > n) this.pos = n; }
    async close() { if (this.done) return; this.done = 1; var p = this.p, d = this.buf.slice(0, this.len); this.buf = null; await call(function () { return B.write(p.root, p.parts, d); }); }
    async abort() { this.done = 1; this.buf = null; }
  }
  class File_ extends Base {
    async getFile() {
      var p = this.__tfp, r = await call(function () { return B.read(p.root, p.parts); });
      return new File([r.data], this.name, { lastModified: Math.round(r.mtime) });
    }
    async createWritable(o) {
      var p = this.__tfp, init = null;
      if (o && o.keepExistingData) { var r = await call(function () { return B.read(p.root, p.parts); }); init = new Uint8Array(r.data); }
      return new Writable(p, init);
    }
  }
  class Dir extends Base {
    _c(n) { return this.__tfp.parts.concat([n]); }
    async getFileHandle(n, o) {
      var p = this.__tfp, c = this._c(n), st = await call(function () { return B.stat(p.root, c); });
      if (st) { if (st.kind !== 'file') throw err('TypeMismatchError'); }
      else { if (!(o && o.create)) throw err('NotFoundError'); await call(function () { return B.write(p.root, c, new Uint8Array(0)); }); }
      return new File_('file', p.root, c, p.rn);
    }
    async getDirectoryHandle(n, o) {
      var p = this.__tfp, c = this._c(n), st = await call(function () { return B.stat(p.root, c); });
      if (st) { if (st.kind !== 'directory') throw err('TypeMismatchError'); }
      else { if (!(o && o.create)) throw err('NotFoundError'); await call(function () { return B.mkdir(p.root, c); }); }
      return new Dir('directory', p.root, c, p.rn);
    }
    async removeEntry(n, o) { var p = this.__tfp, c = this._c(n); await call(function () { return B.remove(p.root, c, !!(o && o.recursive)); }); }
    async *entries() {
      var p = this.__tfp, l = await call(function () { return B.list(p.root, p.parts); });
      for (var i = 0; i < l.length; i++) { var x = l[i], c = this._c(x.name); yield [x.name, x.kind === 'directory' ? new Dir('directory', p.root, c, p.rn) : new File_('file', p.root, c, p.rn)]; }
    }
    async *values() { for await (var e of this.entries()) yield e[1]; }
    async *keys() { for await (var e of this.entries()) yield e[0]; }
    [Symbol.asyncIterator]() { return this.entries(); }
    async resolve(h) {
      var a = this.__tfp, b = h && h.__tfp;
      if (!b || a.root !== b.root || b.parts.length < a.parts.length) return null;
      for (var i = 0; i < a.parts.length; i++) if (a.parts[i] !== b.parts[i]) return null;
      return b.parts.slice(a.parts.length);
    }
  }

  window.tfRevive = function (x) {
    try {
      var p = x && x.__tfp;
      if (p && p.root && Array.isArray(p.parts) && !(x instanceof Base))
        return x.kind === 'file' ? new File_('file', p.root, p.parts, p.rn) : new Dir('directory', p.root, p.parts, p.rn);
    } catch (e) {}
    return x;
  };

  var nat = typeof window.showDirectoryPicker === 'function' ? window.showDirectoryPicker.bind(window) : null;
  async function bridgePick(o) {
    var r = await call(function () { return B.pick({ start: o && o.startIn === 'videos' ? 'videos' : '', id: o && o.id }); });
    log('bridge pick ok', r.name);
    return new Dir('directory', r.root, [], r.name);
  }
  window.showDirectoryPicker = async function (o) {
    if (nat) {
      var h = null;
      try { h = await nat(o); } catch (e) { if (e && e.name === 'AbortError') throw e; log('native picker failed', e && e.name, e && e.message); }
      if (h) {
        try { // بررسی می‌کند نوشتن در پوشهٔ انتخاب‌شده واقعاً ممکن است
          var f = await h.getFileHandle('.tf-probe', { create: true }), w = await f.createWritable();
          await w.write('1'); await w.close();
          try { await h.removeEntry('.tf-probe'); } catch (e) {}
          return h;
        } catch (e) { log('native write probe failed', e && e.name, e && e.message); }
      }
    }
    return bridgePick(o);
  };
  log('shim active; native picker:', !!nat);
})();
