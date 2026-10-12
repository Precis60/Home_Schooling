import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lesson-documents.js', import.meta.url), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source, context);
const links = context.HSLessonLinks;

const doc = { id: 'doc-1', title: 'Algebra notes', owner_email: 'Student.One@example.com' };
const shared = { id: 'doc-2', title: 'Reading list', owner_email: 'student.two@example.com' };
const task = { id: 'lesson-1', title: 'Fractions', assignee: 'student.one@example.com', assignees: ['student.one@example.com'], startDate: '2026-10-14' };

test('a lesson only counts a document the assignee can already open', () => {
  assert.equal(links.assigneeCanSeeDocument(doc, task, []), true);
  assert.equal(links.assigneeCanSeeDocument(shared, task, []), false);
  assert.equal(links.assigneeCanSeeDocument(shared, task, [
    { document_id: 'doc-2', shared_with_email: 'STUDENT.ONE@example.com' },
  ]), true);
  assert.equal(links.assigneeCanSeeDocument(shared, { assignee: 'student.two@example.com' }, []), true);
  assert.equal(links.assigneeCanSeeDocument(shared, { assignees: ['student.two@example.com'] }, []), true);
  assert.equal(links.assigneeCanSeeDocument(null, task, []), false);
});

test('search matches titles and does not invent documents', () => {
  const catalog = [shared, doc, { id: 'doc-3', title: 'Science lab' }];
  assert.deepEqual(links.filterDocuments(catalog, 'alg').map(item => item.id), ['doc-1']);
  assert.deepEqual(links.filterDocuments(catalog, '').map(item => item.id), ['doc-1', 'doc-2', 'doc-3']);
  assert.deepEqual(links.filterDocuments(catalog, 'missing'), []);
});

test('lesson labels stay on the tasks the caller can already see', () => {
  const rows = [
    { task_id: 'lesson-1', document_id: 'doc-1' },
    { task_id: 'lesson-2', document_id: 'doc-1' },
    { task_id: 'other', document_id: 'doc-2' },
  ];
  assert.equal(links.countForTask(rows, 'lesson-1'), 1);
  const shown = links.lessonsForDocument(rows, [task], 'doc-1');
  assert.deepEqual(shown.map(item => item.label), ['Fractions · 2026-10-14', 'Lesson']);
  assert.equal(shown[1].title, 'Lesson');
});

test('the lesson modal and document view are wired to the link helper', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../documents.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../documents.css', import.meta.url), 'utf8');
  assert.match(html, /lesson-documents\.js/);
  assert.match(html, /id="lessonDocsSearch"/);
  assert.match(html, /id="lessonDocsCreate"/);
  assert.match(html, /hs_lesson_documents/);
  assert.match(docs, /hs_lesson_documents/);
  assert.match(docs, /docsLessons/);
  assert.match(css, /\.docs-lessons\[hidden\]/);
  assert.match(html, /\.lesson-docs-results\[hidden\]/);
});
