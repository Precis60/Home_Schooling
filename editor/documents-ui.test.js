import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function dom() {
  const markup = `<!doctype html><html><body>
    <div id="docsLibrary"><aside id="docsFolders"></aside>
      <label id="docsLibraryPickerWrap"><select id="docsLibraryPicker"></select></label>
      <input id="docsSearch">
      <button id="docsNewFolder" type="button"></button>
      <button id="docsNewDoc" type="button"></button>
      <p id="docsError" hidden></p>
      <div id="docsList"></div>
    </div>
    <div id="docsEditor" hidden>
      <button id="docsBack" type="button"></button>
      <input id="docsTitle">
      <span id="docsSaveState"></span>
      <button id="docsSave" type="button"></button>
      <button id="docsDuplicate" type="button"></button>
      <button id="docsMove" type="button"></button>
      <button id="docsShare" type="button"></button>
      <button id="docsExportDocx" type="button"></button>
      <button id="docsExportPdf" type="button"></button>
      <button id="docsPrint" type="button"></button>
      <button id="docsDelete" type="button"></button>
      <div id="docsWordbar"></div>
      <div id="docsFind" hidden>
        <input id="docsFindQuery"><input id="docsReplaceQuery">
        <button id="docsFindNext" type="button"></button>
        <button id="docsReplace" type="button"></button>
        <button id="docsReplaceAll" type="button"></button>
        <button id="docsFindClose" type="button"></button>
        <span id="docsFindStatus"></span>
      </div>
      <div id="docsLessons" hidden></div>
      <p id="docsReadOnly" hidden></p>
      <div id="docsSurface"></div>
      <span id="docsWordCount"></span>
    </div>
    <div id="docsDialog" hidden>
      <h3 id="docsDialogTitle"></h3>
      <div id="docsDialogBody"></div>
      <button id="docsDialogCancel" type="button"></button>
      <button id="docsDialogOk" type="button"></button>
    </div>
    <input id="docsImageInput" type="file">
    <div id="docPrint"></div>
  </body></html>`;
  const window = new JSDOM(markup, {
    url: 'https://precis60.github.io/Home_Schooling/',
    runScripts: 'dangerously',
  }).window;
  function install(code) {
    const script = window.document.createElement('script');
    script.textContent = code;
    window.document.body.appendChild(script);
  }
  install(readFileSync(new URL('../vendor/hs-editor.js', import.meta.url), 'utf8'));
  install(readFileSync(new URL('../lesson-documents.js', import.meta.url), 'utf8'));
  install(readFileSync(new URL('../documents.js', import.meta.url), 'utf8'));
  return window;
}

