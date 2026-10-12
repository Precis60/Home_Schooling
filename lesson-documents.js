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

  function assigneeCanSeeDocument(doc, task, shares) {
    if (!doc || !task) return false;
    const emails = taskEmails(task);
    if (!emails.length) return false;
    if (emails.indexOf(normalizeEmail(doc.owner_email)) !== -1) return true;
    return (shares || []).some(share => {
      return share && share.document_id === doc.id && emails.indexOf(normalizeEmail(share.shared_with_email)) !== -1;
    });
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
    filterDocuments: filterDocuments,
    countForTask: countForTask,
    lessonsForDocument: lessonsForDocument,
  };
  root.HSLessonLinks = api;
})(typeof window !== 'undefined' ? window : globalThis);
