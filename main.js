const { app, BrowserWindow, shell, session, ipcMain, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// برنامه از روی http://localhost:PORT اجرا می‌شود (نه file://) تا
// ۱) داده‌ها (localStorage و IndexedDB) همیشه در یک «مبدأ» ثابت بمانند،
// ۲) Appwrite نشانی localhost را بپذیرد (Apps ← Web ← Hostname = localhost).
// اگر پورت را عوض کنی، داده‌های ذخیره‌شده دیده نمی‌شوند.
const PORT = 47831;
const ORIGIN = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, 'app');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };

// v100.93: «fileSystem» اضافه شد؛ بدون آن Electron همهٔ نوشتن‌ها و خواندن‌های پوشهٔ انتخاب‌شده
// (File System Access API) را رد می‌کرد و برنامه روی صفحهٔ اول می‌ماند.
const ALLOWED = ['media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'notifications', 'fileSystem'];

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.normalize(path.join(ROOT, p));
      if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(f, (e, d) => {
        if (e) { res.writeHead(404); return res.end('Not found'); }
        // لایهٔ سازگاری پوشه (tf-shim.js) فقط هنگام اجرا در Electron به ابتدای صفحه اضافه می‌شود؛
        // فایل index.html روی دیسک و در Chrome بدون تغییر است.
        if (p === '/index.html') d = Buffer.from(d.toString('utf8').replace('<head>', '<head><script src="/tf-shim.js"></script>'), 'utf8');
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
        res.end(d);
      });
    });
    srv.once('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

/* ===== پل پوشه (برای زمانی که showDirectoryPicker بومی کار نکند) =====
   renderer فقط «شناسهٔ ریشه» و مسیر نسبی می‌فرستد؛ مسیر مطلق فقط اینجا نگه‌داری می‌شود
   و هر مسیر قبل از استفاده بررسی می‌شود که از ریشه بیرون نزند. */
const DIRS = () => path.join(app.getPath('userData'), 'tf-dirs.json');
let ROOTS = {};
const loadRoots = () => { try { ROOTS = JSON.parse(fs.readFileSync(DIRS(), 'utf8')) || {}; } catch (e) { ROOTS = {}; } };
const saveRoots = () => { try { fs.writeFileSync(DIRS(), JSON.stringify(ROOTS)); } catch (e) {} };
const tfe = c => new Error('TF:' + c);
const mapErr = e => {
  if (e && /^TF:/.test(e.message)) return e;
  const c = e && e.code;
  return tfe(c === 'ENOENT' ? 'NotFoundError' : (c === 'EACCES' || c === 'EPERM') ? 'NotAllowedError'
    : (c === 'ENOTEMPTY' || c === 'EEXIST') ? 'InvalidModificationError' : (c === 'EISDIR' || c === 'ENOTDIR') ? 'TypeMismatchError' : 'UnknownError');
};
function rp(root, parts) {
  const r = ROOTS[root];
  if (!r) throw tfe('NotFoundError');
  if (!Array.isArray(parts)) throw tfe('SecurityError');
  for (const x of parts) if (typeof x !== 'string' || !x || x === '.' || x === '..' || /[\/\\\0]/.test(x)) throw tfe('SecurityError');
  return path.join(r.path, ...parts);
}
function guard(fn) {
  return async (e, ...a) => {
    if (!e.senderFrame || !String(e.senderFrame.url).startsWith(ORIGIN + '/')) throw tfe('SecurityError');
    try { return await fn(e, ...a); } catch (x) { throw mapErr(x); }
  };
}
function setupIpc() {
  loadRoots();
  ipcMain.handle('tf:pick', guard(async (e, o) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const opt = { properties: ['openDirectory', 'createDirectory'] };
    if (o && o.start === 'videos') { try { opt.defaultPath = app.getPath('videos'); } catch (x) {} }
    const r = await dialog.showOpenDialog(w, opt);
    if (r.canceled || !r.filePaths[0]) throw tfe('AbortError');
    const p = r.filePaths[0];
    let id = Object.keys(ROOTS).find(k => ROOTS[k].path === p);
    if (!id) { id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); ROOTS[id] = { path: p, name: path.basename(p) }; saveRoots(); }
    return { root: id, name: ROOTS[id].name };
  }));
  ipcMain.handle('tf:list', guard(async (e, root, parts) => {
    const out = [];
    for (const d of await fs.promises.readdir(rp(root, parts), { withFileTypes: true })) {
      let dir = d.isDirectory();
      if (d.isSymbolicLink()) { try { dir = (await fs.promises.stat(path.join(rp(root, parts), d.name))).isDirectory(); } catch (x) { continue; } }
      out.push({ name: d.name, kind: dir ? 'directory' : 'file' });
    }
    return out;
  }));
  ipcMain.handle('tf:stat', guard(async (e, root, parts) => {
    try { const s = await fs.promises.stat(rp(root, parts)); return { kind: s.isDirectory() ? 'directory' : 'file', size: s.size, mtime: s.mtimeMs }; }
    catch (x) { if (x && x.code === 'ENOENT') return null; throw x; }
  }));
  ipcMain.handle('tf:read', guard(async (e, root, parts) => {
    const p = rp(root, parts), s = await fs.promises.stat(p);
    if (s.isDirectory()) throw tfe('TypeMismatchError');
    return { data: await fs.promises.readFile(p), mtime: s.mtimeMs };
  }));
  ipcMain.handle('tf:write', guard(async (e, root, parts, data) => {
    const p = rp(root, parts);
    try { if ((await fs.promises.stat(p)).isDirectory()) throw tfe('TypeMismatchError'); } catch (x) { if (!x || x.code !== 'ENOENT') throw x; }
    const tmp = p + '.tf-tmp-' + process.pid;
    try { await fs.promises.writeFile(tmp, Buffer.from(data)); await fs.promises.rename(tmp, p); }
    catch (x) { try { await fs.promises.unlink(tmp); } catch (y) {} throw x; }
    return true;
  }));
  ipcMain.handle('tf:mkdir', guard(async (e, root, parts) => { try { await fs.promises.mkdir(rp(root, parts)); } catch (x) { if (!x || x.code !== 'EEXIST') throw x; } return true; }));
  ipcMain.handle('tf:remove', guard(async (e, root, parts, rec) => {
    if (!parts.length) throw tfe('SecurityError');
    const p = rp(root, parts), s = await fs.promises.stat(p);
    if (s.isDirectory()) { if (rec) await fs.promises.rm(p, { recursive: true }); else await fs.promises.rmdir(p); }
    else await fs.promises.unlink(p);
    return true;
  }));
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'توت فرنگی', backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') }
  });
  win.loadURL(`${ORIGIN}/`);
  // v100.93: لاگ موقت — پیام‌های «[tf]» کنسول در فایل tf-debug.log داخل پوشهٔ userData نوشته می‌شود
  // (مک: ~/Library/Application Support/توت فرنگی/tf-debug.log)
  win.webContents.on('console-message', (ev, ...a) => {
    const msg = typeof a[1] === 'string' ? a[1] : (ev && ev.message) || '';
    if (!/^\[tf\]/.test(msg)) return;
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'tf-debug.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {}
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOWED.includes(perm)));
    // v100.93: بررسی‌های دسترسی (مثل queryPermission روی handle پوشه) هم برای همین فهرست و فقط برای مبدأ برنامه مجاز است
    session.defaultSession.setPermissionCheckHandler((wc, perm, origin) =>
      ALLOWED.includes(perm) && (!origin || origin.startsWith(ORIGIN)));
    setupIpc();
    try { await startServer(); }
    catch (e) {
      require('electron').dialog.showErrorBox('توت فرنگی', `پورت ${PORT} اشغال است؛ برنامهٔ دیگری را ببند و دوباره باز کن.`);
      return app.quit();
    }
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
