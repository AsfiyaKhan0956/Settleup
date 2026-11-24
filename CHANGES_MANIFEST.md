# SettleUp changes manifest

Baseline: settleup-backup.zip. Original archive entries were compared with working files by SHA-256.

Audit result: 14 modified files, 8 new files, 0 deleted files. The separately supplied unchanged wrangler.jsonc and original ZIP are excluded.

## Modified files

- cloudflare/group.ts — Implements guest sessions, read-only guest views, identity conversion, and compatible invitations.
- cloudflare/security.ts — Uses the scrypt-js default import while preserving existing password-hash behavior.
- package.json — Adds the Cloudflare invitation and migration tests to the local test command.
- README.md — Documents the guest and send-only Apps Script invitation integration.
- server/db.ts — Adds local SQLite schema parity for guest identities and email request tracking.
- server/routes/groups.ts — Adds Express parity for guest identity and signed invitation email delivery.
- SETUP_GUIDE.md — Adds manual setup guidance for the email integration.
- src/App.tsx — Connects guest identity conversion to successful account authentication.
- src/components/groups/GroupsView.tsx — Routes group-creation email invitations through the send-only integration.
- src/components/groups/GroupWorkspaceView.tsx — Updates invitation UI for delivery status and nullable invitation URLs.
- src/components/groups/GuestGroupView.tsx — Adds guest name/join flow and read-only guest actions.
- src/components/public/PublicPages.tsx — Updates public guest invitation copy and account actions.
- src/types/index.ts — Adds guest-member and nullable invitation URL types.
- worker.ts — Adds Worker configuration bindings and safe top-level error handling.

## New files

- apps-script/appsscript.json — Declares the Apps Script runtime and send-only mail scope.
- apps-script/SettleUpMailer.gs — Implements signed-request validation, nonce replay protection, idempotency, and MailApp-only sending.
- cloudflare/emailInvitations.ts — Implements authenticated, rate-limited, signed email invitation dispatch.
- docs/CLOUDFLARE_GUEST_EMAIL_SETUP.md — Documents manual configuration, migration, Apps Script setup, and guest conversion.
- migrations/0002_guest_identity.sql — Adds guest identity storage without rebuilding registered membership data.
- migrations/0003_email_invite_delivery.sql — Adds durable email request idempotency and per-account usage records.
- tests/cloudflare-invitations.test.ts — Adds invitation, guest security, email failure, send-only scope, and nonce checks.
- tests/cloudflare-migrations.test.ts — Checks additive migration preservation and foreign-key integrity using in-memory SQLite.

## SHA-256 comparison

