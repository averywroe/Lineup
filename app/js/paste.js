// "Paste lineup": parse nine lines of names and positions.
// Accepts e.g. "Derek Jeter SS", "1. Jeter, SS", "SS - Derek Jeter", "2) A.J. Pierzynski (C)".

const POS_ALIASES = {
  P: 'P', SP: 'P', C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', LF: 'LF', CF: 'CF', RF: 'RF', DH: 'DH',
  '1': 'P', '2': 'C', '3': '1B', '4': '2B', '5': '3B', '6': 'SS', '7': 'LF', '8': 'CF', '9': 'RF',
};
export function parseLine(line) {
  let s = String(line || '').trim();
  if (!s) return null;
  s = s.replace(/^\s*#?\d{1,2}(?:\s*[.):\-]\s*|\s+)(?=\S)/, '');      // leading batting-order number
  const P = '(SP|P|C|1B|2B|3B|SS|LF|CF|RF|DH)';
  let name = s, pos = '', m;
  if ((m = s.match(new RegExp(`^(.*?\\S)[\\s,;|(\\[\\-–—:/]+${P}[\\s.)\\]]*$`, 'i')))) { name = m[1]; pos = m[2]; }
  else if ((m = s.match(new RegExp(`^[(\\[]?${P}[)\\]]?(?:[\\s,;|:\\-–—/]+)(.+)$`, 'i')))) { pos = m[1]; name = m[2]; }
  name = name.replace(/[,;|()[\]\t]+/g, ' ').replace(/\s+[-–—:/]+\s*$/, '').replace(/^\s*[-–—:/]+\s+/, '')
    .replace(/\s+/g, ' ').trim();
  return { name, pos: pos ? POS_ALIASES[pos.toUpperCase()] : '' };
}

export function parseLineup(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(parseLine).filter(Boolean);
}
