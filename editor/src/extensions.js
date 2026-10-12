import { Extension, Node } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { isStoragePath } from './sanitize.js';

export const FONT_FAMILIES = [
  { label: 'Grotesk', value: '"Schibsted Grotesk", "Segoe UI", sans-serif' },
  { label: 'Fraunces', value: 'Fraunces, Georgia, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
];

export const FONT_SIZES = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '36pt'];
export const LINE_HEIGHTS = [
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
];

export const TEXT_COLORS = ['#1c1917', '#0f5c45', '#9a4b24', '#be123c', '#1d4e89', '#a16207', '#6d28d9', '#44403c'];
export const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecdd3', '#fed7aa', '#e9d5ff', '#e7e5e4'];

export const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: element => element.style.fontSize || null,
          renderHTML: attributes => {
            if (!attributes.fontSize) return {};
            return { style: 'font-size: ' + attributes.fontSize };
          },
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: fontSize => ({ chain }) => chain().setMark('textStyle', { fontSize }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

export const BlockSpacing = Extension.create({
  name: 'blockSpacing',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: element => {
            const value = parseInt(element.getAttribute('data-indent') || '0', 10);
            return Number.isFinite(value) ? Math.max(0, Math.min(8, value)) : 0;
          },
          renderHTML: attributes => {
            const indent = Number(attributes.indent) || 0;
            if (!indent) return {};
            return { 'data-indent': String(indent) };
          },
        },
        lineHeight: {
          default: null,
          parseHTML: element => element.getAttribute('data-line-height') || null,
          renderHTML: attributes => {
            if (!attributes.lineHeight) return {};
            return { 'data-line-height': String(attributes.lineHeight) };
          },
        },
      },
    }];
  },
  addCommands() {
    return {
      setLineHeight: value => ({ editor, commands }) => {
        const type = editor.isActive('heading') ? 'heading' : 'paragraph';
        return commands.updateAttributes(type, { lineHeight: value || null });
      },
    };
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML() {
    return ['div', { 'data-page-break': 'true', class: 'hs-page-break' }];
  },
  addCommands() {
    return {
      setPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }),
    };
  },
});

export const StoredImage = Image.extend({
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      storagePath: {
        default: null,
        parseHTML: element => {
          const path = element.getAttribute('data-path');
          return isStoragePath(path) ? path : null;
        },
        renderHTML: attributes => {
          if (!isStoragePath(attributes.storagePath)) return {};
          return { 'data-path': attributes.storagePath };
        },
      },
    };
  },
  parseHTML() {
    return [{
      tag: 'img[data-path]',
      getAttrs: element => {
        const path = element.getAttribute('data-path');
        if (!isStoragePath(path)) return false;
        return { storagePath: path, src: null, alt: element.getAttribute('alt') };
      },
    }];
  },
});

function blockType(editor) {
  return editor.isActive('heading') ? 'heading' : 'paragraph';
}

export function indent(editor) {
  if (editor.isActive('taskItem')) return editor.chain().focus().sinkListItem('taskItem').run();
  if (editor.isActive('listItem')) return editor.chain().focus().sinkListItem('listItem').run();
  const attrs = editor.getAttributes(blockType(editor));
  const next = Math.min(8, (Number(attrs.indent) || 0) + 1);
  return editor.chain().focus().updateAttributes(blockType(editor), { indent: next }).run();
}

export function outdent(editor) {
  if (editor.isActive('taskItem')) return editor.chain().focus().liftListItem('taskItem').run();
  if (editor.isActive('listItem')) return editor.chain().focus().liftListItem('listItem').run();
  const attrs = editor.getAttributes(blockType(editor));
  const next = Math.max(0, (Number(attrs.indent) || 0) - 1);
  return editor.chain().focus().updateAttributes(blockType(editor), { indent: next }).run();
}

export function clearFormatting(editor) {
  return editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().command(({ tr, state }) => {
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 0, lineHeight: null, textAlign: null });
      }
    });
    return true;
  }).run();
}

