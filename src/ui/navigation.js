// Use the browser entry when returning to its exact destination; deep links have a fallback.
export function returnTo(hash, previousHash = '') {
  if (previousHash === hash && history.length > 1) history.back();
  else location.hash = hash;
}
export const backIcon = '<span class="pageBack__icon" aria-hidden="true">‹</span>';