| Path | Status | Original SHA-256 | Packaged SHA-256 |
|---|---|---|---|
| apps-script/appsscript.json | New | — | 709E29D7C38A59A7DE99FC075B59CCD8EC2EE1674B88CBEA72D15F7E1090EA5E |
| apps-script/SettleUpMailer.gs | New | — | BB50A8BB5A1AF9040CD3847F555A39E02EA6A117B50F7215B10FDB33E8AD6CA4 |
| cloudflare/emailInvitations.ts | New | — | 01D87C2A8A6589BAA298D5D0C4F0798A629B44F532F755530B5EC40E74DB33D5 |
| cloudflare/group.ts | Modified | E7F9E0729FB1ADB948E0BA4C3550C21387F2B9EAF229AACC6F7ABCDAF40FDEB4 | 0D6C84C62A07887770623009C8640192963BE8970EB3AFB69B3F5E7B013DBE83 |
| cloudflare/security.ts | Modified | 3E426442A03706DAE4150EB5A1DFEC645C53F65BADB6BAFE956038FB8224DD67 | CC10B59A777C11A8909F96E631A373D5C05A582A3AE1AFACB4668BE249786E5A |
| docs/CLOUDFLARE_GUEST_EMAIL_SETUP.md | New | — | 878FCA45460050CA80941ABEBC57DE0F6700BFD270AAA8E307852115B423307D |
| migrations/0002_guest_identity.sql | New | — | 2082BFF6D135A1D8B1E877BB344DAA0F817A10C197EB22D02D1550E55E7CED00 |
| migrations/0003_email_invite_delivery.sql | New | — | 6D9A88BA7C4FF78DAE26DC52F26953A3416F1185140ADED1F76BBAA565C1198B |
| package.json | Modified | A59172D644C980317FE4C18222AB8FCEE0A5E6D18CEAFB8913B946033C60D7F9 | 49614F0C1DBC3AFB2993FA9CF04F870C93FBE3F7BD963985328CE62FDE165D54 |
| README.md | Modified | C06447A6CBB69AFD789213025C6753BB060592D761432EEA0FAB5811089ED132 | CC88E60213365AE43DA0991982340728A0BE5FAEA56770AA7C3D4CF600E60DA0 |
| server/db.ts | Modified | 7E4A5826E322FF32EEE8CEB350630080B172E78CFB5C835D4A2D0EDEB8AC0770 | B1FD0EDC6141E119B6AFCA0BB7B930061D7C2A62361262796EE00558E1D79A02 |
| server/routes/groups.ts | Modified | 67303029FDEACBDFF447BF3CD188E7C98F7F8DDB3A0171ED1710A7AB43F36E21 | 06171A4B7EA6C8217BB1DDD8006CAD31B829BDC79479CA3A519FBB3A7429E581 |
| SETUP_GUIDE.md | Modified | 57BE838504460CA6454719FE9361BFDC5578624C38CD3E6F6D6E1DD0712DFA58 | 77476170CD16E0607DC4C5E206F3E218DDF433A8DCEE501ED9AC8CB0F05A4E66 |
| src/App.tsx | Modified | 78F676D6835AE6F4C6B542730C2971E7F26157DC7531C86B5B17516F6D849BF5 | F81E1CC5139CE970A63374BE6CB7300370D66ED36CC3DD3E1F159DB4B1DC7493 |
| src/components/groups/GroupsView.tsx | Modified | 1DFB0AC5C2BF074F676DAA87F04990A4D8FAC8C656BD508A353B4D73972CA61B | 5AE08F5D0F18D6799A43CB9F8964D6E444BCD6F59B912889BA2EF91235DF8007 |
| src/components/groups/GroupWorkspaceView.tsx | Modified | 4AC4F41032D4F72E216A8F06ACC600A3B64526226E51A664B5DAE0E186194BAE | 629464D85C71C6F80D60C8B679379E91C0CF8DCD907184B6732D9141FD10E497 |
| src/components/groups/GuestGroupView.tsx | Modified | 7D15B236A2D38E3DC8A87B5236D30766FED370D0A6E6B15A99A52A40E98E1DA3 | 19C19194E229B628B4AE31937F1AE73AF34073B4735913EB88F17D838E417141 |
| src/components/public/PublicPages.tsx | Modified | 2349A8FA9DA0AF1701555A468C04F112554D99CE879F486CB1CD7A8FB947FF93 | C192FC60BC35CE146C0FCBF219E709B82449DC985192870772560BE709D0F2F1 |
| src/types/index.ts | Modified | 732798B793AD6E74BCA66B14543F8D390E0848698E2E64E20B5EA2DA3D2C2B4C | 727BAF61A7C1A6F0725561B9348125CD9858C117EB36C595D92CCDAC8330D3E8 |
| tests/cloudflare-invitations.test.ts | New | — | 667AF3939AE7B2D59D0E70608E469F5ED0AC9F9A76CF5417D351822AA1701093 |
| tests/cloudflare-migrations.test.ts | New | — | 584A083FED9812B596A6D2F4468203777B6EFFC72A9AA585D35CF5888C9542F5 |
| worker.ts | Modified | 819FE70788022DB4DDBD2F4046ED95F79BCF8F95C8A99576796BB52360FBB4C5 | 184A2AF9A64AECAD25BC35DBD543684035179379A6DCE7C023F7C9217F742BBC |

## Deletions

No original ZIP files were deleted; no separate deletion manifest is needed.