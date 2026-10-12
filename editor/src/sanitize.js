import createDOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'hr', 'div', 'mark', 'label', 'input',
];

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'style', 'class', 'colspan', 'rowspan', 'target', 'rel',
  'type', 'checked', 'width', 'height',
  'data-path', 'data-type', 'data-checked', 'data-indent', 'data-line-height', 'data-page-break', 'data-color',
];

const STYLE_PROPS = new Set(['color', 'background-color', 'font-family', 'font-size', 'text-align']);

export function isStoragePath(path) {
  if (typeof path !== 'string' || path.length < 8 || path.length > 400) return false;
  if (path.includes('..') || path.includes('\\') || path.includes(' ') || path.startsWith('/')) return false;
  const parts = path.split('/');
  if (parts.length !== 3) return false;
  const [owner, docId, file] = parts;
  if (!owner || owner.length > 320 || !owner.includes('@') || owner.includes('/')) return false;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  if (!new RegExp('^' + uuid + '$', 'i').test(docId)) return false;
  if (!new RegExp('^' + uuid + '\\.(png|jpe?g|gif|webp)$', 'i').test(file)) return false;
  return true;
}

export function isAllowedLink(url) {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) || /^mailto:/i.test(value);
}

function keepStyle(value) {
  const kept = [];
  String(value || '').split(';').forEach(part => {
    const splitAt = part.indexOf(':');
    if (splitAt === -1) return;
    const prop = part.slice(0, splitAt).trim().toLowerCase();
    const raw = part.slice(splitAt + 1).trim();
    if (!STYLE_PROPS.has(prop)) return;
    if (/url\(|expression|javascript|@import|\/\*|\*\//i.test(raw)) return;
    if ((prop === 'color' || prop === 'background-color') && !/^(#[0-9a-f]{3}|#[0-9a-f]{6}|inherit|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i.test(raw)) return;
    if (prop === 'font-size' && !/^\d+(\.\d+)?(pt|px)$/i.test(raw)) return;
    if (prop === 'text-align' && !/^(left|center|right|justify)$/i.test(raw)) return;
    if (prop === 'font-family' && !/^[-a-z0-9 ,"']+$/i.test(raw)) return;
    kept.push(prop + ': ' + raw);
  });
  return kept.join('; ');
}

function dropNode(node) {
  if (node.parentNode) node.parentNode.removeChild(node);
}

export function createSanitizer(win) {
  const purify = createDOMPurify(win);

  purify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'style') {
      const next = keepStyle(data.attrValue);
      data.attrValue = next;
      if (!next) data.keepAttr = false;
    }
    if (data.attrName === 'href' && !isAllowedLink(data.attrValue)) {
      data.keepAttr = false;
    }
    if (data.attrName === 'src') {
      const src = String(data.attrValue || '').trim();
      const path = node.getAttribute && node.getAttribute('data-path');
      const safeBlob = src.startsWith('blob:') && isStoragePath(path);
      const safeData = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src);
      if (!safeBlob && !safeData) data.keepAttr = false;
    }
  });

  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'input') {
      const type = (node.getAttribute && node.getAttribute('type')) || '';
      if (type.toLowerCase() !== 'checkbox') dropNode(node);
    }
    if (data.tagName === 'img') {
      const path = node.getAttribute && node.getAttribute('data-path');
      if (!isStoragePath(path)) dropNode(node);
    }
    if (data.tagName === 'a') {
      node.setAttribute('rel', 'noopener noreferrer nofollow');
      node.setAttribute('target', '_blank');
    }
  });

  function sanitizeHtml(html) {
    return purify.sanitize(String(html || ''), {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
  }

  function prepareHtmlForStorage(html) {
    const clean = sanitizeHtml(html);
    const doc = new win.DOMParser().parseFromString('<div>' + clean + '</div>', 'text/html');
    const root = doc.body.firstElementChild || doc.body;
    root.querySelectorAll('img').forEach(img => {
      const path = img.getAttribute('data-path');
      if (!isStoragePath(path)) {
        img.remove();
        return;
      }
      img.removeAttribute('src');
    });
    root.querySelectorAll('a').forEach(anchor => {
      const href = anchor.getAttribute('href');
      if (!isAllowedLink(href)) anchor.removeAttribute('href');
    });
    return sanitizeHtml(root.innerHTML);
  }

  return { sanitizeHtml, prepareHtmlForStorage };
}