function client(state) {
  function query(table) {
    const filters = [];
    const api = {
      select() { return api; },
      order() { return api; },
      eq(column, value) { filters.push([column, value]); return api; },
      in() { return api; },
      update(row) {
        state.updates.push({ table, row });
        return api;
      },
      delete() {
        state.deletes.push(table);
        return api;
      },
      upsert(rows) {
        state.upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
      insert(row) {
        state.inserts.push({ table, row });
        const inserted = {
          ...row,
          id: table === 'hs_documents' ? DOC_ID : '11111111-1111-4111-8111-' + String(state.inserts.length).padStart(12, '0'),
          updated_at: '2026-10-12T00:00:00.000Z',
        };
        if (table === 'hs_doc_folders') state.folders.push(inserted);
        if (table === 'hs_documents') state.documents.push(inserted);
        return {
          select() {
            return { single: async () => ({ data: { id: inserted.id }, error: null }) };
          },
        };
      },
      single: async () => {
        const row = state.documents.find(doc => filters.every(([column, value]) => doc[column] === value));
        return { data: row || null, error: row ? null : { message: 'missing' } };
      },
      then(resolve, reject) {
        let data = [];
        if (table === 'hs_doc_folders') data = state.folders;
        else if (table === 'hs_documents') data = state.documents;
        else if (table === 'hs_document_shares') data = state.shares;
        else if (table === 'hs_lesson_documents') {
          data = (state.lessonLinks || []).filter(link => filters.every(([column, value]) => link[column] === value));
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    from: query,
    storage: {
      from() {
        return {
          download: async () => ({ data: null, error: { message: 'none' } }),
          upload: async () => ({ error: null }),
          list: async () => ({ data: [], error: null }),
          remove: async () => ({ error: null }),
          copy: async () => ({ error: null }),
        };
      },
    },
  };
}

function mount(window, state, user) {
  window.HSDocuments.mount({
    supabase: client(state),
    getUser: () => user,
    getDirectory: () => state.directory,
    setPageHeading(title, crumb) {
      state.heading = [title, crumb];
    },
    getTasks: () => state.tasks || [],
    openTask(id) { state.openedTask = id; },
  });
}

const student = { id: OWNER, email: 'student.one@example.com', role: 'student', name: 'Alex Example' };

test('student can create a nested folder and a document from the library', async () => {
  const window = dom();
  const state = { folders: [], documents: [], shares: [], inserts: [], updates: [], deletes: [], upserts: [], directory: {}, heading: [] };
  mount(window, state, student);
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const doc = window.document;
  assert.equal(doc.getElementById('docsLibrary').hidden, false);
  assert.equal(doc.getElementById('docsEditor').hidden, true);

  doc.getElementById('docsNewFolder').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(doc.getElementById('docsDialog').hidden, false);
  doc.querySelector('#docsDialogBody input').value = 'Mathematics';
  doc.getElementById('docsDialogOk').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.inserts[0].table, 'hs_doc_folders');
  assert.equal(state.inserts[0].row.name, 'Mathematics');
  assert.equal(state.inserts[0].row.owner_id, OWNER);
  assert.equal(state.inserts[0].row.parent_id, null);
  assert.ok(doc.getElementById('docsFolders').textContent.includes('Mathematics'));

  doc.querySelector('.docs-folder-name').click();
  doc.getElementById('docsNewFolder').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  doc.querySelector('#docsDialogBody input').value = 'Algebra';
  doc.getElementById('docsDialogOk').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.inserts[1].row.parent_id, state.folders[0].id);
  assert.equal(state.inserts[1].row.name, 'Algebra');

  doc.getElementById('docsNewDoc').click();
  await new Promise(resolve => setTimeout(resolve, 40));
  const created = state.inserts.find(item => item.table === 'hs_documents');
  assert.equal(created.row.title, 'Untitled document');
  assert.equal(created.row.folder_id, state.folders[0].id);
  assert.equal(doc.getElementById('docsEditor').hidden, false);
  assert.ok(doc.getElementById('docsWordbar').querySelector('[aria-label="Bold"]'));
  assert.ok(doc.getElementById('docsWordbar').querySelector('[aria-label="Insert table"]'));
  assert.match(doc.getElementById('docsWordCount').textContent, /word/);
});

test('title search stays inside the open library and stored html is sanitized', async () => {
  const window = dom();
  const state = {
    folders: [],
    documents: [
      { id: DOC_ID, owner_id: OWNER, owner_email: 'student.one@example.com', folder_id: null, title: 'Algebra notes', updated_at: '2026-10-12T00:00:00.000Z', body_html: '<p>Hello</p><script>alert(1)</script><img src="https://evil.test/x.png" data-path="../secret.png">' },
      { id: '22222222-2222-4222-8222-222222222222', owner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_email: 'student.two@example.com', folder_id: null, title: 'Algebra other', updated_at: '2026-10-12T00:00:00.000Z', body_html: '<p>Other</p>' },
    ],
    shares: [],
    inserts: [],
    updates: [],
    deletes: [],
    upserts: [],
    directory: {},
    heading: [],
  };
  mount(window, state, student);
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const doc = window.document;
  doc.getElementById('docsSearch').value = 'algebra';
  doc.getElementById('docsSearch').dispatchEvent(new window.Event('input'));
  const titles = Array.from(doc.querySelectorAll('.docs-card-title')).map(node => node.textContent);
  assert.deepEqual(titles, ['Algebra notes']);

  doc.querySelector('.docs-card button').click();
  await new Promise(resolve => setTimeout(resolve, 40));
  const html = doc.querySelector('#docsSurface').innerHTML;
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /evil\.test/);
  assert.match(doc.getElementById('docsWordCount').textContent, /1 word/);
});

test('a view-only share opens read-only and hides editing controls', async () => {
  const window = dom();
  const sharedId = '33333333-3333-4333-8333-333333333333';
  const state = {
    folders: [],
    documents: [
      { id: sharedId, owner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_email: 'student.two@example.com', folder_id: null, title: 'Assigned reading', updated_at: '2026-10-12T00:00:00.000Z', body_html: '<p>Read this.</p>' },
    ],
    shares: [{ document_id: sharedId, shared_with_email: 'student.one@example.com', permission: 'view' }],
    inserts: [],
    updates: [],
    deletes: [],
    upserts: [],
    directory: { 'student.two@example.com': { name: 'Sam Example', role: 'student', authId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } },
    heading: [],
  };
  mount(window, state, student);
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const doc = window.document;
  doc.querySelector('.docs-root-name') === null;
  const shared = Array.from(doc.querySelectorAll('button')).find(button => button.textContent === 'Shared with me');
  shared.click();
  assert.equal(doc.querySelector('.docs-card-title').textContent, 'Assigned reading');
  doc.querySelector('.docs-card button').click();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(doc.getElementById('docsReadOnly').hidden, false);
  assert.equal(doc.getElementById('docsWordbar').hidden, true);
  assert.equal(doc.getElementById('docsTitle').readOnly, true);
  assert.equal(doc.getElementById('docsShare').hidden, true);
});

test('an open document lists only the lessons linked to it', async () => {
  const window = dom();
  const state = {
    folders: [],
    documents: [
      { id: DOC_ID, owner_id: OWNER, owner_email: 'student.one@example.com', folder_id: null, title: 'Algebra notes', updated_at: '2026-10-12T00:00:00.000Z', body_html: '<p>Hello</p>' },
    ],
    shares: [],
    lessonLinks: [
      { task_id: 'lesson-1', document_id: DOC_ID },
      { task_id: 'hidden-lesson', document_id: '22222222-2222-4222-8222-222222222222' },
    ],
    tasks: [{ id: 'lesson-1', title: 'Fractions', startDate: '2026-10-14' }],
    inserts: [],
    updates: [],
    deletes: [],
    upserts: [],
    directory: {},
    heading: [],
    openedTask: '',
  };
  mount(window, state, student);
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const doc = window.document;
  assert.match(doc.querySelector('.docs-card-meta').textContent, /1 lesson/);
  doc.querySelector('.docs-card button').click();
  await new Promise(resolve => setTimeout(resolve, 40));
  const chips = Array.from(doc.querySelectorAll('.docs-lesson-chip')).map(node => node.textContent);
  assert.deepEqual(chips, ['Fractions · 2026-10-14']);
  doc.querySelector('.docs-lesson-chip').click();
  assert.equal(state.openedTask, 'lesson-1');
});
