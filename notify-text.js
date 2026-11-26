'use strict';
// Notification wording (the background run has no renderer, so it cannot use the UI dictionary).
const TEXT = {
  'zh-CN': {
    found: ['Bytemop 发现可清理内容', '{size} 可以安全清理。打开 Bytemop 查看并清理。'],
    cleaned: ['Bytemop 已自动清理', '已把 {size}（{n} 个文件）移入隔离区，{d} 天内可在“历史与还原”里还原。'],
    limit: ['Bytemop 未能自动清理', '隔离区已达上限。请打开 Bytemop 清空隔离区后再试。'],
    lowDisk: ['磁盘空间不足', '{drive} 盘只剩 {free}（{pct}%）。打开 Bytemop 看看能释放多少空间。'],
    test: ['Bytemop 测试通知', '如果你看到这条消息，说明通知功能正常。'],
  },
  en: {
    found: ['Bytemop found things to clean', '{size} can be cleaned safely. Open Bytemop to review and clean.'],
    cleaned: ['Bytemop cleaned automatically', 'Moved {size} ({n} files) to quarantine. You can restore it from History & Restore for {d} days.'],
    limit: ['Bytemop could not clean automatically', 'The quarantine is full. Open Bytemop and empty it, then try again.'],
    lowDisk: ['Low disk space', 'Drive {drive} has only {free} left ({pct}%). Open Bytemop to see how much you can free.'],
    test: ['Bytemop test notification', 'If you can see this message, notifications work.'],
  },
};

function resolveLocale(language, systemLocale) {
  if (language === 'zh-CN' || language === 'en') return language;
  return String(systemLocale || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function message(locale, key, vars = {}) {
  const [title, body] = (TEXT[locale] || TEXT.en)[key];
  const fill = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : vars[k]));
  return { title: fill(title), body: fill(body) };
}

function formatBytes(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes || 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  if (i > 0 && i < u.length - 1 && Number(n.toFixed(n >= 100 ? 0 : 1)) >= 1024) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
}

module.exports = { message, resolveLocale, formatBytes };
