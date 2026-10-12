import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { htmlToDocxBlob } from './src/docx.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');

test('docx export keeps text and drops script tags', async () => {
  const blob = await htmlToDocxBlob(
    '<h1>Sample lesson</h1><p>Hello <strong>world</strong></p><script>alert(1)</script><ul><li><p>One</p></li></ul>',
    { title: 'Sample lesson', window: dom.window }
  );
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  const core = await zip.file('docProps/core.xml').async('string');
  assert.match(xml, /Sample lesson/);
  assert.match(xml, /Hello/);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /world/);
  assert.match(xml, /<w:numId /);
  assert.doesNotMatch(xml, /<script/i);
  assert.match(core, /Sample lesson/);
});
