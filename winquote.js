'use strict';
// Quote one argument for a Windows command line (CommandLineToArgvW rules): backslashes only need doubling
// where they precede a double quote, including the closing one added here.
function quoteWinArg(arg) {
  const a = String(arg);
  if (a !== '' && !/[\s"]/.test(a)) return a;
  let out = '"';
  let backslashes = 0;
  for (const ch of a) {
    if (ch === '\\') { backslashes += 1; continue; }
    if (ch === '"') { out += '\\'.repeat(backslashes * 2 + 1) + '"'; backslashes = 0; continue; }
    out += '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  return out + '\\'.repeat(backslashes * 2) + '"';
}

module.exports = { quoteWinArg };
