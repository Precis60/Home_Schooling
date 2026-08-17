import { createClient } from "jsr:@supabase/supabase-js@2";

// Update this if the manager's login email is ever different.
const MANAGER_EMAIL = "jamie@projects-consultant.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
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
    const callerEmail = (userData.user.email || "").toLowerCase();
    if (callerEmail !== MANAGER_EMAIL) {
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
    let targetUser: { id: string; email?: string } | null = null;
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
      const attrs: Record<string, unknown> = { app_metadata: { role: "student" } };
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
      const { data: taskRows, error: taskErr } = await admin
        .from("hs_tasks")
        .select("id, data")
        .eq("data->>assignee", currentEmail);
      if (taskErr) return json({ error: "task lookup failed: " + taskErr.message }, 500);
      if (taskRows && taskRows.length) {
        for (const row of taskRows) {
          const newData = { ...(row.data as Record<string, unknown>), assignee: finalEmail };
          const { error: upErr } = await admin.from("hs_tasks").update({ data: newData }).eq("id", row.id);
          if (upErr) return json({ error: "task update failed: " + upErr.message }, 500);
        }
      }

      const { data: spaceRow, error: spaceErr } = await admin
        .from("hs_spaces")
        .select("data")
        .eq("id", currentEmail)
        .maybeSingle();
      if (spaceErr) return json({ error: "space lookup failed: " + spaceErr.message }, 500);
      if (spaceRow && spaceRow.data) {
        const { error: insErr } = await admin.from("hs_spaces").upsert({ id: finalEmail, data: spaceRow.data });
        if (insErr) return json({ error: "space insert failed: " + insErr.message }, 500);
        const { error: delErr } = await admin.from("hs_spaces").delete().eq("id", currentEmail);
        if (delErr) return json({ error: "space delete failed: " + delErr.message }, 500);
      }
    }

    const { data: dirRow, error: dirErr } = await admin
      .from("hs_users")
      .select("data")
      .eq("id", "main")
      .maybeSingle();
    if (dirErr) return json({ error: "directory lookup failed: " + dirErr.message }, 500);
    const directory = (dirRow && dirRow.data && typeof dirRow.data === "object" ? dirRow.data : {}) as Record<string, unknown>;
    if (currentEmail && currentEmail !== finalEmail) delete directory[currentEmail];
    directory[finalEmail] = { name: name || finalEmail, role: "student" };
    const { error: upDirErr } = await admin.from("hs_users").upsert({ id: "main", data: directory });
    if (upDirErr) return json({ error: "directory update failed: " + upDirErr.message }, 500);

    return json({ success: true, email: finalEmail, name: name || finalEmail });
  } catch (err) {
    return json({ error: "Unhandled: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});
