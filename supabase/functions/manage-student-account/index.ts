import { createClient } from "jsr:@supabase/supabase-js@2";

// GitHub Pages origin for this repo. The browser Origin header has no path,
// so https://precis60.github.io/Home_Schooling/ is still this origin.
const PAGES_ORIGIN = "https://precis60.github.io";

function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (req.headers.get("Origin") === PAGES_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = PAGES_ORIGIN;
  }
  return headers;
}

type AdminClient = ReturnType<typeof createClient>;

async function listStoragePrefix(admin: AdminClient, prefix: string) {
  const bucket = admin.storage.from("hs-document-images");
  const entries: { name: string; id: string | null }[] = [];
  let offset = 0;
  for (;;) {
    const listed = await bucket.list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (listed.error) return { error: listed.error.message, entries };
    const batch = listed.data || [];
    for (const entry of batch) entries.push({ name: entry.name, id: entry.id ?? null });
    if (batch.length < 100) break;
    offset += batch.length;
  }
  return { error: "", entries };
}

async function copyDocumentImages(admin: AdminClient, fromPrefix: string, toPrefix: string): Promise<string | null> {
  const listed = await listStoragePrefix(admin, fromPrefix);
  if (listed.error) return "image library lookup failed: " + listed.error;
  const bucket = admin.storage.from("hs-document-images");
  for (const entry of listed.entries) {
    const fromPath = fromPrefix + "/" + entry.name;
    const toPath = toPrefix + "/" + entry.name;
    if (entry.id == null) {
      const nested = await copyDocumentImages(admin, fromPath, toPath);
      if (nested) return nested;
      continue;
    }
    const copied = await bucket.copy(fromPath, toPath);
    if (copied.error) return "image copy failed: " + copied.error.message;
  }
  return null;
}

async function removeDocumentImages(admin: AdminClient, prefix: string): Promise<string | null> {
  const listed = await listStoragePrefix(admin, prefix);
  if (listed.error) return "image library cleanup failed: " + listed.error;
  const bucket = admin.storage.from("hs-document-images");
  const files: string[] = [];
  for (const entry of listed.entries) {
    const path = prefix + "/" + entry.name;
    if (entry.id == null) {
      const nested = await removeDocumentImages(admin, path);
      if (nested) return nested;
      continue;
    }
    files.push(path);
  }
  if (!files.length) return null;
  const removed = await bucket.remove(files);
  if (removed.error) return "image cleanup failed: " + removed.error.message;
  return null;
}

