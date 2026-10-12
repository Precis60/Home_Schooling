import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { createSanitizer, isAllowedLink, isStoragePath } from './sanitize.js';
import { htmlToDocxBlob } from './docx.js';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  LINE_HEIGHTS,
  TEXT_COLORS,
  HIGHLIGHT_COLORS,
  FontSize,
  BlockSpacing,
  PageBreak,
  StoredImage,
  indent,
  outdent,
  clearFormatting,
  findNext,
  replaceCurrent,
  replaceAll,
  insertStoredImage,
  setImageSources,
  queryState,
} from './extensions.js';

const root = typeof globalThis !== 'undefined' ? globalThis : window;
const sanitizer = createSanitizer(root);

function imageFiles(data) {
  if (!data) return [];
  const files = [];
  const list = data.files ? Array.from(data.files) : [];
  list.forEach(file => {
    if (file && /^image\/(png|jpeg|gif|webp)$/.test(file.type)) files.push(file);
  });
  if (!files.length && data.items) {
    Array.from(data.items).forEach(item => {
      if (item.kind === 'file' && /^image\/(png|jpeg|gif|webp)$/.test(item.type)) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    });
  }
  return files;
}

function createEditor(element, options = {}) {
  let editor = null;
  editor = new Editor({
    element,
    editable: options.editable !== false,
    content: sanitizer.sanitizeHtml(options.html || ''),
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        blockquote: false,
        heading: { levels: [1, 2, 3, 4] },
      }),
      Underline,
      Subscript,
      Superscript,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({
        openOnClick: options.openLinks === true,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        isAllowedUri: url => isAllowedLink(url),
      }),
      StoredImage.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      CharacterCount.configure({ limit: 400000 }),
      BlockSpacing,
      PageBreak,
    ],
    editorProps: {
      attributes: {
        class: 'doc-prose',
        spellcheck: 'true',
        'aria-label': 'Document',
      },
      handlePaste(_view, event) {
        const files = imageFiles(event.clipboardData);
        if (!files.length || !options.onImageFiles) return false;
        event.preventDefault();
        options.onImageFiles(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = imageFiles(event.dataTransfer);
        if (!files.length || !options.onImageFiles) return false;
        event.preventDefault();
        options.onImageFiles(files);
        return true;
      },
      handleKeyDown(_view, event) {
        if (!editor) return false;
        if (event.key === 'Tab' && !editor.isActive('table')) {
          event.preventDefault();
          if (event.shiftKey) outdent(editor);
          else indent(editor);
          return true;
        }
        return false;
      },
    },
    onUpdate() {
      if (options.onUpdate) options.onUpdate();
    },
    onSelectionUpdate() {
      if (options.onSelection) options.onSelection();
    },
  });
  return editor;
}

export {
  FONT_FAMILIES,
  FONT_SIZES,
  LINE_HEIGHTS,
  TEXT_COLORS,
  HIGHLIGHT_COLORS,
  createEditor,
  indent,
  outdent,
  clearFormatting,
  findNext,
  replaceCurrent,
  replaceAll,
  insertStoredImage,
  setImageSources,
  queryState,
  isStoragePath,
  isAllowedLink,
};

export function sanitizeHtml(html) {
  return sanitizer.sanitizeHtml(html);
}

export function prepareHtmlForStorage(html) {
  return sanitizer.prepareHtmlForStorage(html);
}

export function exportDocx(html, options) {
  return htmlToDocxBlob(sanitizer.prepareHtmlForStorage(html), {
    ...options,
    window: options.window || root,
  });
}
