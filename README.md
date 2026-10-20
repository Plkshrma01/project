# AutoSetu — GitHub Pages + Supabase starter

This is a static website starter for AutoSetu. It starts at the login/signup page. After authentication, users are routed to the passenger or driver dashboard based on their saved role.

## Included
- Supabase email/password signup and login
- Role selection at signup (passenger or driver)
- Profile row created by a database trigger
- Passenger ride-request flow
- Driver online/offline and ride status controls
- Carpool listing and search basics
- Leaflet map with OpenStreetMap tiles
- Row Level Security (RLS) policies for core tables
- GitHub Pages deployment instructions

## Important scope
This is a working MVP foundation, not a production ride-hailing service. Real-time GPS tracking, SMS/phone verification, payments, push notifications, admin controls, and AI using a private model API require additional backend setup and testing. The map is a map UI; do not treat its sample marker as a verified live driver location.

## 1. Set up Supabase
1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run `supabase/schema.sql` once on a new project. If you already have tables from an earlier AutoSetu setup, back up the project and inspect/merge the SQL instead of blindly rerunning it.
4. In **Project Settings → API**, copy the Project URL and the publishable/anon public key.
5. Edit `js/config.js` and replace the two placeholder values.
   - Only use the publishable/anon key in browser code.
   - NEVER put the `service_role` key in this repository.

## 2. Configure authentication URLs
In Supabase **Authentication → URL Configuration**:
- Site URL: your GitHub Pages site URL, for example `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`
- Add that same URL to Redirect URLs.
- For local testing, also add `http://localhost:5500/` if you use VS Code Live Server.

If email confirmation is enabled, signup may show a message asking the user to confirm their email. The user cannot sign in until confirmation is complete. For a college demo, you can change the email confirmation setting in Supabase Auth settings, but for a real service keep verification enabled.

## 3. Deploy to GitHub Pages
1. Upload the contents of this folder to the root of your GitHub repository (the `index.html` file must be at repository root).
2. Go to **Settings → Pages**.
3. Choose **Deploy from a branch**, select `main` and `/ (root)`, then Save.
4. Wait for the Pages URL to appear.
5. Add that exact URL to Supabase Auth URL Configuration.
6. Open the site and test signup using a new email address.

## 4. If signup/login fails
1. Open the website, press F12, and open **Console**.
2. Open **Network**, retry signup, and inspect the failing `/auth/v1/signup` or `/auth/v1/token?grant_type=password` request.
3. Check Supabase **Authentication → Logs**.
4. Check that `js/config.js` contains the correct project URL and public key.
5. Check that the URL is the project URL (not the dashboard URL).
6. Confirm that the email is verified if confirmation is enabled.
7. If the console says `Invalid API key`, the key is wrong or from another project. If it says `Email not confirmed`, verify the email. If it says a profile trigger failed, inspect the SQL trigger and Supabase logs.

## 5. Security notes
- Never use the service-role key in frontend code.
- Do not rely on hidden buttons for access control; database access is protected by RLS.
- Admin features are intentionally not granted to ordinary users. Build a secure admin backend before adding them.
- Before a real launch, have the schema and RLS policies reviewed and test access using two separate accounts.
