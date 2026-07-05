// Converts [data-timeago] elements to relative time strings and updates them every 60s.
(function () {
  function timeAgo(dateStr) {
    var date = new Date(dateStr);
    if (isNaN(date)) return dateStr;
    var seconds = Math.floor((Date.now() - date) / 1000);
    if (seconds < 5)   return 'just now';
    if (seconds < 60)  return seconds + ' sec ago';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60)  return minutes + ' min ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24)    return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
    var days = Math.floor(hours / 24);
    if (days < 7)      return days + ' day' + (days === 1 ? '' : 's') + ' ago';
    var weeks = Math.floor(days / 7);
    if (weeks < 5)     return weeks + ' week' + (weeks === 1 ? '' : 's') + ' ago';
    var months = Math.floor(days / 30);
    if (months < 12)   return months + ' month' + (months === 1 ? '' : 's') + ' ago';
    var years = Math.floor(days / 365);
    return years + ' year' + (years === 1 ? '' : 's') + ' ago';
  }

  function updateAll() {
    document.querySelectorAll('[data-timeago]').forEach(function (el) {
      el.textContent = timeAgo(el.dataset.timeago);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    updateAll();
    setInterval(updateAll, 60000);
  });
}());
