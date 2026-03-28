window.addEventListener('error', function(e) {
  if (e.filename && (e.filename.indexOf('webkit-masked-url') !== -1 || e.filename.indexOf('extension') !== -1)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    return true;
  }
  if (e.message && (e.message.indexOf('fixinatorInputs') !== -1 || e.message.indexOf('webkit-masked-url') !== -1)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    return true;
  }
}, true);
window.addEventListener('unhandledrejection', function(e) {
  var r = e.reason;
  if (r && typeof r === 'object' && r.stack && r.stack.indexOf('webkit-masked-url') !== -1) {
    e.stopImmediatePropagation();
    e.preventDefault();
    return true;
  }
}, true);
