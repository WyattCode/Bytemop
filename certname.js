'use strict';
// The common name of a certificate subject: 'CN="NetEase (Hangzhou) Network Co., Ltd.", O=...' -> 'NetEase (Hangzhou) Network Co., Ltd.'
// (a quoted name may contain commas; an unquoted one ends at the first comma).
function commonName(subject) {
  const m = /CN=(?:"([^"]+)"|([^,]+))/.exec(String(subject || ''));
  return m ? (m[1] || m[2] || '').trim() : '';
}

module.exports = { commonName };
