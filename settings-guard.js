'use strict';
// Settings changes that weaken protection must be confirmed by the main process itself. A confirmation drawn
// by the renderer is only a convenience: anything that can call the settings IPC could skip it.
// No Electron imports; main.js shows the dialog.

// Which parts of `next` (already sanitized) are less protective than `current`.
function sensitiveChanges(current, next) {
  const out = [];
  if (next.deleteMode === 'permanent' && current.deleteMode !== 'permanent') out.push('permanent');
  // A shorter retention makes quarantined files expire sooner, i.e. removes the chance to undo.
  if (next.retentionDays < current.retentionDays) out.push('retention');
  return out;
}

const TEXT = {
  'zh-CN': {
    title: '确认降低保护',
    permanent: '改为永久删除：之后的清理会直接删除文件，不进入隔离区，也无法还原。',
    retention: '缩短隔离保留天数：更早到期的隔离文件会被永久删除，之后就无法还原。',
    ok: '确认修改', cancel: '取消',
  },
  en: {
    title: 'Confirm weaker protection',
    permanent: 'Switch to permanent delete: from now on cleaning deletes files directly, nothing goes to quarantine and it cannot be undone.',
    retention: 'Shorten quarantine retention: quarantined files expire sooner and are then deleted for good, so they can no longer be restored.',
    ok: 'Change setting', cancel: 'Cancel',
  },
};

// Options for dialog.showMessageBox. The safe button (cancel) is the default.
function confirmOptions(locale, risky) {
  const x = TEXT[locale] || TEXT.en;
  return { type: 'warning', buttons: [x.cancel, x.ok], defaultId: 0, cancelId: 0, noLink: true, title: 'Bytemop', message: x.title, detail: risky.map((r) => x[r]).join('\n\n') };
}

// The patch with the risky fields put back to what they were (used when the user declines).
function withoutRisky(patch, current, risky) {
  const p = { ...patch };
  if (risky.includes('permanent')) p.deleteMode = current.deleteMode;
  if (risky.includes('retention')) p.retentionDays = current.retentionDays;
  return p;
}

module.exports = { sensitiveChanges, confirmOptions, withoutRisky };
