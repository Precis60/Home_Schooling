# Setting up a dedicated Supabase project

This app must use its own Supabase project - never share one with another
business/app. Follow these steps once to set it up.

## 1. Create the project

1. Go to https://supabase.com/dashboard and click **New project**.
2. Name it something like `home-schooling-hub`.
3. Wait for it to finish provisioning.

## 2. Create the database tables

1. Open **SQL Editor** in the new project.
2. Paste the contents of `supabase/schema.sql` (in this repo) and run it.
   This creates `hs_spaces`, `hs_tasks`, and `hs_users` with the correct
   Row Level Security policies, and seeds your existing categories and
   tasks so nothing is lost.

## 3. Create the three login accounts

Go to **Authentication > Users** in the dashboard and click **Add user**
for each person below. Use "Auto Confirm User" so they can log in
immediately, and set a real password for each.

| Name  | Email                             | Role (see below) |
|-------|------------------------------------|-------------------|
| Jamie | jamie@projects-consultant.com      | manager           |
| Lucas | lucas@projects-consultant.com      | student           |
| Emily | emily@projects-consultant.com      | student           |

After creating each user, click into them, find **Raw App Meta Data**,
and set it to (replacing `manager`/`student` as appropriate):

```json
{ "role": "manager" }
```
or
```json
{ "role": "student" }
```

This role claim is what the Row Level Security policies check, so it must
be set correctly or the app won't be able to read/write data for that
account.

(Once this is set up, Jamie can use the in-app **Settings** tab to change
a student's email/password/name going forward - no more manual dashboard
edits needed for that.)

## 4. Deploy the Edge Function

The Settings tab (letting Jamie update student logins) requires a small
server-side function that uses the project's service role key - this key
must never appear in the browser code.

Using the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <your-new-project-ref>
supabase functions deploy manage-student-account
```

## 5. Get your API credentials

In **Settings > API** in the dashboard, copy:
- **Project URL**
- **anon / publishable key** (NOT the service role / secret key)

## 6. Update index.html

Open `index.html` in this repo and replace these two placeholders near
the top of the `<script>` block:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_PUBLISHABLE_KEY = 'YOUR_SUPABASE_PUBLISHABLE_KEY';
```

with your new project's actual URL and publishable key. Commit and push -
GitHub Pages will pick up the change automatically.
