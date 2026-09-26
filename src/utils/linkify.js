
// Rend cliquables (tel:) les numéros de téléphone présents dans l'éditeur de notes.
// Parcourt les noeuds de texte, enveloppe chaque numéro valide dans un lien <a href="tel:+1...">.
// Idempotent: ignore les numéros déjà dans un <a>. Renvoie true si quelque chose a changé.
export const linkifyPhonesInEditor = (root) => {
  if (!root) return false;
  const RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue) continue;
    if (node.parentElement && node.parentElement.closest('a')) continue; // déjà un lien
    RE.lastIndex = 0;
    if (RE.test(node.nodeValue)) targets.push(node);
  }
  let changedAny = false;
  targets.forEach((textNode) => {
    const text = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0, m, appended = false;
    RE.lastIndex = 0;
    while ((m = RE.exec(text))) {
      const raw = m[0];
      const before = m.index > 0 ? text[m.index - 1] : '';
      const after = text[m.index + raw.length] || '';
      const digits = raw.replace(/\D/g, '');
      const valid = digits.length === 10 || (digits.length === 11 && digits[0] === '1');
      // Évite de couper un nombre plus long et exige 10 (ou 11 avec indicatif 1) chiffres.
      if (/\d/.test(before) || /\d/.test(after) || !valid) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const tel = digits.length === 10 ? '1' + digits : digits;
      const a = document.createElement('a');
      a.href = 'tel:+' + tel;
      a.textContent = raw;
      a.setAttribute('style', 'color:#60a5fa;text-decoration:underline');
      frag.appendChild(a);
      last = m.index + raw.length;
      appended = true;
    }
    if (appended) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
      changedAny = true;
    }
  });
  return changedAny;
};
