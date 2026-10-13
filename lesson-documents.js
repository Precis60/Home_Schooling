(function (root) {
  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function taskEmails(task) {
    const emails = [];
    if (task && task.assignee) emails.push(normalizeEmail(task.assignee));
    const extra = task && Array.isArray(task.assignees) ? task.assignees : [];
    extra.forEach(email => emails.push(normalizeEmail(email)));
    return emails.filter((email, index) => email && emails.indexOf(email) === index);
  }

  function folderSharedWith(folderId, emails, folders, folderShares) {
    let current = folderId;
    let guard = 0;
    const folderList = folders || [];
    const shareList = folderShares || [];
    while (current && guard < 12) {
      const folder = folderList.find(item => item && item.id === current);
      if (folder && emails.indexOf(normalizeEmail(folder.owner_email)) !== -1) return true;
      if (shareList.some(share => share && share.folder_id === current && emails.indexOf(normalizeEmail(share.shared_with_email)) !== -1)) return true;
      if (!folder) return false;
      current = folder.parent_id;
      guard += 1;
    }
    return false;
  }

  function assigneeCanSeeDocument(doc, task, shares, context) {
    if (!doc || !task) return false;
    const emails = taskEmails(task);
    if (!emails.length) return false;
    if (emails.indexOf(normalizeEmail(doc.owner_email)) !== -1) return true;
    if ((shares || []).some(share => share && share.document_id === doc.id && emails.indexOf(normalizeEmail(share.shared_with_email)) !== -1)) return true;
    const folders = context && context.folders;
    const folderShares = context && context.folderShares;
    if (!doc.folder_id || !folders || !folderShares) return false;
    return folderSharedWith(doc.folder_id, emails, folders, folderShares);
  }

  function assigneeCanSeeFile(file, task, context) {
    if (!file || !task) return false;
    const emails = taskEmails(task);
    if (!emails.length) return false;
    if (emails.indexOf(normalizeEmail(file.owner_email)) !== -1) return true;
    const folders = context && context.folders;
    const folderShares = context && context.folderShares;
    if (!file.folder_id || !folders || !folderShares) return false;
    return folderSharedWith(file.folder_id, emails, folders, folderShares);
  }

  function filterFiles(files, query) {
    return filterDocuments((files || []).map(file => Object.assign({}, file, { title: file && file.name })), query);
  }

  function filterDocuments(documents, query) {
    const needle = String(query || '').trim().toLowerCase();
    const list = (documents || []).slice().sort((a, b) => {
      return String(a && a.title || '').localeCompare(String(b && b.title || ''));
    });
    if (!needle) return list;
    return list.filter(doc => String(doc && doc.title || '').toLowerCase().indexOf(needle) !== -1);
  }

  function countForTask(links, taskId) {
    if (!taskId) return 0;
    return (links || []).filter(link => link && link.task_id === taskId).length;
  }

  function lessonsForFile(links, tasks, fileId) {
    return lessonsForDocument((links || []).map(link => ({
      task_id: link && link.task_id,
      document_id: link && link.file_id,
    })), tasks, fileId);
  }

  function lessonsForDocument(links, tasks, documentId) {
    return (links || [])
      .filter(link => link && link.document_id === documentId)
      .map(link => {
        const task = (tasks || []).find(item => item && item.id === link.task_id) || null;
        const when = task ? (task.startDate || task.dueDate || '') : '';
        const title = task && task.title ? task.title : 'Lesson';
        return {
          id: link.task_id,
          title: title,
          when: when,
          label: when ? title + ' · ' + when : title,
        };
      })
      .sort((a, b) => {
        if (a.when && b.when) return String(a.when).localeCompare(String(b.when)) || a.label.localeCompare(b.label);
        if (a.when) return -1;
        if (b.when) return 1;
        return a.label.localeCompare(b.label);
      });
  }

  const api = {
    normalizeEmail: normalizeEmail,
    taskEmails: taskEmails,
    assigneeCanSeeDocument: assigneeCanSeeDocument,
    assigneeCanSeeFile: assigneeCanSeeFile,
    folderSharedWith: folderSharedWith,
    filterDocuments: filterDocuments,
    filterFiles: filterFiles,
    countForTask: countForTask,
    lessonsForDocument: lessonsForDocument,
    lessonsForFile: lessonsForFile,
  };
  root.HSLessonLinks = api;
})(typeof window !== 'undefined' ? window : globalThis);
