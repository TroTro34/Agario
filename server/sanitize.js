// Nettoyage des chaines venant du client.
// Le filtre est construit par code point : aucun litteral invisible dans le source.

const NAME_MAX = 15;

function stripInvisible(raw) {
  let out = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || cp === 0x7f) continue;         // caracteres de controle
    if (cp >= 0x200b && cp <= 0x200f) continue;     // zero-width / marques de direction
    if (cp >= 0x2028 && cp <= 0x202e) continue;     // separateurs de ligne / overrides bidi
    if (cp >= 0x2066 && cp <= 0x2069) continue;     // isolats bidi
    if (cp === 0xfeff) continue;                    // BOM
    out += ch;
  }
  return out;
}

export function sanitizeName(raw) {
  if (typeof raw !== 'string') return 'Anonyme';
  const s = stripInvisible(raw).replace(/\s+/g, ' ').trim();
  return s.slice(0, NAME_MAX) || 'Anonyme';
}

export function sanitizeChat(raw, max = 120) {
  if (typeof raw !== 'string') return '';
  return stripInvisible(raw).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function sanitizeSkin(raw, allowed) {
  if (typeof raw !== 'string') return allowed[0];
  return allowed.includes(raw) ? raw : allowed[0];
}
