# Google Cloud setup

The app signs people in with Google and, if you want, writes bookings into
Google Calendar. Both need a Google Cloud project with an OAuth client. This
takes about fifteen minutes and is the same for a laptop and for the server;
only the addresses differ.

You need a Google account. The project can belong to any account; it does not
have to be one that signs in to the app.

## Contents

1. [Create a project](#1-create-a-project)
2. [Turn on the Google Calendar API](#2-turn-on-the-google-calendar-api)
3. [Configure the consent screen](#3-configure-the-consent-screen)
4. [Choose who may use it](#4-choose-who-may-use-it)
5. [Declare the calendar permission](#5-declare-the-calendar-permission)
6. [Create the OAuth client](#6-create-the-oauth-client)
7. [Put the values into `.env`](#7-put-the-values-into-env)
8. [Check it](#8-check-it)
9. [When something goes wrong](#9-when-something-goes-wrong)

Google renames menu entries now and then. The consent screen settings live
under **Google Auth Platform** (older consoles: **APIs & Services → OAuth
consent screen**); if a name below does not match, the search bar at the top
of the console finds the page.

## 1. Create a project

1. Open the [Google Cloud console](https://console.cloud.google.com/).
2. Click the project picker at the top left, then **New project**.
3. Name it, for example `vacation-home`, and click **Create**.
4. Make sure the new project is selected in the picker before going on.

No billing account is needed: sign-in and the Calendar API are free at this
app's scale.

## 2. Turn on the Google Calendar API

Skip this if you only want Google sign-in and no calendar sync.

1. **APIs & Services → Library**.
2. Search for **Google Calendar API**, open it, click **Enable**.

## 3. Configure the consent screen

This is what people see when Google asks whether they allow the app in.

1. Open **Google Auth Platform** and click **Get started**.
2. **App information**: an app name (shown on Google's consent screen, e.g.
   "Vacation Home") and a support email (yours).
3. **Audience**: choose **External**. ("Internal" only exists for Google
   Workspace organisations and only admits accounts of that organisation.)
4. **Contact information**: your email address.
5. Agree to the user data policy and click **Create**.

## 4. Choose who may use it

Under **Google Auth Platform → Audience** the app has a publishing status.
Which one to use depends on whether you sync with Google Calendar.

**Testing** (the start): only the Google accounts listed as **test users**
can sign in. Add every account that should use the app under **Test users →
Add users**. This is enough for sign-in alone.

But in Testing, Google lets the calendar permission **expire after 7 days**:
the sync then stops, and settings show Google Calendar as disconnected, every
week. So if you use calendar sync, publish the app:

**In production**: click **Publish app**. Google does not review an app
this small; instead, when someone grants the calendar permission, Google
shows a warning that it has not verified the app. Click **Advanced → Go to
… (unsafe)** to continue: it is your own app. Up to 100 accounts may use an
unverified app, far more than this one needs.

Either way, the app itself only lets in the addresses in
`AUTH_ALLOWED_EMAILS` (step 7). Publishing does not open it to anyone else.

## 5. Declare the calendar permission

Skip this without calendar sync.

1. **Google Auth Platform → Data access → Add or remove scopes**.
2. Find `https://www.googleapis.com/auth/calendar` (Google Calendar API, "See,
   edit, share and permanently delete all the calendars you can access using
   Google Calendar"), tick it, click **Update**, then **Save**.

Sign-in asks for name and email only. The calendar permission is asked for
separately, when you click **Connect Google Calendar** in the app's settings,
so signing in never hands over your calendar.

## 6. Create the OAuth client

1. **Google Auth Platform → Clients → Create client**.
2. **Application type**: **Web application**. Name it, e.g. `vacation-home`.
3. **Authorised redirect URIs**: add both of these for every address the app
   runs at. `APP_URL` is the address you open the app at, without a trailing
   slash:

   | Where            | Redirect URIs                                                                                                 |
   | ---------------- | ------------------------------------------------------------------------------------------------------------- |
   | On your computer | `http://localhost:3000/api/auth/callback/google`<br>`http://localhost:3000/api/google/callback`               |
   | On the server    | `https://vacation.example.com/api/auth/callback/google`<br>`https://vacation.example.com/api/google/callback` |

   One client can hold both, so the same client works for development and
   production. Google accepts `http://` only for `localhost`; a LAN address
   such as `http://192.168.178.50:3000` is refused, which is why the
   deployment guide offers https on your own domain or an SSH tunnel to
   `localhost`.

4. **Authorised JavaScript origins** can stay empty.
5. Click **Create**. Copy the **Client ID** and **Client secret** now: the
   secret is shown in full only once (you can add a new one later).

## 7. Put the values into `.env`

In the app's `.env` (copied from [`.env.example`](../.env.example)):

```bash
AUTH_GOOGLE_ID="1234567890-abc.apps.googleusercontent.com"   # the Client ID
AUTH_GOOGLE_SECRET="GOCSPX-..."                               # the Client secret
AUTH_ALLOWED_EMAILS="you@gmail.com,partner@gmail.com"         # who may sign in
APP_URL="http://localhost:3000"                               # where you open the app
```

For calendar sync, the app also needs a key to encrypt Google's tokens at
rest. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # prints a random key
```

and put it into `TOKEN_ENCRYPTION_KEY`. Without it, sign-in works but
Settings has no Google Calendar section. Keep a copy somewhere safe: with
a new key the stored Google access can no longer be read, and you have to
connect again.

Restart the app after changing `.env`.

## 8. Check it

1. Open the app and click **Sign in with Google**. Choose an account from
   `AUTH_ALLOWED_EMAILS` (and from the test users, while in Testing).
2. In the app, open **Settings → Google Calendar → Connect Google Calendar**,
   allow access (past the "unverified" warning, if published), and come back
   to "Google Calendar is connected."
3. Pick a calendar for a property and click **Start syncing**. Its confirmed
   bookings appear in that Google calendar shortly after.

## 9. When something goes wrong

| What you see                                                                  | Why, and what to do                                                                                                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Google: "Error 400: redirect_uri_mismatch"                                    | The address is not among the redirect URIs (step 6). Compare it with `APP_URL` letter by letter: `http` vs `https`, port, trailing `/`. |
| Google: "Access blocked: … has not completed the Google verification process" | The app is in Testing and this account is not a test user (step 4).                                                                     |
| The app: "That Google account isn't allowed to use this app."                 | The address is not in `AUTH_ALLOWED_EMAILS`.                                                                                            |
| Settings: "the calendar permission was not granted"                           | The calendar box on Google's consent screen was unticked. Connect again and leave it ticked.                                            |
| Settings: Google Calendar disconnected, about a week after connecting         | The app is still in Testing (step 4): publish it, then connect again.                                                                   |
| Settings: "The server's encryption key changed"                               | `TOKEN_ENCRYPTION_KEY` changed. Connect again, or put the old key back.                                                                 |
| No Google Calendar section in Settings                                        | `TOKEN_ENCRYPTION_KEY` is empty (step 7).                                                                                               |

How the sync decides between the app and Google when both change:
[calendar-sync.md](calendar-sync.md). The server setup, including push
notifications from Google: [deployment.md](deployment.md).
