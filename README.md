# Post Planner

Static front end plus three small Vercel functions. The Apps Script web app and the Google Sheet stay as the data layer.

## Deploy

1. **Apps Script.** Paste `Code.gs` over your current code and save. Then Deploy > Manage deployments > pencil icon > Version: New version > Deploy. The `/exec` URL stays the same. Check that the `API_KEY` script property holds your new key.
2. **Vercel.** In this folder run `npx vercel`. In the project's Settings > Environment Variables add these four, then run `npx vercel --prod`:

   | Name | Value |
   |---|---|
   | `APPS_SCRIPT_URL` | the Apps Script `/exec` URL |
   | `API_KEY` | the same value as the `API_KEY` script property |
   | `APP_PASSWORD` | the password you type to open the app |
   | `SESSION_SECRET` | a long random string (`openssl rand -hex 32`) |

3. Open the site and sign in with `APP_PASSWORD`.

The API key and the Apps Script URL never reach the browser. `APP_PASSWORD` is what keeps strangers out of your scheduler, since the site address is public.

## Test locally

Copy `.env.example` to `.env.local`, fill it in, run `npx vercel dev` and open http://localhost:3000.

## Notes

- All times are IST. The sheet stores them as `yyyy-MM-dd HH:mm`.
- Connect LinkedIn opens in a new tab. The LinkedIn redirect URL stays the Apps Script `/exec` address.
- Images come from a Google Drive link. The Apps Script runs as you, so it can read your own files.
- Bold, italic, underline and the other styles are Unicode lookalike characters, because LinkedIn has no rich text.