function locate(doc, query, fromPos, beforePos) {
  const needle = query.toLowerCase();
  let found = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const text = node.text;
    const lower = text.toLowerCase();
    let start = 0;
    if (fromPos > pos) start = Math.max(0, fromPos - pos);
    if (beforePos != null && pos >= beforePos) return false;
    const index = lower.indexOf(needle, start);
    if (index === -1) return;
    const from = pos + index;
    const to = from + query.length;
    if (beforePos != null && from >= beforePos) return;
    found = { from, to };
  });
  return found;
}

export function findNext(editor, query) {
  const needle = String(query || '');
  if (!needle) return false;
  const cursor = editor.state.selection.to;
  const found = locate(editor.state.doc, needle, cursor) || locate(editor.state.doc, needle, 0, cursor);
  if (!found) return false;
  editor.chain().focus().setTextSelection(found).scrollIntoView().run();
  return true;
}

export function replaceCurrent(editor, query, replacement) {
  const needle = String(query || '');
  if (!needle) return false;
  const { from, to } = editor.state.selection;
  const selected = editor.state.doc.textBetween(from, to, '');
  if (selected.toLowerCase() !== needle.toLowerCase()) {
    if (!findNext(editor, needle)) return false;
  }
  const sel = editor.state.selection;
  editor.chain().focus().command(({ tr }) => {
    tr.insertText(String(replacement || ''), sel.from, sel.to);
    return true;
  }).run();
  findNext(editor, needle);
  return true;
}

export function replaceAll(editor, query, replacement) {
  const needle = String(query || '');
  if (!needle) return 0;
  const matches = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const lower = node.text.toLowerCase();
    const q = needle.toLowerCase();
    let index = 0;
    while (index <= lower.length - q.length) {
      const found = lower.indexOf(q, index);
      if (found === -1) break;
      matches.push({ from: pos + found, to: pos + found + needle.length });
      index = found + needle.length;
    }
  });
  if (!matches.length) return 0;
  const next = String(replacement || '');
  editor.chain().focus().command(({ tr }) => {
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      tr.insertText(next, matches[i].from, matches[i].to);
    }
    return true;
  }).run();
  return matches.length;
}

export function insertStoredImage(editor, storagePath, src) {
  if (!isStoragePath(storagePath)) return false;
  return editor.chain().focus().setImage({
    src: src || null,
    alt: '',
    storagePath,
  }).run();
}

export function setImageSources(editor, sources) {
  const { state } = editor;
  let tr = state.tr;
  const updates = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image') return;
    const path = node.attrs.storagePath;
    if (path && sources[path] && node.attrs.src !== sources[path]) {
      updates.push({ pos, attrs: { ...node.attrs, src: sources[path] } });
    }
  });
  updates.forEach(update => {
    tr = tr.setNodeMarkup(update.pos, undefined, update.attrs);
  });
  if (!tr.docChanged) return;
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

export function queryState(editor) {
  let style = 'p';
  if (editor.isActive('heading', { level: 1 })) style = 'h1';
  else if (editor.isActive('heading', { level: 2 })) style = 'h2';
  else if (editor.isActive('heading', { level: 3 })) style = 'h3';
  else if (editor.isActive('heading', { level: 4 })) style = 'h4';
  const textStyle = editor.getAttributes('textStyle') || {};
  const block = editor.getAttributes(blockType(editor)) || {};
  let align = 'left';
  ['center', 'right', 'justify', 'left'].some(value => {
    if (editor.isActive({ textAlign: value })) {
      align = value;
      return true;
    }
    return false;
  });
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    subscript: editor.isActive('subscript'),
    superscript: editor.isActive('superscript'),
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
    task: editor.isActive('taskList'),
    style,
    fontFamily: textStyle.fontFamily || '',
    fontSize: textStyle.fontSize || '',
    lineHeight: block.lineHeight || '',
    align,
    words: editor.storage.characterCount ? editor.storage.characterCount.words() : 0,
  };
}
