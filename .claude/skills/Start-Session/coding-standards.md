# Darling's Auto Group - Coding Standards

Quick reference for all development projects.

---

## Priority Order

1. **Security** — Always #1, never compromised
2. **Maintainability** — Clean, readable, documented
3. **Performance** — Optimize where it matters
4. **Features** — Only after the above are satisfied

---

## Hard Rules

### 🔒 Security
- [ ] No secrets in code (use environment variables)
- [ ] Validate all user inputs
- [ ] Use parameterized database queries
- [ ] Implement proper authentication checks
- [ ] Review for OWASP top 10 vulnerabilities

### 📏 File Size Limits
- **Maximum:** 1,000 lines per file
- **Warning threshold:** 800 lines
- **Action:** Split into modules before hitting limit

### 🧹 Code Hygiene
- [ ] No commented-out code blocks
- [ ] No unused imports
- [ ] No dead code paths
- [ ] No "temporary" code left behind
- [ ] No duplicate functionality

### 📖 Documentation
- [ ] CLAUDE.md is current
- [ ] Architecture diagram is accurate
- [ ] API endpoints are documented
- [ ] Deployment commands work
- [ ] Troubleshooting section is helpful

---

## Code Style

### Naming
- **Variables/Functions:** camelCase
- **Classes/Components:** PascalCase
- **Constants:** UPPER_SNAKE_CASE
- **Files:** kebab-case.ts or PascalCase.tsx

### Comments
- ✅ Explain "why" for complex logic
- ❌ Don't explain "what" (code should be self-documenting)
- ❌ Don't leave TODO comments indefinitely

### Structure
- One component/class per file
- Group related functionality
- Separate concerns (UI, logic, data)
- Keep functions small and focused

---

## Before Every Commit

```bash
# Check for large files
find . -name "*.ts" -o -name "*.js" | xargs wc -l | sort -n | tail -10

# Check for console.logs (remove before commit)
grep -r "console.log" src/

# Check git status
git status
```

---

## Red Flags to Watch For

⚠️ **Stop and refactor if you see:**
- File approaching 800+ lines
- Copy-pasted code blocks
- Deeply nested conditionals (>3 levels)
- Functions with more than 5 parameters
- Components doing too many things
- Hardcoded values that should be config

---

*These standards exist to keep our codebase healthy and our team productive.*
