# Contributing

This repository is a static site (AETHER). `main` is protected: every change,
including from the owner, must land through a pull request. Direct pushes to
`main` are rejected.

## Flow

1. **Branch from an up-to-date `main`.**
   ```bash
   git fetch origin
   git checkout -b <type>/<short-topic> origin/main
   ```
   Use a conventional prefix such as `feat/`, `fix/`, `chore/`, or `docs/`.

2. **Make your change.** Keep it scoped, and do not commit secrets. Local link
   state such as `.vercel/` and `.env*` is gitignored.

3. **Push and open a PR.**
   ```bash
   git push -u origin <branch>
   gh pr create --fill
   ```
   Fill in the PR template (Summary / Changes / Testing / Checklist).

4. **CI must pass.** The required check is **`Headless smoke test`** (workflow
   `CI`). It serves the repo over HTTP and runs a Playwright smoke test that
   asserts zero console/page errors, a live render loop, and a non-blank first
   frame. Find it at **Actions → CI**, or locally:
   ```bash
   npm init -y
   npm install playwright@1.48.0
   npx playwright install --with-deps chromium
   node scripts/smoke-test.mjs
   ```

5. **Squash-merge.** `main` enforces a linear history, so merge commits are not
   allowed:
   ```bash
   gh pr merge <number> --squash --delete-branch
   ```

   Pushing an update to the merged branch is fine, but keep `main` linear.

## Protected-branch rules

`main` requires:

- a pull request (no approving review required on this solo repo);
- the `Headless smoke test` status check, against an up-to-date branch;
- linear history, no force-pushes, no deletions;
- rules enforced for administrators too.

Because admin enforcement is on, even the owner cannot push directly to `main`.
For a genuine emergency, temporarily relax the branch protection in
**Settings → Branches**, push the fix, and re-enable it immediately.
