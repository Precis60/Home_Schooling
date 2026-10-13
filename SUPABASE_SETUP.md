# Setting up a dedicated Supabase project

This app must use its own Supabase project - never share one with another
business/app. Follow these steps once to set it up.

Do not commit real names, emails, passwords, or service-role keys. The
placeholders below are fictional. Keep live account details in the Supabase
dashboard only.

## 1. Create the project

1. Go to https://supabase.com/dashboard and click **New project**.
2. Name it something like `home-schooling-hub`.
3. Wait for it to finish provisioning.

The app in this repository is wired to one dedicated project. Do not point
it at any other Supabase project.

## 2. Create the database tables

1. Open **SQL Editor** in the new project.
2. Paste the contents of `supabase/schema.sql` (in this repo) and run it.
   This creates `hs_spaces`, `hs_tasks`, `hs_users`, the document tables
   (`hs_doc_folders`, `hs_documents`, `hs_document_shares`, `hs_folder_shares`),
   the file table `hs_files`, the lesson link tables `hs_lesson_documents`
   and `hs_lesson_files`, and two private Storage buckets
   (`hs-document-images` and `hs-files`), with Row Level Security:
   - a **manager** can read and write every row, including every document and file
   - a **student** can read and write only their own rows
   - a **student** can also read a document a manager has shared with them,
     and can edit it only when that share says `edit`
   - a **folder** can be shared with a student as `view` or `edit`. That
     share covers the folder and everything inside it (subfolders, documents,
     and files). `edit` includes upload, rename, move, and delete. `view`
     can open and download only
   - uploaded files live in the private `hs-files` bucket (50 MB each).
     The browser uses short-lived signed URLs. The bucket is not public
   - a lesson link (document or file) is visible only when that person can
     already read both the lesson and the item. Linking does not share either side
   - open documents, folders, and files update live over private Realtime
     channels. A student can join a document channel or receive a library
     event only when they can already read that row. Saves carry a revision
     so two people editing at once are not overwritten without a notice
   - deleting a lesson, document, or file removes its links and leaves the other side
   - the role is taken from `app_metadata`, never from `user_metadata`

   Document images stay in the private image bucket. The browser never
   receives a service-role key. Image paths look like
   `{owner-email}/{document-id}/{file-id}.png`. Uploaded files are stored
   under their file id only.

   On an empty project the script also inserts fictional `example.com`
   sample rows. If the tables already have data, that sample insert is
   skipped and existing rows are left alone.

## 3. Create the login accounts

Go to **Authentication > Users** in the dashboard and click **Add user**
for each person. Use "Auto Confirm User" so they can log in immediately,
and set a real password for each. Use your own private addresses. Do not
copy those addresses into this repository.

| Name (example) | Email (example)            | Role (see below) |
|----------------|----------------------------|------------------|
| Morgan Example | manager@example.com        | manager          |
| Alex Example   | student.one@example.com    | student          |
| Sam Example    | student.two@example.com    | student          |

After creating each user, click into them, find **Raw App Meta Data**,
and set it to (replacing `manager`/`student` as appropriate):

```json
{ "role": "manager" }
```
or
```json
{ "role": "student" }
```

Put the role in **App Meta Data**, not User Meta Data. User Meta Data is
editable by the signed-in person, and the Row Level Security policies
ignore it. The in-app sign-in also requires this app-metadata role.

(Once this is set up, the manager can use the in-app **Settings** tab to
change a student's email, password, or display name. Display names are
stored in the private `hs_users` row, not in this repository.)

Changing a live login email is a manual dashboard or Settings-tab action.
Do not delete the Auth user to scrub an address: the space row id, task
assignee, and document owner email have to move with the email, and
Settings does that move (including private document images). Deleting the
user does not revoke tokens that are already issued. Saving a student in
Settings also stores that login's id on the private directory row so the
manager can file documents in the student's library.

## 4. Deploy the Edge Function

The Settings tab (letting the manager update student logins) requires a
small server-side function that uses the project's service role key - this
key must never appear in the browser code or in git.

The function allows browser calls only from
`https://precis60.github.io` (the GitHub Pages origin; the
`/Home_Schooling/` path is not part of the Origin header). It allows the
call only when `app_metadata.role` is `manager`.

Using the [Supabase CLI](https://supabase.com/docs/guides/cli), link the
dedicated project for this app and no other project:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy manage-student-account
```

Keep `verify_jwt` enabled. The function still checks the manager role
itself after the platform accepts the user JWT.

## 5. Get your API credentials

In **Settings > API** in the dashboard, copy:
- **Project URL**
- **anon / publishable key** (NOT the service role / secret key)

Do not commit `.env` files or the service role key. `.gitignore` ignores
`.env*` and common key filenames.

## 6. Update index.html

Open `index.html` in this repo and replace these two placeholders near
the top of the `<script>` block if you are pointing a new project at the
app:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_PUBLISHABLE_KEY = 'YOUR_SUPABASE_PUBLISHABLE_KEY';
```

with that project's URL and publishable key only. Commit and push -
GitHub Pages will pick up the change automatically.

The page sends `noindex` and `robots.txt` asks crawlers not to index the
app. GitHub Pages does not apply custom response headers such as
`X-Robots-Tag`; `_headers` is there for hosts that support it. Prefer
keeping the GitHub repository private as well.
