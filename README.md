# Torn Mug Marks Tracker 1.0.0

1. Create a **new blank Google Sheet**, then open Extensions > Apps Script and paste `Code.gs`.
2. Run `setup` once and approve the requested spreadsheet permission.
3. In Apps Script > Project Settings > Script properties, create `WRITE_TOKEN` with a long random secret (at least 32 characters). Do not share it.
4. Deploy > New deployment > Web app, Execute as **Me**, Access **Anyone**. Copy the `/exec` URL. This makes the endpoint publicly reachable, but writes require the secret. Google Apps Script web app requests may be subject to redirects and cross-origin limitations; verify on your device.
5. Install the userscript and enter the web app URL and token in its Settings panel. The script stores these locally in userscript storage.
6. Use **Save Target** on a Torn profile, and **Log Mug** to manually record verified outcomes. No attacks are automated.

**Security:** The write token authorizes updates to this spreadsheet. Treat it as a password. Deploying as 'Anyone' exposes the endpoint to internet traffic; token verification protects writes but cannot prevent traffic to the endpoint. Do not publish the token. Rotate it if exposed. No Torn API key is needed for this initial version.

**Limitations:** No live Torn API profile enrichment, no automatic mug-log interception, and no Google Sheet read-back in v1. The script writes only on explicit user action. The 15-hour cooldown is a user-configurable hypothesis. The spreadsheet is the source of truth; browser state is not synchronized back from Sheets. For an existing Claude workbook, preserve it separately; do not paste the Apps Script into it without migrating the tab schema.