async function moveStudentRecords(admin: AdminClient, currentEmail: string, finalEmail: string): Promise<string | null> {
  const { data: taskRows, error: taskErr } = await admin
    .from("hs_tasks")
    .select("id, data")
    .eq("data->>assignee", currentEmail);
  if (taskErr) return "task lookup failed: " + taskErr.message;
  if (taskRows && taskRows.length) {
    for (const row of taskRows) {
      const newData = { ...(row.data as Record<string, unknown>), assignee: finalEmail };
      const { error: upErr } = await admin.from("hs_tasks").update({ data: newData }).eq("id", row.id);
      if (upErr) return "task update failed: " + upErr.message;
    }
  }

  const { data: spaceRow, error: spaceErr } = await admin
    .from("hs_spaces")
    .select("data")
    .eq("id", currentEmail)
    .maybeSingle();
  if (spaceErr) return "space lookup failed: " + spaceErr.message;
  if (spaceRow && spaceRow.data) {
    const { error: insErr } = await admin.from("hs_spaces").upsert({ id: finalEmail, data: spaceRow.data });
    if (insErr) return "space insert failed: " + insErr.message;
    const { error: delErr } = await admin.from("hs_spaces").delete().eq("id", currentEmail);
    if (delErr) return "space delete failed: " + delErr.message;
  }

  const { error: folderEmailErr } = await admin.from("hs_doc_folders").update({ owner_email: finalEmail }).eq("owner_email", currentEmail);
  if (folderEmailErr) return "document folder update failed: " + folderEmailErr.message;

  const { data: docs, error: docLookupErr } = await admin
    .from("hs_documents")
    .select("id, body_html")
    .eq("owner_email", currentEmail);
  if (docLookupErr) return "document lookup failed: " + docLookupErr.message;
  const fromPath = 'data-path="' + currentEmail + '/';
  const toPath = 'data-path="' + finalEmail + '/';
  for (const doc of docs || []) {
    const html = typeof doc.body_html === "string" ? doc.body_html.split(fromPath).join(toPath) : doc.body_html;
    const { error: docEmailErr } = await admin.from("hs_documents").update({
      owner_email: finalEmail,
      body_html: html,
    }).eq("id", doc.id);
    if (docEmailErr) return "document update failed: " + docEmailErr.message;
  }

  const { error: shareEmailErr } = await admin
    .from("hs_document_shares")
    .update({ shared_with_email: finalEmail })
    .eq("shared_with_email", currentEmail);
  if (shareEmailErr) return "document share update failed: " + shareEmailErr.message;
  return null;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer /i, "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!token) return json({ error: "Missing authorization token" }, 401);

    const clientOpts = { auth: { autoRefreshToken: false, persistSession: false } };

    const authClient = createClient(supabaseUrl, anonKey, {
      ...clientOpts,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized: " + (userErr?.message || "no user") }, 401);
    }
    // Role lives in app_metadata. user_metadata is editable by the account
    // holder and must not be used for this check.
    const callerMeta = userData.user.app_metadata;
    const callerRole = callerMeta && typeof callerMeta.role === "string" ? callerMeta.role : "";
    if (callerRole !== "manager") {
      return json({ error: "Forbidden: manager only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const currentEmail = (body.currentEmail || "").toLowerCase().trim();
    const newEmailRaw = (body.newEmail || "").toLowerCase().trim();
    const newPassword = body.newPassword ? String(body.newPassword) : "";
    const name = body.name ? String(body.name) : "";

    if (!currentEmail && !newEmailRaw) {
      return json({ error: "currentEmail or newEmail is required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, clientOpts);

    // Find the existing auth user by current email (paginate through listUsers)
    let targetUser: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null = null;
    if (currentEmail) {
      let page = 1;
      while (!targetUser) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (listErr) return json({ error: "listUsers failed: " + listErr.message }, 500);
        targetUser = list.users.find((u) => (u.email || "").toLowerCase() === currentEmail) || null;
        if (targetUser || list.users.length < 200) break;
        page++;
      }
    }

    const newEmail = newEmailRaw || currentEmail;
    let resultUser: { id: string; email?: string };

    if (!targetUser) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: newEmail,
        password: newPassword || crypto.randomUUID(),
        email_confirm: true,
        app_metadata: { role: "student" },
      });
      if (createErr) return json({ error: "createUser failed: " + createErr.message }, 500);
      resultUser = { id: created.user!.id, email: created.user!.email };
    } else {
      const existingMeta = targetUser.app_metadata && typeof targetUser.app_metadata === "object"
        ? targetUser.app_metadata
        : {};
      const attrs: Record<string, unknown> = { app_metadata: { ...existingMeta, role: "student" } };
      if (newEmail && newEmail !== currentEmail) {
        attrs.email = newEmail;
        attrs.email_confirm = true;
      }
      if (newPassword) attrs.password = newPassword;
      const { data: updated, error: updateErr } = await admin.auth.admin.updateUserById(targetUser.id, attrs);
      if (updateErr) return json({ error: "updateUserById failed: " + updateErr.message }, 500);
      resultUser = { id: updated.user!.id, email: updated.user!.email };
    }

    const finalEmail = (resultUser.email || newEmail).toLowerCase();

    if (currentEmail && finalEmail !== currentEmail) {
      const imageMove = await copyDocumentImages(admin, currentEmail, finalEmail);
      if (imageMove) return json({ error: imageMove }, 500);

      const moved = await moveStudentRecords(admin, currentEmail, finalEmail);
      if (moved) {
        await removeDocumentImages(admin, finalEmail);
        return json({ error: moved }, 500);
      }
      const imageCleanup = await removeDocumentImages(admin, currentEmail);
      if (imageCleanup) return json({ error: imageCleanup }, 500);
    }

    const { data: dirRow, error: dirErr } = await admin
      .from("hs_users")
      .select("data")
      .eq("id", "main")
      .maybeSingle();
    if (dirErr) return json({ error: "directory lookup failed: " + dirErr.message }, 500);
    const directory = (dirRow && dirRow.data && typeof dirRow.data === "object" ? dirRow.data : {}) as Record<string, unknown>;
    if (currentEmail && currentEmail !== finalEmail) delete directory[currentEmail];
    directory[finalEmail] = { name: name || finalEmail, role: "student", auth_id: resultUser.id };
    const { error: upDirErr } = await admin.from("hs_users").upsert({ id: "main", data: directory });
    if (upDirErr) return json({ error: "directory update failed: " + upDirErr.message }, 500);

    return json({ success: true, email: finalEmail, name: name || finalEmail });
  } catch (err) {
    return json({ error: "Unhandled: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});
