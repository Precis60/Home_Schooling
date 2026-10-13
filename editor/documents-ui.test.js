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
      <button id="docsUpload" type="button"></button>
      <span id="docsFileLimit">50 MB max</span>
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
      <div id="docsPresence"></div>
      <p id="docsConflict" hidden><span id="docsConflictText"></span>
        <button id="docsConflictLoad" type="button"></button>
        <button id="docsConflictKeep" type="button"></button>
      </p>
      <div class="docs-page-scroll"><div id="docsSurface"></div></div>
      <span id="docsWordCount"></span>
    </div>
    <div id="docsDialog" hidden>
      <h3 id="docsDialogTitle"></h3>
      <div id="docsDialogBody"></div>
      <button id="docsDialogCancel" type="button"></button>
      <button id="docsDialogOk" type="button"></button>
    </div>
    <input id="docsImageInput" type="file">
    <input id="docsFileInput" type="file">
    <div id="docsPreview" hidden>
      <h3 id="docsPreviewTitle"></h3>
      <div id="docsPreviewBody"></div>
      <button id="docsPreviewDownload" type="button"></button>
      <button id="docsPreviewClose" type="button"></button>
    </div>
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
        state.updates.push({ table, row, filters });
        api._pendingUpdate = row;
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
          id: row.id || (table === 'hs_documents' ? DOC_ID : '11111111-1111-4111-8111-' + String(state.inserts.length).padStart(12, '0')),
          updated_at: '2026-10-12T00:00:00.000Z',
        };
        if (table === 'hs_doc_folders') state.folders.push(inserted);
        if (table === 'hs_documents') state.documents.push(inserted);
        if (table === 'hs_files') {
          state.files = state.files || [];
          state.files.push(inserted);
        }
        return {
          select() {
            return { single: async () => ({ data: { id: inserted.id }, error: null }) };
          },
        };
      },
      single: async () => {
        const pools = {
          hs_documents: state.documents,
          hs_files: state.files || [],
          hs_doc_folders: state.folders,
        };
        const pool = pools[table] || [];
        const row = pool.find(item => filters.every(([column, value]) => item[column] === value));
        return { data: row || null, error: row ? null : { message: 'missing' } };
      },
      then(resolve, reject) {
        if (api._pendingUpdate && table === 'hs_documents') {
          const matches = state.documents.filter(doc => filters.every(([column, value]) => {
            if (column === 'revision') return (Number(doc.revision) || 1) === value;
            return doc[column] === value;
          }));
          matches.forEach(doc => {
            Object.assign(doc, api._pendingUpdate, { updated_at: '2026-10-13T00:00:00.000Z' });
          });
          return Promise.resolve({
            data: matches.map(doc => ({ revision: doc.revision, updated_at: doc.updated_at })),
            error: null,
          }).then(resolve, reject);
        }
        let data = [];
        if (table === 'hs_doc_folders') data = state.folders;
        else if (table === 'hs_documents') data = state.documents;
        else if (table === 'hs_document_shares') data = state.shares;
        else if (table === 'hs_folder_shares') data = state.folderShares || [];
        else if (table === 'hs_files') data = state.files || [];
        else if (table === 'hs_lesson_documents') {
          data = (state.lessonLinks || []).filter(link => filters.every(([column, value]) => link[column] === value));
        } else if (table === 'hs_lesson_files') {
          data = (state.fileLinks || []).filter(link => filters.every(([column, value]) => link[column] === value));
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  function channel(name, config) {
    const handlers = [];
    const api = {
      topic: name,
      on(type, filter, cb) {
        handlers.push({ type, filter, cb });
        return api;
      },
      subscribe(cb) {
        state.channels = state.channels || [];
        state.channels.push({ name, config, handlers });
        if (cb) cb('SUBSCRIBED');
        return api;
      },
      track(payload) {
        state.presence = state.presence || [];
        state.presence.push(payload);
        return Promise.resolve('ok');
      },
      unsubscribe() { return Promise.resolve('ok'); },
      presenceState() { return state.remotePresence || {}; },
    };
    return api;
  }
  return {
    channel,
    removeChannel() {},
    from: query,
    storage: {
      from() {
        return {
          download: async () => ({ data: null, error: { message: 'none' } }),
          upload: async () => ({ error: null }),
          list: async () => ({ data: [], error: null }),
          remove: async () => ({ error: null }),
          copy: async () => ({ error: null }),
          createSignedUrl: async (path) => ({ data: { signedUrl: 'https://signed.test/' + path }, error: null }),
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

const MANAGER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SHARED_FOLDER = '44444444-4444-4444-8444-444444444444';
const HIDDEN_FOLDER = '55555555-5555-4555-8555-555555555555';
const NESTED_FOLDER = '66666666-6666-4666-8666-666666666666';
const SHARED_FILE = '77777777-7777-4777-8777-777777777777';
const HIDDEN_FILE = '88888888-8888-4888-8888-888888888888';
const SHARED_DOC = '99999999-9999-4999-8999-999999999999';

test('a student sees a shared folder and its files, and not an unshared folder', async () => {
  const window = dom();
  const state = {
    folders: [
      { id: SHARED_FOLDER, owner_id: MANAGER, owner_email: 'manager@example.com', parent_id: null, name: 'Maths with Lucas' },
      { id: NESTED_FOLDER, owner_id: MANAGER, owner_email: 'manager@example.com', parent_id: SHARED_FOLDER, name: 'Algebra' },
      { id: HIDDEN_FOLDER, owner_id: MANAGER, owner_email: 'manager@example.com', parent_id: null, name: 'Private parent notes' },
    ],
    documents: [
      { id: SHARED_DOC, owner_id: MANAGER, owner_email: 'manager@example.com', folder_id: NESTED_FOLDER, title: 'Worksheet', updated_at: '2026-10-13T00:00:00.000Z' },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', owner_id: MANAGER, owner_email: 'manager@example.com', folder_id: HIDDEN_FOLDER, title: 'Secret plan', updated_at: '2026-10-13T00:00:00.000Z' },
    ],
    shares: [],
    folderShares: [{ folder_id: SHARED_FOLDER, shared_with_email: 'student.one@example.com', permission: 'edit' }],
    files: [
      { id: SHARED_FILE, owner_id: MANAGER, owner_email: 'manager@example.com', folder_id: NESTED_FOLDER, name: 'fractions.pdf', storage_path: SHARED_FILE, mime_type: 'application/pdf', size_bytes: 2048, updated_at: '2026-10-13T00:00:00.000Z' },
      { id: HIDDEN_FILE, owner_id: MANAGER, owner_email: 'manager@example.com', folder_id: HIDDEN_FOLDER, name: 'secret.pdf', storage_path: HIDDEN_FILE, mime_type: 'application/pdf', size_bytes: 2048, updated_at: '2026-10-13T00:00:00.000Z' },
    ],
    fileLinks: [{ task_id: 'lesson-1', file_id: SHARED_FILE }],
    tasks: [{ id: 'lesson-1', title: 'Fractions', startDate: '2026-10-14' }],
    inserts: [],
    updates: [],
    deletes: [],
    upserts: [],
    directory: { 'manager@example.com': { name: 'Parent', role: 'manager', authId: MANAGER } },
    heading: [],
  };
  mount(window, state, student);
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const doc = window.document;
  const folderNames = Array.from(doc.querySelectorAll('.docs-folder-name')).map(node => node.textContent);
  assert.ok(folderNames.includes('Maths with Lucas'));
  assert.ok(folderNames.includes('Algebra'));
  assert.equal(folderNames.includes('Private parent notes'), false);
  assert.equal(doc.getElementById('docsFileLimit').textContent, '50 MB max');
  assert.equal(doc.getElementById('docsUpload').disabled, false);

  const algebra = Array.from(doc.querySelectorAll('.docs-folder-name')).find(node => node.textContent === 'Algebra');
  algebra.click();
  assert.equal(doc.querySelector('.docs-card-title').textContent, 'Worksheet');
  assert.match(doc.body.textContent, /fractions\.pdf/);
  assert.doesNotMatch(doc.body.textContent, /secret\.pdf/);
  assert.equal(doc.getElementById('docsUpload').disabled, false);
  assert.match(doc.querySelector('.docs-file-card .docs-card-meta').textContent, /1 lesson/);

  const viewOnly = state.folderShares[0];
  viewOnly.permission = 'view';
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const sharedRoot = Array.from(doc.querySelectorAll('.docs-folder-name')).find(node => node.textContent === 'Maths with Lucas');
  sharedRoot.click();
  assert.equal(doc.getElementById('docsUpload').disabled, true);
  assert.equal(doc.getElementById('docsNewDoc').disabled, true);
  assert.equal(Array.from(doc.querySelectorAll('.docs-mini')).some(node => node.textContent === 'Delete'), false);
});

test('uploading a file stores it in the open folder and rejects anything over 50 MB', async () => {
  const window = dom();
  const state = {
    folders: [],
    documents: [],
    shares: [],
    files: [],
    folderShares: [],
    inserts: [],
    updates: [],
    deletes: [],
    upserts: [],
    uploads: [],
    directory: {},
    heading: [],
  };
  const original = client(state);
  const wrapped = {
    from: original.from,
    storage: {
      from(bucket) {
        const api = original.storage.from(bucket);
        return {
          ...api,
          upload: async (path, file) => {
            state.uploads.push({ bucket, path, size: file.size, type: file.type });
            return { error: null };
          },
        };
      },
    },
  };
  window.HSDocuments.mount({
    supabase: wrapped,
    getUser: () => student,
    getDirectory: () => state.directory,
    setPageHeading() {},
    getTasks: () => [],
  });
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const doc = window.document;
  const big = new window.File([new Uint8Array(8)], 'huge.pdf', { type: 'application/pdf' });
  Object.defineProperty(big, 'size', { value: 52428801 });
  const input = doc.getElementById('docsFileInput');
  Object.defineProperty(input, 'files', { configurable: true, value: [big] });
  input.dispatchEvent(new window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.inserts.length, 0);
  assert.match(doc.getElementById('docsError').textContent, /50 MB/);

  const small = new window.File([new Uint8Array([1, 2, 3, 4])], 'notes.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { configurable: true, value: [small] });
  input.dispatchEvent(new window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 40));
  const inserted = state.inserts.find(item => item.table === 'hs_files');
  assert.equal(inserted.row.name, 'notes.pdf');
  assert.equal(inserted.row.owner_id, OWNER);
  assert.equal(inserted.row.folder_id, null);
  assert.equal(inserted.row.storage_path, inserted.row.id);
  assert.equal(inserted.row.size_bytes, 4);
  assert.equal(state.uploads[0].bucket, 'hs-files');
  assert.equal(state.uploads[0].path, inserted.row.id);
  assert.match(doc.body.textContent, /notes\.pdf/);
});

test('a private inbox and document channel carry live edits without clobbering a local draft', async () => {
  const window = dom();
  const state = {
    folders: [],
    documents: [
      { id: DOC_ID, owner_id: OWNER, owner_email: 'student.one@example.com', folder_id: null, title: 'Algebra notes', updated_at: '2026-10-12T00:00:00.000Z', revision: 1, body_html: '<p>Hello</p>' },
    ],
    shares: [],
    inserts: [],
    updates: [],
    deletes: [],
    upserts: [],
    directory: {},
    heading: [],
    channels: [],
    remotePresence: {
      lucas: [{ user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Lucas', editing: true }],
    },
  };
  mount(window, state, student);
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const inbox = state.channels.find(item => item.name === 'inbox:' + OWNER);
  assert.ok(inbox);
  assert.equal(inbox.config.config.private, true);

  window.document.querySelector('.docs-card button').click();
  await new Promise(resolve => setTimeout(resolve, 40));
  const docChannel = state.channels.find(item => item.name === 'doc:' + DOC_ID);
  assert.ok(docChannel);
  assert.equal(docChannel.config.config.private, true);
  assert.equal(state.presence[0].name, 'Alex Example');
  assert.equal(state.presence[0].editing, false);
  const presence = docChannel.handlers.find(item => item.type === 'presence');
  presence.cb();
  assert.match(window.document.getElementById('docsPresence').textContent, /Lucas is editing/);

  const scroller = window.document.querySelector('.docs-page-scroll');
  scroller.scrollTop = 48;
  state.documents[0] = Object.assign({}, state.documents[0], {
    body_html: '<p>Hello from Lucas</p>',
    revision: 2,
    title: 'Algebra notes',
  });
  const changed = docChannel.handlers.find(item => item.filter && item.filter.event === 'changed');
  changed.cb({ payload: { kind: 'document', id: DOC_ID, op: 'UPDATE', revision: 2 } });
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.match(window.document.getElementById('docsSurface').textContent, /Hello from Lucas/);
  assert.equal(scroller.scrollTop, 48);
  assert.equal(window.document.getElementById('docsConflict').hidden, true);

  window.document.getElementById('docsTitle').value = 'My draft title';
  window.document.getElementById('docsTitle').dispatchEvent(new window.Event('input'));
  state.documents[0] = Object.assign({}, state.documents[0], {
    body_html: '<p>Lucas kept going</p>',
    revision: 3,
  });
  changed.cb({ payload: { kind: 'document', id: DOC_ID, op: 'UPDATE', revision: 3 } });
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.match(window.document.getElementById('docsSurface').textContent, /Hello from Lucas/);
  assert.equal(window.document.getElementById('docsConflict').hidden, false);
  assert.match(window.document.getElementById('docsConflictText').textContent, /Lucas saved newer changes/);
  assert.equal(window.document.getElementById('docsTitle').value, 'My draft title');

  window.document.getElementById('docsConflictLoad').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(window.document.getElementById('docsSurface').textContent, /Lucas kept going/);
  assert.equal(window.document.getElementById('docsConflict').hidden, true);
});

test('a library inbox event shows a folder added by someone else', async () => {
  const window = dom();
  const state = {
    folders: [],
    documents: [],
    shares: [],
    inserts: [],
    updates: [],
    deletes: [],
    upserts: [],
    directory: {},
    heading: [],
    channels: [],
  };
  mount(window, state, student);
  window.HSDocuments.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  const inbox = state.channels.find(item => item.name === 'inbox:' + OWNER);
  state.folders.push({
    id: '22222222-2222-4222-8222-222222222222',
    owner_id: OWNER,
    owner_email: 'student.one@example.com',
    parent_id: null,
    name: 'Science',
  });
  const changed = inbox.handlers.find(item => item.filter && item.filter.event === 'changed');
  changed.cb({ payload: { kind: 'folder', id: state.folders[0].id, op: 'INSERT' } });
  await new Promise(resolve => setTimeout(resolve, 460));
  assert.match(window.document.getElementById('docsFolders').textContent, /Science/);
});
