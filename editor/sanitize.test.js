import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSanitizer, isStoragePath } from './src/sanitize.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const { sanitizeHtml, prepareHtmlForStorage } = createSanitizer(dom.window);
const path = 'student.one@example.com/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png';

test('storage paths accept bucket keys and reject traversal', () => {
  assert.equal(isStoragePath(path), true);
  assert.equal(isStoragePath('../' + path), false);
  assert.equal(isStoragePath('https://example.com/a.png'), false);
  assert.equal(isStoragePath(path.replace('.png', '.svg')), false);
});

test('stored html cannot carry script, handlers, or foreign images', () => {
  const dirty = [
    '<p onclick="alert(1)">Hello <strong>there</strong></p>',
    '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">bad</a>',
    '<a href="https://example.com/lesson">lesson</a>',
    '<img src="https://example.com/track.png" onerror="alert(1)">',
    '<img data-path="' + path + '" src="blob:https://local/1">',
    '<p style="color: #0f5c45; background-image: url(javascript:alert(1))">Ink</p>',
  ].join('');
  const clean = prepareHtmlForStorage(dirty);
  assert.match(clean, /Hello/);
  assert.match(clean, /<strong>there<\/strong>/);
  assert.match(clean, /href="https:\/\/example.com\/lesson"/);
  assert.match(clean, new RegExp('data-path="' + path.replace(/[.]/g, '\\.') + '"'));
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onclick|onerror|javascript:/i);
  assert.doesNotMatch(clean, /blob:|https:\/\/example.com\/track|background-image/i);
  assert.match(clean, /color:\s*#0f5c45/i);
});

test('checklist and heading markup survives sanitising', () => {
  const html = '<h1>Title</h1><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Done</p></div></li></ul>';
  const clean = sanitizeHtml(html);
  assert.match(clean, /<h1>Title<\/h1>/);
  assert.match(clean, /data-type="taskList"/);
  assert.match(clean, /data-checked="true"/);
  assert.match(clean, /type="checkbox"/);
  assert.match(clean, /Done/);
});
