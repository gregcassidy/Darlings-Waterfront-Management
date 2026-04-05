---
name: end-session
description: End a Claude Code coding session by creating a session summary document and committing all changes. Use when user says "end session", "finish session", "wrap up", "done for today", or wants to save and document their work before stopping.
---

# End Session Skill

Properly conclude a Claude Code coding session by documenting what was accomplished and committing all changes to git.

## Workflow

When the user invokes this skill, execute these steps in order:

### Step 1: Generate Session Summary

Create a markdown file summarizing the session.

**File location:** `docs/Session_Notes_YYYY-MM-DD.md`

**Get current date:**
```bash
date +%Y-%m-%d
```

**If a session notes file already exists for today**, append a counter: `Session_Notes_2024-12-16_2.md`

### Step 2: Write Session Summary Content

Create the session notes file with this structure:

```markdown
# Session Notes - [DATE]

## Summary
[2-3 sentence overview of what was accomplished this session]

## Changes Made
- [List each significant change, feature added, or bug fixed]
- [Be specific: "Added user authentication flow" not just "worked on auth"]
- [Include file names where helpful]

## Files Modified
- `path/to/file1.ts` - [brief description of changes]
- `path/to/file2.js` - [brief description of changes]

## Current Status
[Where does the project stand? What's working, what's in progress?]

## Next Steps
- [ ] [Task to pick up next session]
- [ ] [Another pending task]
- [ ] [Any blockers or questions to resolve]

## Notes
[Any additional context, decisions made, or things to remember]
```

**Content Guidelines:**
- Review the conversation history to identify what was worked on
- Be specific and actionable in "Next Steps"
- Keep it concise but complete enough to resume easily
- Include any important decisions or trade-offs made

### Step 3: Stage All Changes

```bash
git add -A
```

### Step 4: Commit Changes

Create a descriptive commit message summarizing the session:

```bash
git commit -m "Session [DATE]: [brief summary of main accomplishment]"
```

**Commit message examples:**
- `Session 2024-12-16: Add user authentication with Azure AD`
- `Session 2024-12-16: Fix dashboard loading performance`
- `Session 2024-12-16: Initial project setup and PRD creation`

### Step 5: Push Changes (Optional)

Ask the user if they want to push:

"Changes committed. Would you like me to push to the remote repository?"

If yes:
```bash
git push origin [current-branch]
```

### Step 6: Confirm Completion

Provide a brief confirmation:

```
✅ Session ended successfully!

📝 Session notes saved: docs/Session_Notes_2024-12-16.md
💾 Changes committed: "Session 2024-12-16: [summary]"
🚀 Pushed to: origin/main (if pushed)

See you next time!
```

## Handling Edge Cases

### No Changes to Commit
If `git status` shows no changes:
- Still create the session notes documenting what was discussed/planned
- Skip the commit step
- Inform user: "No code changes to commit, but session notes have been saved."

### Uncommitted Changes from Before Session
If there are pre-existing uncommitted changes:
- Ask user: "There are uncommitted changes from before this session. Should I include them in this commit, or would you like to commit them separately first?"

### Git Not Initialized
If the project doesn't have git:
```bash
git init
git add -A
git commit -m "Initial commit"
```

### Merge Conflicts on Push
If push fails due to conflicts:
- Inform user of the conflict
- Suggest: "There are remote changes. Would you like me to pull and merge first?"

## Important Notes

- Always create session notes, even for short sessions
- The docs folder should be created if it doesn't exist: `mkdir -p docs`
- Session notes help maintain continuity between coding sessions
- Commit messages should be meaningful, not generic
