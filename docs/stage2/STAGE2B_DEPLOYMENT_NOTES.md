# Stage 2B: deployment notes (nothing has been deployed)

Do not run any command below without explicit approval. There is **no secret to create** and **no API key**. Never run a bare `firebase deploy` (it would also publish Storage rules); always pass `--project xploresoweto` and an explicit `--only`.

Stage 2A functions were never deployed, so there is nothing to remove from production.

Order, each step after approval:

1. Index (needed by the conversation list): `firebase deploy --only firestore:indexes --project xploresoweto`
2. Rules (explicit deny blocks for the AI collections; the file also contains Stage 1 rules, so publishing it publishes both): `firebase deploy --only firestore:rules --project xploresoweto`
3. Functions, AI only: `firebase deploy --only functions:aiChat,functions:aiGetUsage,functions:aiListConversations,functions:aiGetConversation,functions:aiDeleteConversation,functions:aiDeleteAllMyAiData,functions:aiAdminGetUsage,functions:aiAdminUpdateConfig --project xploresoweto`
4. Optional TTL retention backup (confirm your database id): `gcloud firestore fields ttls update expireAt --collection-group=ai-conversations --enable-ttl --project=xploresoweto --database="(default)"`, and the same for `messages` and `ai-usage`.

Controls afterwards: kill switch `aiAdminUpdateConfig {patch:{enabled:false}}`; limits and caps are adjustable the same way, validated and audited. Rollback: `firebase functions:delete <name> --region africa-south1 --project xploresoweto`.

Before enabling for real users: review answers against real CMS data on a staging project, and decide the open questions listed in the Stage 2B final report.
