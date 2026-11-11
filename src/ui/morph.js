/**
 * Update a part of the page to new markup WITHOUT rebuilding it.
 *
 * Setting innerHTML throws every element away and makes new ones: pictures are recreated (and can
 * flash while they decode), running animations stop, hover and focus are lost. morphInto instead
 * compares the new markup with what is on screen and changes only what differs: an attribute here,
 * a text there. An element that did not change is left exactly as it is.
 *
 * Elements with a data-tid (creature tokens) are matched by that key wherever they sit, so a token
 * keeps its element (and its glide animation) even when things before it in the list change.
 */
export function morphInto(target, html) {
  const tmp = target.cloneNode(false);
  tmp.innerHTML = html;
  morphChildren(target, tmp);
}

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-tid') : null);

function morphChildren(a, b) {
  const old = [...a.childNodes];
  const keyed = new Map(); const plain = [];
  for (const n of old) { const k = keyOf(n); if (k) keyed.set(k, n); else plain.push(n); }
  let u = 0;
  const fresh = [...b.childNodes];
  fresh.forEach((nb, i) => {
    const k = keyOf(nb);
    let cand = k ? keyed.get(k) : plain[u++];
    if (k) keyed.delete(k);
    const node = cand ? morphNode(cand, nb) : nb;
    if (a.childNodes[i] !== node) a.insertBefore(node, a.childNodes[i] ?? null);
  });
  while (a.childNodes.length > fresh.length) a.removeChild(a.lastChild);
}

/** Make node x look like node y; returns the node that ends up in the page. */
function morphNode(x, y) {
  if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { x.replaceWith(y); return y; }
  if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return x; }
  if (x.isEqualNode(y)) return x;
  for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
  for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
  // Form controls: the live state lives in properties, not attributes.
  if (x.nodeName === 'INPUT') { x.checked = y.hasAttribute('checked'); if (x.type !== 'checkbox' && x.type !== 'radio' && document.activeElement !== x) x.value = y.getAttribute('value') ?? ''; }
  if (x.nodeName === 'SELECT') { morphChildren(x, y); const sel = [...y.options].findIndex((o) => o.hasAttribute('selected')); if (sel >= 0 && document.activeElement !== x) x.selectedIndex = sel; return x; }
  morphChildren(x, y);
  return x;
}
