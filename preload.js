// پل امن بین صفحه و برنامهٔ اصلی. فقط عملیات پوشه با «شناسهٔ ریشه» + مسیر نسبی؛ مسیر مطلق هرگز به صفحه داده نمی‌شود.
const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, ...a) => ipcRenderer.invoke('tf:' + c, ...a);
contextBridge.exposeInMainWorld('tfBridge', {
  pick: o => inv('pick', o),
  list: (r, p) => inv('list', r, p),
  stat: (r, p) => inv('stat', r, p),
  read: (r, p) => inv('read', r, p),
  write: (r, p, d) => inv('write', r, p, d),
  mkdir: (r, p) => inv('mkdir', r, p),
  remove: (r, p, rec) => inv('remove', r, p, rec)
});
