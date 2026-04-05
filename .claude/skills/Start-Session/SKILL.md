---
name: start-session
description: Begin a Claude Code coding session by loading project context and previous session notes. Use when user says "start session", "begin session", "let's get started", "resume work", or at the beginning of any coding session. Loads CLAUDE.md, recent session notes, and reminds Claude of Darling's coding standards.
---

# Start Session Skill

Properly begin a Claude Code coding session by loading context and establishing priorities.

## Workflow

When the user invokes this skill, execute these steps in order:

### Step 1: Read CLAUDE.md

First, load the project's developer guide:

```bash
cat CLAUDE.md
```

If CLAUDE.md doesn't exist, inform the user:
"No CLAUDE.md found. Consider running the start-project skill first, or let me create one for you."

### Step 2: Read Most Recent Session Notes

Find and read the most recent session notes:

```bash
ls -t docs/Session_Notes_*.md 2>/dev/null | head -1
```

If found, read the file and summarize:
- What was accomplished last session
- Current project status
- Next steps that were planned

If no session notes exist:
"No previous session notes found. This appears to be a new project or first session."

### Step 3: Acknowledge Darling's Coding Standards

Confirm understanding of these mandatory rules:

---

## ⚠️ DARLING'S CODING STANDARDS ⚠️

**I understand and will follow these rules throughout this session:**

### 🔒 1. SECURITY IS #1 PRIORITY
- Never expose secrets, API keys, or credentials in code
- Validate all user inputs
- Use parameterized queries for database operations
- Follow Azure AD authentication patterns
- Review code for security vulnerabilities before committing

### 📏 2. NO FILES OVER 1,000 LINES
- If a file approaches 1,000 lines, it MUST be split
- Break large files into logical modules/components
- Each file should have a single, clear responsibility
- Refactor proactively, not reactively

### 🧹 3. REMOVE UNUSED CODE IMMEDIATELY
- Delete commented-out code blocks
- Remove unused imports and variables
- Clean up dead code paths
- Don't keep "just in case" code — git has history

### 📖 4. KEEP CLAUDE.md UPDATED
- Update after any architectural changes
- Keep the Quick Reference table current
- Update file structure documentation
- Maintain accurate deployment commands
- **Keep the architecture diagram current**

### 🗺️ 5. MAINTAIN PROJECT UNDERSTANDING
- Keep architecture diagram in CLAUDE.md accurate
- Document data flow and component relationships
- Update API endpoint documentation
- Ensure troubleshooting section stays relevant

### ✨ 6. CLEAN, MAINTAINABLE CODE
- Write self-documenting code with clear naming
- Add comments for complex logic only
- Follow consistent formatting and patterns
- Prefer readability over cleverness

---

### Step 4: Provide Session Context Summary

After loading context, provide a brief summary to the user:

```
✅ Session started!

📖 Loaded: CLAUDE.md
📝 Last session: [DATE] - [brief summary of what was done]

📋 Planned next steps from last session:
- [ ] [task 1]
- [ ] [task 2]

⚠️ Coding standards active:
• Security first
• Max 1,000 lines per file  
• Remove unused code
• Keep CLAUDE.md updated

What would you like to work on today?
```

### Step 5: Check for Uncommitted Changes

```bash
git status --short
```

If there are uncommitted changes, alert the user:
"⚠️ Note: There are uncommitted changes from a previous session. Would you like to review them before continuing?"

## Handling Edge Cases

### No CLAUDE.md Found
Offer to create one:
"No CLAUDE.md found. Would you like me to create a developer guide for this project?"

### No Session Notes Found
This is fine for new projects:
"No previous session notes found. Let's establish the current state of the project. Can you give me a quick overview of what we're building?"

### Multiple Session Notes Same Day
Read the most recent one (highest counter if multiple exist for same date).

### Project Structure Unclear
If CLAUDE.md is outdated or missing key information:
"The project documentation may be outdated. As we work today, I'll help update CLAUDE.md to reflect the current state."

## Periodic Reminders

Throughout the session, Claude should:

- **Before creating a new file:** Check if similar functionality exists elsewhere
- **When a file exceeds ~800 lines:** Proactively suggest splitting it
- **After significant changes:** Ask "Should we update CLAUDE.md to reflect this?"
- **Before committing:** Review for unused code and security issues
- **When modifying architecture:** Update the diagram in CLAUDE.md

## Quick Reference: File Size Check

To check for files approaching the limit:
```bash
find . -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" | xargs wc -l | sort -n | tail -20
```

Flag any files over 800 lines as candidates for refactoring.
