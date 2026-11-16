XploreSoweto Stage 1: how to apply (nothing here deploys anything)

Base: your main must be at commit 14675c1 ("updated splash").
1. cd D:\xploresoweto2 ; git status   (must be clean: commit or stash your own work first)
2. git checkout -b stage1/firebase-transition
3. git am --3way path\to\this\folder\*.patch        (10 commits, applied in order)
   (alternative: git fetch path\to\stage1.bundle stage1/firebase-transition:stage1/firebase-transition)
4. cd functions ; npm install ; npm test            (expect: 93 pass)
5. cd .. ; npm --prefix security-rules install ; npm --prefix security-rules run lint
6. Run the emulator rules tests (needs Java + firebase-tools): npm --prefix security-rules test
7. Read docs\stage1\STAGE1_REPORT.md, then follow the device checklist in docs\stage1\TESTING.md
Do NOT deploy functions or rules until the emulator tests have been reviewed and you have approved.
