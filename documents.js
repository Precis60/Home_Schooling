(function () {
  const BUCKET = 'hs-document-images';
  const FILE_BUCKET = 'hs-files';
  const FILE_LIMIT = 52428800;
  const SHARED = '__shared';
  let ctx = null;
  let folders = [];
  let documents = [];
  let shares = [];
  let folderShares = [];
  let files = [];
  let fileLinks = [];
  let lessonLinks = [];
  let lessonToken = 0;
  let previewFile = null;
  let libraryEmail = '';
  let selectedFolderId = null;
  let openDoc = null;
  let editor = null;
  let dirty = false;
  let acceptUpdates = false;
  let saveTimer = null;
  let saveToken = 0;
  let loadToken = 0;
  let objectUrls = [];
  let dialogRead = null;
  let inboxChannel = null;
  let inboxTopic = '';
  let docChannel = null;
  let inboxTimer = null;
  let pullTimer = null;
  let presenceTimer = null;
  let libraryTimer = null;
  let libraryQueued = false;
  let pullToken = 0;
  let pendingRemote = null;
  let echoedSave = null;
  let libraryNotice = '';

  function $(id) { return document.getElementById(id); }

  function me() { return ctx.getUser(); }

  function directory() { return ctx.getDirectory() || {}; }

  function libraries() {
    const user = me();
    if (!user) return [];
    const list = [{ email: user.email, id: user.id, name: 'My documents' }];
    if (user.role === 'manager') {
      Object.entries(directory()).forEach(([email, person]) => {
        if (!person || person.role !== 'student' || email === user.email) return;
        list.push({ email, id: person.authId || '', name: person.name || 'Student' });
      });
    }
    return list;
  }

  function currentLibrary() {
    return libraries().find(item => item.email === libraryEmail) || libraries()[0] || null;
  }

  function ownerName(email) {
    const user = me();
    if (user && email === user.email) return user.name || 'Me';
    const person = directory()[email];
    return person && person.name ? person.name : 'Student';
  }

  function folderAccess(folderId) {
    const user = me();
    if (!user || !folderId) return '';
    if (user.role === 'manager') return 'edit';
    let current = folders.find(folder => folder.id === folderId);
    let best = '';
    let guard = 0;
    while (current && guard < 12) {
      if (current.owner_id === user.id) return 'edit';
      const share = folderShares.find(item => item.folder_id === current.id && item.shared_with_email === user.email);
      if (share && share.permission === 'edit') return 'edit';
      if (share && share.permission === 'view' && !best) best = 'view';
      current = current.parent_id ? folders.find(folder => folder.id === current.parent_id) : null;
      guard += 1;
    }
    return best;
  }

  function permissionFor(doc) {
    const user = me();
    if (!user || !doc) return '';
    if (doc.owner_id === user.id) return 'owner';
    if (user.role === 'manager') return 'manage';
    const share = shares.find(item => item.document_id === doc.id && item.shared_with_email === user.email);
    const viaFolder = folderAccess(doc.folder_id);
    if ((share && share.permission === 'edit') || viaFolder === 'edit') return 'edit';
    if (share || viaFolder === 'view') return 'view';
    return '';
  }

  function canEdit(doc) {
    const access = permissionFor(doc);
    return access === 'owner' || access === 'manage' || access === 'edit';
  }

  function canManage(doc) {
    const user = me();
    if (!user || !doc) return false;
    if (user.role === 'manager' || doc.owner_id === user.id) return true;
    return folderAccess(doc.folder_id) === 'edit';
  }

  function canSeeDocument(doc) {
    const user = me();
    if (!user || !doc) return false;
    if (user.role === 'manager') return doc.owner_email === libraryEmail;
    if (doc.owner_id === user.id) return true;
    if (shares.some(share => share.document_id === doc.id && share.shared_with_email === user.email)) return true;
    return folderAccess(doc.folder_id) !== '';
  }

  function canEditFile(file) {
    const user = me();
    if (!user || !file) return false;
    if (user.role === 'manager' || file.owner_id === user.id) return true;
    return folderAccess(file.folder_id) === 'edit';
  }

  function canSeeFile(file) {
    const user = me();
    if (!user || !file) return false;
    if (user.role === 'manager') return file.owner_email === libraryEmail;
    if (file.owner_id === user.id) return true;
    return folderAccess(file.folder_id) !== '';
  }

  function canChangeFolder(folder) {
    const user = me();
    if (!user || !folder) return false;
    if (user.role === 'manager' || folder.owner_id === user.id) return true;
    return folderAccess(folder.id) === 'edit';
  }

  function selectedFolder() {
    if (!selectedFolderId || selectedFolderId === SHARED) return null;
    return folders.find(folder => folder.id === selectedFolderId) || null;
  }

  function canAddHere() {
    const user = me();
    const library = currentLibrary();
    if (!user || !library || !library.id || selectedFolderId === SHARED) return false;
    if (user.role === 'manager') return true;
    if (!selectedFolderId) return library.email === user.email;
    return folderAccess(selectedFolderId) === 'edit';
  }

  function targetOwner() {
    const folder = selectedFolder();
    if (folder) return { id: folder.owner_id, email: folder.owner_email };
    const library = currentLibrary();
    if (!library || !library.id) return null;
    return { id: library.id, email: library.email };
  }

  function setError(message) {
    const el = $('docsError');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
  }

  function setSaveState(label, kind) {
    const el = $('docsSaveState');
    if (!el) return;
    el.textContent = label;
    el.classList.remove('is-dirty', 'is-saved', 'is-error');
    if (kind) el.classList.add(kind);
  }

  function revokeUrls() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls = [];
  }

  function destroyEditor() {
    acceptUpdates = false;
    stopDocumentChannel();
    if (editor) {
      editor.destroy();
      editor = null;
    }
    revokeUrls();
    const surface = $('docsSurface');
    if (surface) surface.innerHTML = '';
  }

  function showLibraryPane() {
    $('docsLibrary').hidden = false;
    $('docsEditor').hidden = true;
    openDoc = null;
  }

  function folderPath(folderId) {
    const names = [];
    let current = folders.find(folder => folder.id === folderId);
    let guard = 0;
    while (current && guard < 12) {
      names.unshift(current.name);
      current = current.parent_id ? folders.find(folder => folder.id === current.parent_id) : null;
      guard += 1;
    }
    return names.join(' / ');
  }

  function descendantIds(rootId) {
    const ids = [rootId];
    let grew = true;
    while (grew) {
      grew = false;
      folders.forEach(folder => {
        if (folder.parent_id && ids.indexOf(folder.parent_id) !== -1 && ids.indexOf(folder.id) === -1) {
          ids.push(folder.id);
          grew = true;
        }
      });
    }
    return ids;
  }

  function depthOf(folderId) {
    let depth = 0;
    let current = folders.find(folder => folder.id === folderId);
    while (current && current.parent_id && depth < 12) {
      depth += 1;
      current = folders.find(folder => folder.id === current.parent_id);
    }
    return depth;
  }

  async function loadAll() {
    const token = ++loadToken;
    const client = ctx.supabase;
    const [folderRes, docRes, shareRes, folderShareRes, fileRes, linkRes, fileLinkRes] = await Promise.all([
      client.from('hs_doc_folders').select('id, owner_id, owner_email, parent_id, name, updated_at').order('name'),
      client.from('hs_documents').select('id, owner_id, owner_email, folder_id, title, updated_at').order('updated_at', { ascending: false }),
      client.from('hs_document_shares').select('document_id, shared_with_email, permission'),
      client.from('hs_folder_shares').select('folder_id, shared_with_email, permission'),
      client.from('hs_files').select('id, owner_id, owner_email, folder_id, name, storage_path, mime_type, size_bytes, updated_at').order('name'),
      client.from('hs_lesson_documents').select('task_id, document_id'),
      client.from('hs_lesson_files').select('task_id, file_id'),
    ]);
    if (token !== loadToken) return false;
    const error = folderRes.error || docRes.error || shareRes.error || folderShareRes.error || fileRes.error;
    if (error) {
      setError('Documents could not be loaded.');
      console.error('Document library failed', error);
      return false;
    }
    folders = folderRes.data || [];
    documents = docRes.data || [];
    shares = shareRes.data || [];
    folderShares = folderShareRes.data || [];
    files = fileRes.data || [];
    lessonLinks = linkRes.error ? [] : (linkRes.data || []);
    fileLinks = fileLinkRes.error ? [] : (fileLinkRes.data || []);
    if (linkRes.error) console.error('Lesson links failed', linkRes.error);
    if (fileLinkRes.error) console.error('File lesson links failed', fileLinkRes.error);
    setError('');
    return true;
  }

  function renderFolderBranch(parentId, container, depth, ownerEmail) {
    if (depth > 12) return;
    folders
      .filter(folder => (folder.parent_id || null) === parentId && (!ownerEmail || folder.owner_email === ownerEmail))
      .forEach(folder => {
        const row = document.createElement('div');
        row.className = 'docs-folder-row' + (selectedFolderId === folder.id ? ' active' : '');
        row.style.paddingLeft = (depth * 14) + 'px';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'docs-folder-name';
        button.textContent = folder.name;
        button.addEventListener('click', () => {
          selectedFolderId = folder.id;
          renderLibrary();
        });
        row.appendChild(button);
        if (folderShares.some(share => share.folder_id === folder.id)) {
          const flag = document.createElement('span');
          flag.className = 'docs-shared-flag';
          flag.textContent = 'Shared';
          row.appendChild(flag);
        }
        if (canChangeFolder(folder)) {
          const rename = document.createElement('button');
          rename.type = 'button';
          rename.className = 'docs-mini';
          rename.textContent = 'Rename';
          rename.addEventListener('click', () => renameFolder(folder));
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'docs-mini danger';
          remove.textContent = 'Delete';
          remove.addEventListener('click', () => deleteFolder(folder));
          row.appendChild(rename);
          row.appendChild(remove);
        }
        if (me() && me().role === 'manager') {
          const share = document.createElement('button');
          share.type = 'button';
          share.className = 'docs-mini';
          share.textContent = 'Share';
          share.addEventListener('click', () => shareFolder(folder));
          row.appendChild(share);
        }
        container.appendChild(row);
        renderFolderBranch(folder.id, container, depth + 1, ownerEmail);
      });
  }

  function sharedRoots() {
    const user = me();
    if (!user || user.role === 'manager') return [];
    return folders.filter(folder => {
      if (folder.owner_id === user.id) return false;
      if (!folderAccess(folder.id)) return false;
      if (!folder.parent_id) return true;
      return !folders.some(item => item.id === folder.parent_id);
    });
  }

  function renderFolders() {
    const pane = $('docsFolders');
    pane.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'docs-root-row' + (selectedFolderId === null ? ' active' : '');
    const rootBtn = document.createElement('button');
    rootBtn.type = 'button';
    rootBtn.className = 'docs-root-name';
    rootBtn.textContent = 'Library';
    rootBtn.addEventListener('click', () => {
      selectedFolderId = null;
      renderLibrary();
    });
    root.appendChild(rootBtn);
    pane.appendChild(root);
    renderFolderBranch(null, pane, 0, libraryEmail);
    const roots = sharedRoots();
    if (roots.length) {
      pane.appendChild(sectionLabel('Shared folders'));
      roots.forEach(folder => {
        const row = document.createElement('div');
        row.className = 'docs-folder-row' + (selectedFolderId === folder.id ? ' active' : '');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'docs-folder-name';
        button.textContent = folder.name;
        button.addEventListener('click', () => {
          selectedFolderId = folder.id;
          renderLibrary();
        });
        row.appendChild(button);
        const access = folderAccess(folder.id);
        if (access) {
          const flag = document.createElement('span');
          flag.className = 'docs-shared-flag';
          flag.textContent = access === 'edit' ? 'Can edit' : 'View';
          row.appendChild(flag);
        }
        if (canChangeFolder(folder)) {
          const rename = document.createElement('button');
          rename.type = 'button';
          rename.className = 'docs-mini';
          rename.textContent = 'Rename';
          rename.addEventListener('click', () => renameFolder(folder));
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'docs-mini danger';
          remove.textContent = 'Delete';
          remove.addEventListener('click', () => deleteFolder(folder));
          row.appendChild(rename);
          row.appendChild(remove);
        }
        pane.appendChild(row);
        renderFolderBranch(folder.id, pane, 1, null);
      });
    }
    const user = me();
    const sharedDocs = documents.filter(doc => isLooseShare(doc));
    if (user && user.role !== 'manager' && sharedDocs.length) {
      const shared = document.createElement('div');
      shared.className = 'docs-root-row' + (selectedFolderId === SHARED ? ' active' : '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'docs-root-name';
      button.textContent = 'Shared with me';
      button.addEventListener('click', () => {
        selectedFolderId = SHARED;
        renderLibrary();
      });
      shared.appendChild(button);
      pane.appendChild(shared);
    }
  }

  function renderPicker() {
    const wrap = $('docsLibraryPickerWrap');
    const select = $('docsLibraryPicker');
    const items = libraries();
    select.innerHTML = '';
    items.forEach(item => {
      const option = document.createElement('option');
      option.value = item.email;
      option.textContent = item.name;
      option.disabled = !item.id;
      if (item.email === libraryEmail) option.selected = true;
      select.appendChild(option);
    });
    wrap.hidden = items.length < 2;
  }

  function isLooseShare(doc) {
    const user = me();
    if (!user || !doc || doc.owner_id === user.id) return false;
    if (!shares.some(share => share.document_id === doc.id && share.shared_with_email === user.email)) return false;
    return folderAccess(doc.folder_id) === '';
  }

  function sectionLabel(text) {
    const label = document.createElement('div');
    label.className = 'docs-section-label';
    label.textContent = text;
    return label;
  }

  function visibleDocuments() {
    const query = $('docsSearch').value.trim().toLowerCase();
    const user = me();
    if (query) {
      return documents.filter(doc => {
        if ((doc.title || '').toLowerCase().indexOf(query) === -1 || !canSeeDocument(doc)) return false;
        if (user && user.role === 'manager') return doc.owner_email === libraryEmail;
        return true;
      });
    }
    if (selectedFolderId === SHARED) return documents.filter(isLooseShare);
    if (selectedFolderId) return documents.filter(doc => doc.folder_id === selectedFolderId && canSeeDocument(doc));
    return documents.filter(doc => doc.owner_email === libraryEmail && !doc.folder_id && canSeeDocument(doc));
  }

  function visibleFiles() {
    const query = $('docsSearch').value.trim().toLowerCase();
    const user = me();
    if (query) {
      return files.filter(file => {
        if ((file.name || '').toLowerCase().indexOf(query) === -1 || !canSeeFile(file)) return false;
        if (user && user.role === 'manager') return file.owner_email === libraryEmail;
        return true;
      });
    }
    if (selectedFolderId === SHARED) return [];
    if (selectedFolderId) return files.filter(file => file.folder_id === selectedFolderId && canSeeFile(file));
    return files.filter(file => file.owner_email === libraryEmail && !file.folder_id && canSeeFile(file));
  }

  function renderList() {
    const list = $('docsList');
    list.innerHTML = '';
    const rows = visibleDocuments();
    const fileRows = visibleFiles();
    const searching = $('docsSearch').value.trim() !== '';
    if (!rows.length && !fileRows.length) {
      const empty = document.createElement('div');
      empty.className = 'docs-empty';
      empty.textContent = searching
        ? 'No documents or files with that name.'
        : (canAddHere() ? 'Nothing in this folder yet. Upload a file up to 50 MB, or create a document.' : 'Nothing in this folder yet.');
      list.appendChild(empty);
      return;
    }
    rows.forEach(doc => {
      const card = document.createElement('div');
      card.className = 'docs-card';
      const text = document.createElement('button');
      text.type = 'button';
      text.style.flex = '1';
      text.style.border = '0';
      text.style.background = 'transparent';
      text.style.color = 'inherit';
      text.style.textAlign = 'left';
      text.style.padding = '0';
      const title = document.createElement('div');
      title.className = 'docs-card-title';
      title.textContent = doc.title || 'Untitled document';
      const meta = document.createElement('div');
      meta.className = 'docs-card-meta';
      const when = doc.updated_at ? new Date(doc.updated_at).toLocaleString() : '';
      const bits = [];
      if (searching || selectedFolderId === SHARED) bits.push(ownerName(doc.owner_email));
      if (doc.folder_id) bits.push(folderPath(doc.folder_id) || 'Folder');
      else if (searching) bits.push('Library');
      const access = permissionFor(doc);
      if (access === 'view') bits.push('View only');
      if (access === 'edit' && doc.owner_id !== me().id) bits.push('Can edit');
      const lessonCount = lessonLinks.filter(link => link.document_id === doc.id).length;
      if (lessonCount) bits.push(lessonCount === 1 ? '1 lesson' : lessonCount + ' lessons');
      if (when) bits.push(when);
      meta.textContent = bits.join(' · ');
      text.appendChild(title);
      text.appendChild(meta);
      text.addEventListener('click', () => openDocument(doc.id));
      const actions = document.createElement('div');
      actions.className = 'docs-card-actions';
      actions.appendChild(actionButton('Duplicate', () => duplicateDocument(doc.id)));
      if (canManage(doc)) {
        actions.appendChild(actionButton('Move', () => moveDocument(doc)));
        actions.appendChild(actionButton('Delete', () => deleteDocument(doc), true));
      }
      if (me().role === 'manager') actions.appendChild(actionButton('Share', () => shareDocument(doc)));
      card.appendChild(text);
      card.appendChild(actions);
      list.appendChild(card);
    });
    fileRows.forEach(file => list.appendChild(fileCard(file, searching)));
  }

  function fileKind(file) {
    const name = String(file.name || '');
    const ext = name.indexOf('.') === -1 ? '' : name.split('.').pop().toLowerCase();
    const known = {
      pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel',
      ppt: 'PowerPoint', pptx: 'PowerPoint', png: 'Image', jpg: 'Image', jpeg: 'Image',
      gif: 'Image', webp: 'Image', txt: 'Text', csv: 'CSV',
    };
    if (known[ext]) return known[ext];
    if (String(file.mime_type || '').toLowerCase().indexOf('image/') === 0) return 'Image';
    return ext ? ext.toUpperCase().slice(0, 8) : 'File';
  }

  function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1048576) return (size / 1024).toFixed(size < 10240 ? 1 : 0) + ' KB';
    return (size / 1048576).toFixed(1) + ' MB';
  }

  function previewKind(file) {
    const mime = String(file.mime_type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    if (mime.indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp)$/.test(name)) return 'image';
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    return '';
  }

  function fileCard(file, searching) {
    const card = document.createElement('div');
    card.className = 'docs-card docs-file-card';
    const text = document.createElement('button');
    text.type = 'button';
    text.style.flex = '1';
    text.style.border = '0';
    text.style.background = 'transparent';
    text.style.color = 'inherit';
    text.style.textAlign = 'left';
    text.style.padding = '0';
    const title = document.createElement('div');
    title.className = 'docs-card-title';
    const kind = document.createElement('span');
    kind.className = 'docs-file-kind';
    kind.textContent = fileKind(file);
    title.appendChild(kind);
    title.appendChild(document.createTextNode(' ' + (file.name || 'File')));
    const meta = document.createElement('div');
    meta.className = 'docs-card-meta';
    const bits = [formatBytes(file.size_bytes)];
    if (searching) bits.push(file.folder_id ? (folderPath(file.folder_id) || 'Folder') : 'Library');
    if (!canEditFile(file)) bits.push('View only');
    const lessonCount = fileLinks.filter(link => link.file_id === file.id).length;
    if (lessonCount) bits.push(lessonCount === 1 ? '1 lesson' : lessonCount + ' lessons');
    const when = file.updated_at ? new Date(file.updated_at).toLocaleString() : '';
    if (when) bits.push(when);
    meta.textContent = bits.join(' · ');
    text.appendChild(title);
    text.appendChild(meta);
    text.addEventListener('click', () => openFile(file.id));
    const actions = document.createElement('div');
    actions.className = 'docs-card-actions';
    actions.appendChild(actionButton(previewKind(file) ? 'Preview' : 'Open', () => openFile(file.id)));
    actions.appendChild(actionButton('Download', () => downloadFile(file)));
    if (canEditFile(file)) {
      actions.appendChild(actionButton('Rename', () => renameFile(file)));
      actions.appendChild(actionButton('Move', () => moveFile(file)));
      actions.appendChild(actionButton('Delete', () => deleteFile(file), true));
    }
    card.appendChild(text);
    card.appendChild(actions);
    return card;
  }

  function actionButton(label, onClick, danger) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-ghost' + (danger ? ' btn-danger' : '');
    button.textContent = label;
    button.addEventListener('click', event => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function renderLibrary() {
    if (!currentLibrary()) libraryEmail = me() ? me().email : '';
    renderPicker();
    renderFolders();
    renderList();
    const folder = selectedFolderId && selectedFolderId !== SHARED ? folders.find(item => item.id === selectedFolderId) : null;
    const crumb = folder ? folderPath(folder.id) : (selectedFolderId === SHARED ? 'Shared with me' : 'Library');
    ctx.setPageHeading('Documents', crumb);
    const createFolder = $('docsNewFolder');
    const adding = canAddHere();
    createFolder.disabled = !adding || (folder && depthOf(folder.id) >= 7);
    $('docsNewDoc').disabled = !adding;
    const upload = $('docsUpload');
    if (upload) upload.disabled = !adding;
  }

  function closeMenus() {
    document.querySelectorAll('.doc-color-menu').forEach(menu => menu.remove());
  }

  function toolButton(label, title, command) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'doc-tool';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (!editor || !canEdit(openDoc)) return;
      command(editor);
      refreshToolbar();
      markDirty();
    });
    return button;
  }

  function toolSelect(label, values, getValue, apply) {
    const select = document.createElement('select');
    select.className = 'doc-tool-select';
    select.setAttribute('aria-label', label);
    values.forEach(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      if (!editor || !canEdit(openDoc)) return;
      apply(editor, select.value);
      refreshToolbar();
      markDirty();
    });
    select.dataset.role = label;
    select._getValue = getValue;
    return select;
  }

  function colorControl(label, colors, apply) {
    const wrap = document.createElement('div');
    wrap.className = 'doc-color';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'doc-tool';
    button.textContent = label;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      closeMenus();
      const menu = document.createElement('div');
      menu.className = 'doc-color-menu';
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'doc-swatch-none';
      none.textContent = '×';
      none.title = 'Clear';
      none.addEventListener('mousedown', event => event.preventDefault());
      none.addEventListener('click', () => {
        if (editor && canEdit(openDoc)) { apply(editor, ''); markDirty(); }
        menu.remove();
      });
      menu.appendChild(none);
      colors.forEach(color => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'doc-swatch';
        swatch.style.background = color;
        swatch.title = color;
        swatch.addEventListener('mousedown', event => event.preventDefault());
        swatch.addEventListener('click', () => {
          if (editor && canEdit(openDoc)) { apply(editor, color); markDirty(); }
          menu.remove();
        });
        menu.appendChild(swatch);
      });
      document.body.appendChild(menu);
      const rect = button.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.left = Math.min(rect.left, window.innerWidth - 140) + 'px';
    });
    wrap.appendChild(button);
    return wrap;
  }

  function sep() {
    const span = document.createElement('span');
    span.className = 'doc-tool-sep';
    return span;
  }

  function buildToolbar() {
    const bar = $('docsWordbar');
    if (bar.childElementCount) return;
    const E = window.HSEditor;
    bar.appendChild(toolSelect('Style', [
      { label: 'Normal', value: 'p' },
      { label: 'Heading 1', value: 'h1' },
      { label: 'Heading 2', value: 'h2' },
      { label: 'Heading 3', value: 'h3' },
      { label: 'Heading 4', value: 'h4' },
    ], state => state.style, (ed, value) => {
      if (value === 'p') ed.chain().focus().setParagraph().run();
      else ed.chain().focus().setHeading({ level: Number(value.slice(1)) }).run();
    }));
    bar.appendChild(toolSelect('Font', [{ label: 'Font', value: '' }].concat(E.FONT_FAMILIES.map(font => ({ label: font.label, value: font.value }))), state => state.fontFamily, (ed, value) => {
      if (!value) ed.chain().focus().unsetFontFamily().run();
      else ed.chain().focus().setFontFamily(value).run();
    }));
    bar.appendChild(toolSelect('Font size', [{ label: 'Size', value: '' }].concat(E.FONT_SIZES.map(size => ({ label: size, value: size }))), state => state.fontSize, (ed, value) => {
      if (!value) ed.chain().focus().unsetFontSize().run();
      else ed.chain().focus().setFontSize(value).run();
    }));
    bar.appendChild(sep());
    bar.appendChild(toolButton('B', 'Bold', ed => ed.chain().focus().toggleBold().run()));
    bar.appendChild(toolButton('I', 'Italic', ed => ed.chain().focus().toggleItalic().run()));
    bar.appendChild(toolButton('U', 'Underline', ed => ed.chain().focus().toggleUnderline().run()));
    bar.appendChild(toolButton('S', 'Strikethrough', ed => ed.chain().focus().toggleStrike().run()));
    bar.appendChild(toolButton('x₂', 'Subscript', ed => ed.chain().focus().toggleSubscript().run()));
    bar.appendChild(toolButton('x²', 'Superscript', ed => ed.chain().focus().toggleSuperscript().run()));
    bar.appendChild(colorControl('Text colour', E.TEXT_COLORS, (ed, color) => {
      if (!color) ed.chain().focus().unsetColor().run();
      else ed.chain().focus().setColor(color).run();
    }));
    bar.appendChild(colorControl('Highlight', E.HIGHLIGHT_COLORS, (ed, color) => {
      if (!color) ed.chain().focus().unsetHighlight().run();
      else ed.chain().focus().setHighlight({ color }).run();
    }));
    bar.appendChild(sep());
    bar.appendChild(toolSelect('Align', [
      { label: 'Left', value: 'left' },
      { label: 'Centre', value: 'center' },
      { label: 'Right', value: 'right' },
      { label: 'Justify', value: 'justify' },
    ], state => state.align, (ed, value) => ed.chain().focus().setTextAlign(value).run()));
    bar.appendChild(toolSelect('Line spacing', [{ label: 'Spacing', value: '' }].concat(E.LINE_HEIGHTS), state => state.lineHeight, (ed, value) => ed.chain().focus().setLineHeight(value).run()));
    bar.appendChild(sep());
    bar.appendChild(toolButton('• List', 'Bulleted list', ed => ed.chain().focus().toggleBulletList().run()));
    bar.appendChild(toolButton('1. List', 'Numbered list', ed => ed.chain().focus().toggleOrderedList().run()));
    bar.appendChild(toolButton('☑ List', 'Checklist', ed => ed.chain().focus().toggleTaskList().run()));
    bar.appendChild(toolButton('Indent', 'Indent', ed => E.indent(ed)));
    bar.appendChild(toolButton('Outdent', 'Outdent', ed => E.outdent(ed)));
    bar.appendChild(sep());
    bar.appendChild(toolButton('Table', 'Insert table', ed => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()));
    bar.appendChild(toolButton('Row+', 'Add row', ed => ed.chain().focus().addRowAfter().run()));
    bar.appendChild(toolButton('Row−', 'Remove row', ed => ed.chain().focus().deleteRow().run()));
    bar.appendChild(toolButton('Col+', 'Add column', ed => ed.chain().focus().addColumnAfter().run()));
    bar.appendChild(toolButton('Col−', 'Remove column', ed => ed.chain().focus().deleteColumn().run()));
    bar.appendChild(toolButton('Table×', 'Delete table', ed => ed.chain().focus().deleteTable().run()));
    bar.appendChild(sep());
    bar.appendChild(toolButton('Link', 'Link', () => editLink()));
    bar.appendChild(toolButton('Image', 'Insert image', () => $('docsImageInput').click()));
    bar.appendChild(toolButton('Rule', 'Horizontal line', ed => ed.chain().focus().setHorizontalRule().run()));
    bar.appendChild(toolButton('Break', 'Page break', ed => ed.chain().focus().setPageBreak().run()));
    bar.appendChild(sep());
    bar.appendChild(toolButton('Undo', 'Undo', ed => ed.chain().focus().undo().run()));
    bar.appendChild(toolButton('Redo', 'Redo', ed => ed.chain().focus().redo().run()));
    bar.appendChild(toolButton('Clear', 'Clear formatting', ed => E.clearFormatting(ed)));
    bar.appendChild(toolButton('Find', 'Find and replace', () => { $('docsFind').hidden = false; $('docsFindQuery').focus(); }));
  }

  function refreshToolbar() {
    if (!editor) return;
    const state = window.HSEditor.queryState(editor);
    $('docsWordbar').querySelectorAll('.doc-tool').forEach(button => {
      const name = button.getAttribute('aria-label');
      const on = (name === 'Bold' && state.bold) || (name === 'Italic' && state.italic) || (name === 'Underline' && state.underline) || (name === 'Strikethrough' && state.strike) || (name === 'Subscript' && state.subscript) || (name === 'Superscript' && state.superscript) || (name === 'Bulleted list' && state.bullet) || (name === 'Numbered list' && state.ordered) || (name === 'Checklist' && state.task);
      button.classList.toggle('is-on', !!on);
    });
    $('docsWordbar').querySelectorAll('select').forEach(select => {
      if (select._getValue) select.value = select._getValue(state) || select.options[0].value;
    });
    const words = state.words || 0;
    $('docsWordCount').textContent = words === 1 ? '1 word' : words + ' words';
  }

  function payloadOf(message) {
    if (!message) return {};
    if (message.payload && typeof message.payload === 'object') return message.payload;
    return message;
  }

  function stopChannel(channel) {
    if (!channel) return;
    try {
      if (ctx.supabase && ctx.supabase.removeChannel) ctx.supabase.removeChannel(channel);
      else if (channel.unsubscribe) channel.unsubscribe();
    } catch (error) {
      console.error('Realtime unsubscribe failed', error);
    }
  }

  function stopDocumentChannel() {
    clearTimeout(pullTimer);
    clearTimeout(presenceTimer);
    pendingRemote = null;
    hideConflict();
    stopChannel(docChannel);
    docChannel = null;
    renderPresence();
  }

  function stopInbox() {
    clearTimeout(inboxTimer);
    clearTimeout(libraryTimer);
    stopChannel(inboxChannel);
    inboxChannel = null;
    inboxTopic = '';
  }

  function ensureInbox() {
    const user = me();
    if (!user || !user.id || !ctx.supabase || !ctx.supabase.channel) return;
    const topic = 'inbox:' + user.id;
    if (inboxChannel && inboxTopic === topic) return;
    stopInbox();
    inboxTopic = topic;
    inboxChannel = ctx.supabase.channel(topic, { config: { private: true } });
    inboxChannel.on('broadcast', { event: 'changed' }, message => onInbox(payloadOf(message)));
    inboxChannel.subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('Document inbox realtime failed', status);
    });
  }

  function watchDocument(id) {
    stopDocumentChannel();
    const user = me();
    if (!id || !user || !ctx.supabase || !ctx.supabase.channel) return;
    const topic = 'doc:' + id;
    docChannel = ctx.supabase.channel(topic, { config: { private: true } });
    docChannel.on('presence', { event: 'sync' }, renderPresence);
    docChannel.on('broadcast', { event: 'changed' }, message => onDocumentBroadcast(id, payloadOf(message)));
    docChannel.subscribe(status => {
      if (status === 'SUBSCRIBED') pushPresence();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('Document presence realtime failed', status);
    });
  }

  function onInbox(payload) {
    if (!payload) return;
    if (payload.kind === 'document' && openDoc && payload.id === openDoc.id) {
      if (payload.op === 'DELETE') {
        unavailableDocument();
        return;
      }
      schedulePull(openDoc.id);
    }
    if (payload.kind === 'file' && previewFile && payload.id === previewFile.id && payload.op === 'DELETE') {
      closePreview();
      libraryNotice = 'That file was removed.';
      setError(libraryNotice);
    }
    scheduleLibrary();
  }

  function onDocumentBroadcast(id, payload) {
    if (!openDoc || openDoc.id !== id) return;
    if (payload && payload.op === 'DELETE') {
      unavailableDocument();
      return;
    }
    schedulePull(id);
  }

  function schedulePull(id) {
    clearTimeout(pullTimer);
    pullTimer = setTimeout(() => pullRemote(id), 150);
  }

  function scheduleLibrary() {
    libraryQueued = true;
    clearTimeout(libraryTimer);
    libraryTimer = setTimeout(refreshLibraryLive, 400);
  }

  function schedulePresence() {
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(pushPresence, 250);
  }

  function pushPresence() {
    const user = me();
    if (!docChannel || !user || !docChannel.track) return;
    docChannel.track({
      user_id: user.id,
      name: user.name || (user.role === 'manager' ? 'Manager' : 'Student'),
      editing: !!dirty,
    });
  }

  function otherPeople() {
    if (!docChannel || !docChannel.presenceState) return [];
    const mine = me() ? me().id : '';
    const byId = {};
    Object.keys(docChannel.presenceState() || {}).forEach(key => {
      (docChannel.presenceState()[key] || []).forEach(entry => {
        if (!entry || !entry.user_id || entry.user_id === mine) return;
        const name = String(entry.name || 'Someone').slice(0, 80);
        const prev = byId[entry.user_id];
        byId[entry.user_id] = { name, editing: !!((prev && prev.editing) || entry.editing) };
      });
    });
    return Object.keys(byId).map(id => byId[id]);
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('');
  }

  function renderPresence() {
    const el = $('docsPresence');
    if (!el) return;
    el.innerHTML = '';
    otherPeople().forEach(person => {
      const chip = document.createElement('span');
      chip.className = 'docs-presence-chip' + (person.editing ? ' is-editing' : '');
      const avatar = document.createElement('span');
      avatar.className = 'docs-presence-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = initials(person.name);
      const label = document.createElement('span');
      label.textContent = person.name + (person.editing ? ' is editing' : ' is viewing');
      chip.appendChild(avatar);
      chip.appendChild(label);
      el.appendChild(chip);
    });
  }

  function hideConflict() {
    pendingRemote = null;
    const el = $('docsConflict');
    if (el) el.hidden = true;
  }

  function showConflict() {
    const el = $('docsConflict');
    const text = $('docsConflictText');
    if (!el || !text) return;
    const editorName = otherPeople().filter(person => person.editing).map(person => person.name)[0]
      || otherPeople().map(person => person.name)[0]
      || 'Someone';
    text.textContent = editorName + ' saved newer changes. Your edits are still here.';
    el.hidden = false;
  }

  function localSnapshot() {
    return {
      title: $('docsTitle') ? ($('docsTitle').value.trim() || 'Untitled document') : '',
      html: editor && window.HSEditor ? window.HSEditor.prepareHtmlForStorage(editor.getHTML()) : '',
    };
  }

  async function pullRemote(id) {
    const token = ++pullToken;
    const loaded = await ctx.supabase.from('hs_documents').select('*').eq('id', id).single();
    if (token !== pullToken || !openDoc || openDoc.id !== id) return;
    if (loaded.error || !loaded.data) {
      unavailableDocument();
      return;
    }
    const data = loaded.data;
    data.revision = Number(data.revision) || 1;
    if (echoedSave && echoedSave.id === data.id && Number(echoedSave.revision) === data.revision && echoedSave.html === data.body_html && echoedSave.title === data.title) {
      openDoc.revision = data.revision;
      openDoc.updated_at = data.updated_at;
      openDoc.body_html = data.body_html;
      openDoc.title = data.title;
      return;
    }
    if (data.revision === (Number(openDoc.revision) || 1) && data.body_html === openDoc.body_html && data.title === openDoc.title) return;
    if (dirty) {
      const local = localSnapshot();
      if (local.html === data.body_html && local.title === data.title) {
        openDoc.revision = data.revision;
        openDoc.updated_at = data.updated_at;
        dirty = false;
        hideConflict();
        setSaveState('Saved', 'is-saved');
        schedulePresence();
        return;
      }
      pendingRemote = data;
      showConflict();
      setSaveState('Newer changes', 'is-dirty');
      return;
    }
    applyRemote(data);
  }

  function applyRemote(data) {
    if (!editor || !openDoc || !data) return;
    const scroller = document.querySelector('.docs-page-scroll');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const keepCaret = !!(editor.isFocused);
    const selection = keepCaret && editor.state ? editor.state.selection : null;
    const from = selection ? selection.from : null;
    const to = selection ? selection.to : null;
    acceptUpdates = false;
    if (data.body_html !== openDoc.body_html) {
      editor.commands.setContent(data.body_html || '<p></p>', false);
      hydrate(editor);
    }
    const title = $('docsTitle');
    if (title && document.activeElement !== title) title.value = data.title || '';
    openDoc = data;
    const row = documents.find(doc => doc.id === data.id);
    if (row) {
      row.title = data.title;
      row.revision = data.revision;
      row.updated_at = data.updated_at;
    }
    acceptUpdates = true;
    dirty = false;
    hideConflict();
    setSaveState('Saved', 'is-saved');
    if (keepCaret && from != null) {
      try {
        const max = editor.state.doc.content.size;
        const start = Math.max(0, Math.min(from, max));
        const end = Math.max(start, Math.min(to == null ? start : to, max));
        editor.commands.setTextSelection({ from: start, to: end });
      } catch (error) { /* the remote text no longer contains that caret */ }
    }
    if (scroller) scroller.scrollTop = scrollTop;
    refreshToolbar();
    ctx.setPageHeading(data.title || 'Document', 'Documents');
    schedulePresence();
  }

  function unavailableDocument() {
    if (!openDoc) return;
    destroyEditor();
    openDoc = null;
    showLibraryPane();
    libraryNotice = 'This document is no longer available.';
    setError(libraryNotice);
    scheduleLibrary();
  }

  async function refreshLibraryLive() {
    if (!libraryQueued) return;
    if (!$('docsDialog').hidden || ($('docsPreview') && !$('docsPreview').hidden)) return;
    libraryQueued = false;
    const list = $('docsList');
    const folderPane = $('docsFolders');
    const listTop = list ? list.scrollTop : 0;
    const folderTop = folderPane ? folderPane.scrollTop : 0;
    const ok = await loadAll();
    if (!ok) return;
    if (previewFile && !files.some(file => file.id === previewFile.id)) {
      closePreview();
      libraryNotice = 'That file was removed.';
    }
    if (libraryNotice) {
      setError(libraryNotice);
      libraryNotice = '';
    }
    if (openDoc && !$('docsEditor').hidden) syncOpenAccess();
    if ($('docsEditor').hidden) {
      renderLibrary();
      if ($('docsList')) $('docsList').scrollTop = listTop;
      if ($('docsFolders')) $('docsFolders').scrollTop = folderTop;
    }
  }

  function syncOpenAccess() {
    if (!openDoc || $('docsEditor').hidden || !editor) return;
    const editable = canEdit(openDoc);
    editor.setEditable(editable);
    $('docsTitle').readOnly = !editable;
    $('docsReadOnly').hidden = editable;
    $('docsSave').hidden = !editable;
    $('docsWordbar').hidden = !editable;
    $('docsMove').hidden = !canManage(openDoc);
    $('docsDelete').hidden = !canManage(openDoc);
    if (!editable && dirty) {
      dirty = false;
      clearTimeout(saveTimer);
      setSaveState('Saved', 'is-saved');
    }
  }

  async function loadTheirVersion() {
    const remote = pendingRemote;
    if (!remote) return;
    dirty = false;
    clearTimeout(saveTimer);
    applyRemote(remote);
  }

  function keepMyVersion() {
    if (!pendingRemote || !openDoc) return;
    openDoc.revision = pendingRemote.revision;
    pendingRemote = null;
    hideConflict();
    dirty = true;
    saveNow();
  }

  function markDirty() {
    if (!acceptUpdates || !canEdit(openDoc)) return;
    dirty = true;
    echoedSave = null;
    setSaveState('Unsaved changes', 'is-dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1200);
    schedulePresence();
  }

  function capture() {
    if (!openDoc || !editor || !dirty || !canEdit(openDoc)) return null;
    const snapshot = {
      id: openDoc.id,
      revision: Number(openDoc.revision) || 1,
      title: $('docsTitle').value.trim() || 'Untitled document',
      html: window.HSEditor.prepareHtmlForStorage(editor.getHTML()),
    };
    dirty = false;
    clearTimeout(saveTimer);
    return snapshot;
  }

  async function persist(snapshot) {
    const token = ++saveToken;
    const revision = Number(snapshot.revision) || 1;
    const nextRevision = revision + 1;
    echoedSave = { id: snapshot.id, revision: nextRevision, html: snapshot.html, title: snapshot.title };
    setSaveState('Saving…', '');
    const updated = await ctx.supabase.from('hs_documents').update({
      title: snapshot.title,
      body_html: snapshot.html,
      revision: nextRevision,
    }).eq('id', snapshot.id).eq('revision', revision).select('revision, updated_at');
    if (token !== saveToken) return;
    const message = updated.error && updated.error.message ? updated.error.message : '';
    const rows = Array.isArray(updated.data) ? updated.data : [];
    if (/revision conflict/i.test(message) || (!updated.error && !rows.length)) {
      dirty = true;
      echoedSave = null;
      setSaveState('Newer changes', 'is-dirty');
      schedulePull(snapshot.id);
      schedulePresence();
      return;
    }
    if (updated.error) {
      dirty = true;
      echoedSave = null;
      setSaveState("Couldn't save", 'is-error');
      setError('The document could not be saved.');
      console.error('Document save failed', updated.error);
      schedulePresence();
      return;
    }
    const saved = rows[0] || {};
    if (openDoc && openDoc.id === snapshot.id) {
      openDoc.title = snapshot.title;
      openDoc.body_html = snapshot.html;
      openDoc.revision = saved.revision || nextRevision;
      if (saved.updated_at) openDoc.updated_at = saved.updated_at;
    }
    const row = documents.find(doc => doc.id === snapshot.id);
    if (row) {
      row.title = snapshot.title;
      row.revision = saved.revision || nextRevision;
      row.updated_at = saved.updated_at || new Date().toISOString();
    }
    setSaveState('Saved', 'is-saved');
    schedulePresence();
  }

  function saveNow() {
    const snapshot = capture();
    if (snapshot) return persist(snapshot);
    return Promise.resolve();
  }

  async function hydrate(instance) {
    const paths = [];
    instance.state.doc.descendants(node => {
      if (node.type.name === 'image' && node.attrs.storagePath) paths.push(node.attrs.storagePath);
    });
    const sources = {};
    await Promise.all(paths.map(async path => {
      const { data, error } = await ctx.supabase.storage.from(BUCKET).download(path);
      if (error || !data) return;
      const url = URL.createObjectURL(data);
      objectUrls.push(url);
      sources[path] = url;
    }));
    window.HSEditor.setImageSources(instance, sources);
  }

  async function openDocument(id) {
    setError('');
    ensureInbox();
    const { data, error } = await ctx.supabase.from('hs_documents').select('*').eq('id', id).single();
    if (error || !data) {
      setError('That document could not be opened.');
      return;
    }
    const previous = capture();
    destroyEditor();
    if (previous) persist(previous);
    openDoc = data;
    openDoc.revision = Number(data.revision) || 1;
    $('docsLibrary').hidden = true;
    $('docsEditor').hidden = false;
    $('docsTitle').value = data.title || '';
    const editable = canEdit(data);
    $('docsTitle').readOnly = !editable;
    $('docsReadOnly').hidden = editable;
    $('docsSave').hidden = !editable;
    $('docsWordbar').hidden = !editable;
    $('docsMove').hidden = !canManage(data);
    $('docsDelete').hidden = !canManage(data);
    $('docsShare').hidden = me().role !== 'manager';
    buildToolbar();
    if (!window.HSEditor) {
      setError('The editor failed to load.');
      return;
    }
    acceptUpdates = false;
    editor = window.HSEditor.createEditor($('docsSurface'), {
      html: data.body_html || '<p></p>',
      editable,
      openLinks: !editable,
      onImageFiles: uploadImages,
      onUpdate: () => { refreshToolbar(); markDirty(); },
      onSelection: refreshToolbar,
    });
    await hydrate(editor);
    acceptUpdates = true;
    dirty = false;
    setSaveState('Saved', 'is-saved');
    refreshToolbar();
    ctx.setPageHeading(data.title || 'Document', 'Documents');
    watchDocument(data.id);
    await renderLinkedLessons(data.id);
  }

  function lessonTasks() {
    return ctx.getTasks ? (ctx.getTasks() || []) : [];
  }

  async function renderLinkedLessons(docId) {
    const el = $('docsLessons');
    const token = ++lessonToken;
    if (!el) return;
    el.innerHTML = '';
    el.hidden = true;
    if (!docId || !ctx.supabase) return;
    const { data, error } = await ctx.supabase.from('hs_lesson_documents').select('task_id, document_id').eq('document_id', docId);
    if (token !== lessonToken || !openDoc || openDoc.id !== docId) return;
    if (error) {
      console.error('Lesson links failed', error);
      return;
    }
    const rows = data || [];
    lessonLinks = lessonLinks.filter(link => link.document_id !== docId).concat(rows);
    const shown = window.HSLessonLinks
      ? window.HSLessonLinks.lessonsForDocument(rows, lessonTasks(), docId)
      : rows.map(link => ({ id: link.task_id, label: 'Lesson' }));
    if (!shown.length) return;
    const label = document.createElement('span');
    label.className = 'docs-lessons-label';
    label.textContent = 'Lessons';
    el.appendChild(label);
    shown.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'docs-lesson-chip';
      button.textContent = item.label;
      button.addEventListener('click', () => {
        if (ctx.openTask) ctx.openTask(item.id);
      });
      el.appendChild(button);
    });
    el.hidden = false;
  }

  async function uploadImages(files) {
    if (!openDoc || !editor || !canEdit(openDoc)) return;
    for (const file of files) {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[file.type];
      if (!ext) continue;
      if (file.size > 5242880) {
        setError('Images need to be 5 MB or smaller.');
        continue;
      }
      const path = openDoc.owner_email + '/' + openDoc.id + '/' + crypto.randomUUID() + '.' + ext;
      const uploaded = await ctx.supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) {
        setError('The image could not be uploaded.');
        console.error('Image upload failed', uploaded.error);
        continue;
      }
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      window.HSEditor.insertStoredImage(editor, path, url);
      setError('');
    }
  }

  async function removeStoredImages(ownerEmail, docId) {
    const prefix = ownerEmail + '/' + docId;
    const listed = await ctx.supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (listed.error || !listed.data || !listed.data.length) return;
    const paths = listed.data.filter(file => file && file.name).map(file => prefix + '/' + file.name);
    if (paths.length) await ctx.supabase.storage.from(BUCKET).remove(paths);
  }

  async function copyImages(html, ownerEmail, docId) {
    const prepared = window.HSEditor.prepareHtmlForStorage(html);
    const parsed = new DOMParser().parseFromString('<div>' + prepared + '</div>', 'text/html');
    const root = parsed.body.firstElementChild || parsed.body;
    const images = Array.from(root.querySelectorAll('img[data-path]'));
    for (const image of images) {
      const from = image.getAttribute('data-path');
      const ext = (from.split('.').pop() || 'png').toLowerCase();
      const to = ownerEmail + '/' + docId + '/' + crypto.randomUUID() + '.' + ext;
      let copied = await ctx.supabase.storage.from(BUCKET).copy(from, to);
      if (copied.error) {
        const downloaded = await ctx.supabase.storage.from(BUCKET).download(from);
        if (downloaded.error || !downloaded.data) {
          image.remove();
          continue;
        }
        copied = await ctx.supabase.storage.from(BUCKET).upload(to, downloaded.data, {
          contentType: downloaded.data.type || 'image/png',
          upsert: false,
        });
        if (copied.error) {
          image.remove();
          continue;
        }
      }
      image.setAttribute('data-path', to);
      image.removeAttribute('src');
    }
    return window.HSEditor.prepareHtmlForStorage(root.innerHTML);
  }

  function closeDialog(value) {
    $('docsDialog').hidden = true;
    const read = dialogRead;
    dialogRead = null;
    if (read) read(value);
    if (libraryQueued) scheduleLibrary();
  }

  function openDialog(options) {
    return new Promise(resolve => {
      dialogRead = resolve;
      $('docsDialogTitle').textContent = options.title;
      const body = $('docsDialogBody');
      body.innerHTML = '';
      options.build(body);
      $('docsDialogOk').textContent = options.okLabel || 'Save';
      $('docsDialogOk').classList.toggle('btn-danger', !!options.danger);
      $('docsDialog').hidden = false;
      const field = body.querySelector('input, select, button');
      if (field) field.focus();
    });
  }

  async function askText(title, label, value) {
    let input = null;
    const ok = await openDialog({
      title,
      okLabel: 'Save',
      build(body) {
        const field = document.createElement('label');
        field.className = 'field';
        field.appendChild(document.createTextNode(label));
        input = document.createElement('input');
        input.value = value || '';
        input.maxLength = 200;
        field.appendChild(input);
        body.appendChild(field);
      },
    });
    if (!ok) return null;
    return input.value.trim();
  }

  async function editLink() {
    if (!editor) return;
    const current = editor.getAttributes('link').href || 'https://';
    const href = await askText('Link', 'Web address (leave blank to remove)', current === 'https://' ? '' : current);
    if (href === null) return;
    if (!href) editor.chain().focus().unsetLink().run();
    else if (window.HSEditor.isAllowedLink(href)) editor.chain().focus().setLink({ href }).run();
    else setError('Links need to start with http://, https://, or mailto:.');
    markDirty();
  }

  async function createFolder() {
    const owner = targetOwner();
    if (!owner) {
      setError('That student login is not linked yet. Save the student once in Settings.');
      return;
    }
    const parentId = selectedFolderId && selectedFolderId !== SHARED ? selectedFolderId : null;
    if (parentId && depthOf(parentId) >= 7) {
      setError('Folders can only be nested 8 levels deep.');
      return;
    }
    const name = await askText('New folder', 'Folder name', '');
    if (!name) return;
    const { error } = await ctx.supabase.from('hs_doc_folders').insert({
      name,
      parent_id: parentId,
      owner_id: owner.id,
      owner_email: owner.email,
    });
    if (error) {
      setError('The folder could not be created.');
      console.error('Folder insert failed', error);
      return;
    }
    await loadAll();
    renderLibrary();
  }

  async function renameFolder(folder) {
    const name = await askText('Rename folder', 'Folder name', folder.name);
    if (!name || name === folder.name) return;
    const { error } = await ctx.supabase.from('hs_doc_folders').update({ name }).eq('id', folder.id);
    if (error) {
      setError('The folder could not be renamed.');
      return;
    }
    await loadAll();
    renderLibrary();
  }

  async function deleteFolder(folder) {
    const ids = descendantIds(folder.id);
    const inside = documents.filter(doc => ids.indexOf(doc.folder_id) !== -1);
    const insideFiles = files.filter(file => ids.indexOf(file.folder_id) !== -1);
    const extra = (ids.length - 1) + ' subfolder' + (ids.length - 1 === 1 ? '' : 's') + ', ' + inside.length + ' document' + (inside.length === 1 ? '' : 's') + ', and ' + insideFiles.length + ' file' + (insideFiles.length === 1 ? '' : 's');
    if (!confirm('Delete folder "' + folder.name + '"? This also deletes ' + extra + '.')) return;
    for (const doc of inside) await removeStoredImages(doc.owner_email, doc.id);
    const { error } = await ctx.supabase.from('hs_doc_folders').delete().eq('id', folder.id);
    if (error) {
      setError('The folder could not be deleted.');
      console.error('Folder delete failed', error);
      return;
    }
    if (ids.indexOf(selectedFolderId) !== -1) selectedFolderId = folder.parent_id || null;
    await loadAll();
    renderLibrary();
  }

  async function createDocument() {
    const owner = targetOwner();
    if (!owner) {
      setError('That student login is not linked yet. Save the student once in Settings.');
      return;
    }
    const folderId = selectedFolderId && selectedFolderId !== SHARED ? selectedFolderId : null;
    const { data, error } = await ctx.supabase.from('hs_documents').insert({
      title: 'Untitled document',
      body_html: '<p></p>',
      folder_id: folderId,
      owner_id: owner.id,
      owner_email: owner.email,
    }).select('id').single();
    if (error || !data) {
      setError('The document could not be created.');
      console.error('Document insert failed', error);
      return;
    }
    await loadAll();
    await openDocument(data.id);
  }

  async function duplicateDocument(id) {
    const { data, error } = await ctx.supabase.from('hs_documents').select('*').eq('id', id).single();
    if (error || !data) {
      setError('The document could not be duplicated.');
      return;
    }
    const user = me();
    const keepOwner = user.role === 'manager' || data.owner_id === user.id;
    const owner = keepOwner
      ? { owner_id: data.owner_id, owner_email: data.owner_email, folder_id: data.folder_id }
      : { owner_id: user.id, owner_email: user.email, folder_id: null };
    const title = (data.title || 'Document') + ' copy';
    const inserted = await ctx.supabase.from('hs_documents').insert({
      title: title.slice(0, 200),
      body_html: '<p></p>',
      folder_id: owner.folder_id,
      owner_id: owner.owner_id,
      owner_email: owner.owner_email,
    }).select('id').single();
    if (inserted.error || !inserted.data) {
      setError('The document could not be duplicated.');
      return;
    }
    const html = await copyImages(data.body_html || '<p></p>', owner.owner_email, inserted.data.id);
    await ctx.supabase.from('hs_documents').update({ body_html: html }).eq('id', inserted.data.id);
    await loadAll();
    await openDocument(inserted.data.id);
  }

  function moveChoices(ownerEmail, ownerId) {
    const user = me();
    return folders.filter(folder => {
      if (folder.owner_email !== ownerEmail) return false;
      if (!user) return false;
      if (user.role === 'manager' || folder.owner_id === user.id || ownerId === user.id) return true;
      return folderAccess(folder.id) === 'edit';
    });
  }

  async function moveDocument(doc) {
    const user = me();
    const choices = moveChoices(doc.owner_email, doc.owner_id);
    const allowRoot = user && (user.role === 'manager' || doc.owner_id === user.id);
    let select = null;
    const ok = await openDialog({
      title: 'Move document',
      okLabel: 'Move',
      build(body) {
        const field = document.createElement('label');
        field.className = 'field';
        field.appendChild(document.createTextNode('Folder'));
        select = document.createElement('select');
        if (allowRoot) {
          const root = document.createElement('option');
          root.value = '';
          root.textContent = 'Library (no folder)';
          select.appendChild(root);
        }
        choices.forEach(folder => {
          const option = document.createElement('option');
          option.value = folder.id;
          option.textContent = folderPath(folder.id);
          if (folder.id === doc.folder_id) option.selected = true;
          select.appendChild(option);
        });
        field.appendChild(select);
        body.appendChild(field);
      },
    });
    if (!ok) return;
    const folderId = select.value || null;
    if (!folderId && !allowRoot) return;
    const { error } = await ctx.supabase.from('hs_documents').update({ folder_id: folderId }).eq('id', doc.id);
    if (error) {
      setError('The document could not be moved.');
      console.error('Document move failed', error);
      return;
    }
    if (openDoc && openDoc.id === doc.id) openDoc.folder_id = folderId;
    await loadAll();
    if ($('docsEditor').hidden) renderLibrary();
  }

  async function deleteDocument(doc) {
    if (!confirm('Delete document "' + (doc.title || 'Untitled document') + '"?')) return;
    await removeStoredImages(doc.owner_email, doc.id);
    const { error } = await ctx.supabase.from('hs_documents').delete().eq('id', doc.id);
    if (error) {
      setError('The document could not be deleted.');
      return;
    }
    if (openDoc && openDoc.id === doc.id) {
      destroyEditor();
      showLibraryPane();
    }
    lessonLinks = lessonLinks.filter(link => link.document_id !== doc.id);
    if (ctx.onLinksChanged) ctx.onLinksChanged();
    await loadAll();
    renderLibrary();
  }

  async function shareDocument(doc) {
    const students = Object.entries(directory()).filter(([, person]) => person && person.role === 'student' && person !== undefined);
    const relevant = students.filter(([email]) => email !== doc.owner_email);
    if (!relevant.length) {
      setError('There are no other students to share with.');
      return;
    }
    const picks = {};
    const ok = await openDialog({
      title: 'Share document',
      okLabel: 'Save sharing',
      build(body) {
        relevant.forEach(([email, person]) => {
          const row = document.createElement('div');
          row.className = 'docs-share-row';
          const name = document.createElement('span');
          name.textContent = person.name || 'Student';
          const select = document.createElement('select');
          select.setAttribute('aria-label', 'Access for ' + (person.name || 'student'));
          [['', 'No access'], ['view', 'Can view'], ['edit', 'Can edit']].forEach(choice => {
            const option = document.createElement('option');
            option.value = choice[0];
            option.textContent = choice[1];
            select.appendChild(option);
          });
          const existing = shares.find(share => share.document_id === doc.id && share.shared_with_email === email);
          select.value = existing ? existing.permission : '';
          picks[email] = select;
          row.appendChild(name);
          row.appendChild(select);
          body.appendChild(row);
        });
      },
    });
    if (!ok) return;
    const wanted = Object.entries(picks).filter(([, select]) => select.value).map(([email, select]) => ({
      document_id: doc.id,
      shared_with_email: email,
      permission: select.value,
    }));
    const existing = shares.filter(share => share.document_id === doc.id);
    const remove = existing.filter(share => !wanted.some(item => item.shared_with_email === share.shared_with_email)).map(share => share.shared_with_email);
    if (remove.length) {
      const deleted = await ctx.supabase.from('hs_document_shares').delete().eq('document_id', doc.id).in('shared_with_email', remove);
      if (deleted.error) {
        setError('Sharing could not be updated.');
        return;
      }
    }
    if (wanted.length) {
      const saved = await ctx.supabase.from('hs_document_shares').upsert(wanted, { onConflict: 'document_id,shared_with_email' });
      if (saved.error) {
        setError('Sharing could not be updated.');
        console.error('Share upsert failed', saved.error);
        return;
      }
    }
    await loadAll();
    if ($('docsEditor').hidden) renderLibrary();
    else if (openDoc && openDoc.id === doc.id) {
      $('docsReadOnly').hidden = canEdit(openDoc);
    }
  }

  function printDocument() {
    if (!editor) return;
    const root = $('docPrint');
    root.innerHTML = '';
    const title = document.createElement('h1');
    title.className = 'doc-print-title';
    title.textContent = $('docsTitle').value || 'Document';
    const body = document.createElement('div');
    body.className = 'doc-prose';
    body.innerHTML = window.HSEditor.sanitizeHtml(editor.getHTML());
    root.appendChild(title);
    root.appendChild(body);
    document.body.classList.add('printing-document');
    window.print();
    document.body.classList.remove('printing-document');
    root.innerHTML = '';
  }

  async function exportWord() {
    if (!editor) return;
    setSaveState('Preparing Word file…', '');
    try {
      const blob = await window.HSEditor.exportDocx(editor.getHTML(), {
        title: $('docsTitle').value || 'Document',
        resolveImage: async path => {
          const downloaded = await ctx.supabase.storage.from(BUCKET).download(path);
          if (downloaded.error || !downloaded.data) return null;
          return { data: new Uint8Array(await downloaded.data.arrayBuffer()), type: downloaded.data.type || 'image/png' };
        },
      });
      const link = document.createElement('a');
      const safe = ($('docsTitle').value || 'document').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'document';
      link.href = URL.createObjectURL(blob);
      link.download = safe + '.docx';
      link.click();
      URL.revokeObjectURL(link.href);
      setSaveState(dirty ? 'Unsaved changes' : 'Saved', dirty ? 'is-dirty' : 'is-saved');
    } catch (error) {
      setSaveState("Couldn't export", 'is-error');
      setError('The Word file could not be created.');
      console.error('Docx export failed', error);
    }
  }

  async function shareFolder(folder) {
    const students = Object.entries(directory()).filter(([, person]) => person && person.role === 'student');
    const relevant = students.filter(([email]) => email !== folder.owner_email);
    if (!relevant.length) {
      setError('There are no other students to share with.');
      return;
    }
    const picks = {};
    const ok = await openDialog({
      title: 'Share folder',
      okLabel: 'Save sharing',
      build(body) {
        const hint = document.createElement('p');
        hint.className = 'docs-share-hint';
        hint.textContent = 'People you share this folder with can open everything inside it, including subfolders, documents, and files. Can edit includes upload, rename, move, and delete.';
        body.appendChild(hint);
        relevant.forEach(([email, person]) => {
          const row = document.createElement('div');
          row.className = 'docs-share-row';
          const name = document.createElement('span');
          name.textContent = person.name || 'Student';
          const select = document.createElement('select');
          select.setAttribute('aria-label', 'Access for ' + (person.name || 'student'));
          [['', 'No access'], ['view', 'Can view'], ['edit', 'Can edit']].forEach(choice => {
            const option = document.createElement('option');
            option.value = choice[0];
            option.textContent = choice[1];
            select.appendChild(option);
          });
          const existing = folderShares.find(share => share.folder_id === folder.id && share.shared_with_email === email);
          select.value = existing ? existing.permission : '';
          picks[email] = select;
          row.appendChild(name);
          row.appendChild(select);
          body.appendChild(row);
        });
      },
    });
    if (!ok) return;
    const wanted = Object.entries(picks).filter(([, select]) => select.value).map(([email, select]) => ({
      folder_id: folder.id,
      shared_with_email: email,
      permission: select.value,
    }));
    const existing = folderShares.filter(share => share.folder_id === folder.id);
    const remove = existing.filter(share => !wanted.some(item => item.shared_with_email === share.shared_with_email)).map(share => share.shared_with_email);
    if (remove.length) {
      const deleted = await ctx.supabase.from('hs_folder_shares').delete().eq('folder_id', folder.id).in('shared_with_email', remove);
      if (deleted.error) {
        setError('Sharing could not be updated.');
        return;
      }
    }
    if (wanted.length) {
      const saved = await ctx.supabase.from('hs_folder_shares').upsert(wanted, { onConflict: 'folder_id,shared_with_email' });
      if (saved.error) {
        setError('Sharing could not be updated.');
        console.error('Folder share upsert failed', saved.error);
        return;
      }
    }
    await loadAll();
    renderLibrary();
  }

  function cleanFileName(name) {
    const cleaned = String(name || 'File').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 240);
    return cleaned || 'File';
  }

  async function uploadFiles(list) {
    const incoming = Array.from(list || []);
    if (!incoming.length || !canAddHere()) return;
    const owner = targetOwner();
    if (!owner) {
      setError('That student login is not linked yet. Save the student once in Settings.');
      return;
    }
    const folderId = selectedFolderId && selectedFolderId !== SHARED ? selectedFolderId : null;
    let message = '';
    for (const file of incoming) {
      const name = cleanFileName(file.name);
      if (!file.size) {
        message = '"' + name + '" is empty.';
        continue;
      }
      if (file.size > FILE_LIMIT) {
        message = '"' + name + '" is larger than 50 MB.';
        continue;
      }
      const id = crypto.randomUUID();
      const mime = String(file.type || 'application/octet-stream').slice(0, 200) || 'application/octet-stream';
      const inserted = await ctx.supabase.from('hs_files').insert({
        id: id,
        owner_id: owner.id,
        owner_email: owner.email,
        folder_id: folderId,
        name: name,
        storage_path: id,
        mime_type: mime,
        size_bytes: file.size,
      }).select('id').single();
      if (inserted.error || !inserted.data) {
        message = '"' + name + '" could not be saved.';
        console.error('File insert failed', inserted.error);
        continue;
      }
      const uploaded = await ctx.supabase.storage.from(FILE_BUCKET).upload(id, file, { contentType: mime, upsert: false });
      if (uploaded.error) {
        await ctx.supabase.from('hs_files').delete().eq('id', id);
        message = '"' + name + '" could not be uploaded.';
        console.error('File upload failed', uploaded.error);
        continue;
      }
    }
    await loadAll();
    renderLibrary();
    if (message) setError(message);
  }

  async function signedFileUrl(file, seconds, downloadName) {
    const options = downloadName ? { download: downloadName } : undefined;
    const signed = await ctx.supabase.storage.from(FILE_BUCKET).createSignedUrl(file.storage_path, seconds, options);
    if (signed.error || !signed.data || !signed.data.signedUrl) return '';
    return signed.data.signedUrl;
  }

  async function downloadFile(file) {
    const url = await signedFileUrl(file, 120, file.name || 'file');
    if (!url) {
      setError('The file could not be downloaded.');
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name || 'file';
    link.rel = 'noopener';
    link.click();
  }

  function closePreview() {
    const preview = $('docsPreview');
    if (!preview) return;
    preview.hidden = true;
    const body = $('docsPreviewBody');
    if (body) body.innerHTML = '';
    previewFile = null;
    if (libraryQueued) scheduleLibrary();
  }

  async function openFile(id) {
    setError('');
    const loaded = await ctx.supabase.from('hs_files').select('*').eq('id', id).single();
    if (loaded.error || !loaded.data) {
      setError('That file could not be opened.');
      return;
    }
    const file = loaded.data;
    previewFile = file;
    const preview = $('docsPreview');
    const body = $('docsPreviewBody');
    $('docsPreviewTitle').textContent = file.name || 'File';
    body.innerHTML = '';
    const waiting = document.createElement('p');
    waiting.className = 'docs-preview-note';
    waiting.textContent = 'Opening a private link…';
    body.appendChild(waiting);
    preview.hidden = false;
    const url = await signedFileUrl(file, 300);
    if (previewFile !== file) return;
    body.innerHTML = '';
    if (!url) {
      const note = document.createElement('p');
      note.className = 'docs-preview-note';
      note.textContent = 'The file could not be opened.';
      body.appendChild(note);
      return;
    }
    const linked = await ctx.supabase.from('hs_lesson_files').select('task_id, file_id').eq('file_id', file.id);
    if (previewFile !== file) return;
    if (!linked.error) fileLinks = fileLinks.filter(link => link.file_id !== file.id).concat(linked.data || []);
    const kind = previewKind(file);
    if (kind === 'image') {
      const image = document.createElement('img');
      image.alt = file.name || 'Image';
      image.src = url;
      body.appendChild(image);
    } else if (kind === 'pdf') {
      const frame = document.createElement('iframe');
      frame.title = file.name || 'PDF';
      frame.src = url;
      body.appendChild(frame);
    } else {
      const note = document.createElement('p');
      note.className = 'docs-preview-note';
      note.textContent = 'Preview is available for images and PDFs. Download this file to open it.';
      body.appendChild(note);
    }
    const lessons = window.HSLessonLinks
      ? window.HSLessonLinks.lessonsForFile(fileLinks, lessonTasks(), file.id)
      : [];
    if (lessons.length) {
      const row = document.createElement('div');
      row.className = 'docs-preview-lessons';
      lessons.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'docs-lesson-chip';
        button.textContent = item.label;
        button.addEventListener('click', () => {
          closePreview();
          if (ctx.openTask) ctx.openTask(item.id);
        });
        row.appendChild(button);
      });
      body.appendChild(row);
    }
  }

  async function renameFile(file) {
    const name = await askText('Rename file', 'File name', file.name);
    if (!name || name === file.name) return;
    const { error } = await ctx.supabase.from('hs_files').update({ name: cleanFileName(name) }).eq('id', file.id);
    if (error) {
      setError('The file could not be renamed.');
      return;
    }
    await loadAll();
    renderLibrary();
  }

  async function moveFile(file) {
    const user = me();
    const choices = moveChoices(file.owner_email, file.owner_id);
    const allowRoot = user && (user.role === 'manager' || file.owner_id === user.id);
    let select = null;
    const ok = await openDialog({
      title: 'Move file',
      okLabel: 'Move',
      build(body) {
        const field = document.createElement('label');
        field.className = 'field';
        field.appendChild(document.createTextNode('Folder'));
        select = document.createElement('select');
        if (allowRoot) {
          const root = document.createElement('option');
          root.value = '';
          root.textContent = 'Library (no folder)';
          select.appendChild(root);
        }
        choices.forEach(folder => {
          const option = document.createElement('option');
          option.value = folder.id;
          option.textContent = folderPath(folder.id);
          if (folder.id === file.folder_id) option.selected = true;
          select.appendChild(option);
        });
        field.appendChild(select);
        body.appendChild(field);
      },
    });
    if (!ok || !select) return;
    const folderId = select.value || null;
    if (!folderId && !allowRoot) return;
    const { error } = await ctx.supabase.from('hs_files').update({ folder_id: folderId }).eq('id', file.id);
    if (error) {
      setError('The file could not be moved.');
      console.error('File move failed', error);
      return;
    }
    await loadAll();
    renderLibrary();
  }

  async function deleteFile(file) {
    if (!confirm('Delete file "' + (file.name || 'File') + '"?')) return;
    const { error } = await ctx.supabase.from('hs_files').delete().eq('id', file.id);
    if (error) {
      setError('The file could not be deleted.');
      console.error('File delete failed', error);
      return;
    }
    fileLinks = fileLinks.filter(link => link.file_id !== file.id);
    if (ctx.onLinksChanged) ctx.onLinksChanged();
    await loadAll();
    renderLibrary();
  }

  function bind() {
    $('docsLibraryPicker').addEventListener('change', () => {
      libraryEmail = $('docsLibraryPicker').value;
      selectedFolderId = null;
      renderLibrary();
    });
    $('docsSearch').addEventListener('input', renderList);
    $('docsNewFolder').addEventListener('click', createFolder);
    $('docsNewDoc').addEventListener('click', createDocument);
    $('docsUpload').addEventListener('click', () => $('docsFileInput').click());
    $('docsFileInput').addEventListener('change', event => {
      const chosen = Array.from(event.target.files || []);
      try { event.target.value = ''; } catch (error) { /* some browsers reject resetting a file input */ }
      uploadFiles(chosen);
    });
    const zone = $('docsLibrary');
    zone.addEventListener('dragover', event => {
      if (!canAddHere()) return;
      event.preventDefault();
      $('docsList').classList.add('is-dropping');
    });
    zone.addEventListener('dragleave', event => {
      if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
      $('docsList').classList.remove('is-dropping');
    });
    zone.addEventListener('drop', event => {
      $('docsList').classList.remove('is-dropping');
      if (!canAddHere()) return;
      event.preventDefault();
      uploadFiles(event.dataTransfer && event.dataTransfer.files);
    });
    $('docsPreviewClose').addEventListener('click', closePreview);
    $('docsPreviewDownload').addEventListener('click', () => { if (previewFile) downloadFile(previewFile); });
    $('docsPreview').addEventListener('click', event => {
      if (event.target === $('docsPreview')) closePreview();
    });
    $('docsBack').addEventListener('click', () => showLibrary());
    $('docsSave').addEventListener('click', saveNow);
    if ($('docsConflictLoad')) $('docsConflictLoad').addEventListener('click', loadTheirVersion);
    if ($('docsConflictKeep')) $('docsConflictKeep').addEventListener('click', keepMyVersion);
    $('docsTitle').addEventListener('input', markDirty);
    $('docsDuplicate').addEventListener('click', () => openDoc && duplicateDocument(openDoc.id));
    $('docsMove').addEventListener('click', () => openDoc && moveDocument(openDoc));
    $('docsDelete').addEventListener('click', () => openDoc && deleteDocument(openDoc));
    $('docsShare').addEventListener('click', () => openDoc && shareDocument(openDoc));
    $('docsExportDocx').addEventListener('click', exportWord);
    $('docsExportPdf').addEventListener('click', printDocument);
    $('docsPrint').addEventListener('click', printDocument);
    $('docsFindNext').addEventListener('click', () => {
      if (!editor) return;
      const found = window.HSEditor.findNext(editor, $('docsFindQuery').value);
      $('docsFindStatus').textContent = found ? '' : 'No matches';
    });
    $('docsReplace').addEventListener('click', () => {
      if (!editor || !canEdit(openDoc)) return;
      const found = window.HSEditor.replaceCurrent(editor, $('docsFindQuery').value, $('docsReplaceQuery').value);
      $('docsFindStatus').textContent = found ? '' : 'No matches';
      markDirty();
    });
    $('docsReplaceAll').addEventListener('click', () => {
      if (!editor || !canEdit(openDoc)) return;
      const count = window.HSEditor.replaceAll(editor, $('docsFindQuery').value, $('docsReplaceQuery').value);
      $('docsFindStatus').textContent = count ? count + ' replaced' : 'No matches';
      if (count) markDirty();
    });
    $('docsFindClose').addEventListener('click', () => { $('docsFind').hidden = true; });
    $('docsImageInput').addEventListener('change', event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      uploadImages(files);
    });
    $('docsDialogCancel').addEventListener('click', () => closeDialog(false));
    $('docsDialogOk').addEventListener('click', () => closeDialog(true));
    $('docsDialog').addEventListener('click', event => {
      if (event.target === $('docsDialog')) closeDialog(false);
    });
    document.addEventListener('keydown', event => {
      if (!$('docsPreview').hidden && event.key === 'Escape') {
        closePreview();
        return;
      }
      if (!$('docsDialog').hidden && event.key === 'Escape') closeDialog(false);
      if (!document.body.classList.contains('view-documents') || $('docsEditor').hidden) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 's') {
        event.preventDefault();
        saveNow();
      } else if ((event.metaKey || event.ctrlKey) && key === 'p') {
        event.preventDefault();
        printDocument();
      } else if ((event.metaKey || event.ctrlKey) && key === 'f') {
        event.preventDefault();
        $('docsFind').hidden = false;
        $('docsFindQuery').focus();
      }
    });
    window.addEventListener('beforeunload', event => {
      if (!dirty) return;
      saveNow();
      event.preventDefault();
      event.returnValue = '';
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.doc-color')) closeMenus();
    });
  }

  async function showLibrary() {
    ensureInbox();
    const snapshot = capture();
    destroyEditor();
    showLibraryPane();
    if (snapshot) await persist(snapshot);
    const ok = await loadAll();
    if (ok) renderLibrary();
  }

  const showDocument = openDocument;
  const showFile = openFile;

  window.HSDocuments = {
    mount(next) {
      ctx = next;
      const user = me();
      libraryEmail = user ? user.email : '';
      bind();
    },
    open() {
      if (!me()) return;
      if (!libraryEmail) libraryEmail = me().email;
      showLibrary();
    },
    openDocument(id) {
      return showDocument(id);
    },
    openFile(id) {
      ensureInbox();
      const snapshot = capture();
      destroyEditor();
      showLibraryPane();
      if (snapshot) persist(snapshot);
      closePreview();
      return showFile(id);
    },
    refreshLessons() {
      if (!openDoc || $('docsEditor').hidden) return Promise.resolve();
      return renderLinkedLessons(openDoc.id);
    },
    leave() {
      const snapshot = capture();
      destroyEditor();
      if (snapshot) persist(snapshot);
      closeMenus();
      closePreview();
      stopInbox();
    },
  };
})();
