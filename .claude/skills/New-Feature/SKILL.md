---
name: new-feature
description: Plan and implement a new feature using a structured approach. Use when user says "new feature", "add feature", "build feature", "implement feature", or wants to add new functionality to an existing application. Enters planning mode first, creates a feature spec, identifies reusable components, then implements incrementally while tracking progress.
---

# New Feature Skill

Add new features to existing applications using a structured, reuse-first approach.

## Core Principles

Before any implementation:

1. **🔍 Reuse First** — Find existing components, patterns, and code to leverage
2. **🎨 UI Consistency** — Match the existing look and feel exactly
3. **📦 Modular Structure** — Keep new code organized and self-contained
4. **🛡️ Security First** — Follow all Darling's coding standards
5. **📏 Simple Approach** — Find the simplest path that solves the problem

---

## Workflow

### Phase 1: Discovery (Ask Questions)

Ask these questions in conversational batches (2-3 at a time):

**Understanding the Feature:**
- What is the feature? Describe it in one sentence.
- What problem does this solve? Who benefits?
- What's the expected user flow? (Step by step, what does the user do?)

**Scope & Priority:**
- Is this a must-have or nice-to-have?
- Are there any deadline constraints?
- What's the minimum viable version of this feature?

**Technical Context:**
- Which existing pages/sections is this related to?
- Does this need new data/tables, or can we use existing ones?
- Does this need new API endpoints?
- Are there any similar features in the app we can model this after?

---

### Phase 2: Codebase Analysis

Before planning, analyze the existing codebase:

**1. Read CLAUDE.md for project context:**
```bash
cat CLAUDE.md
```

**2. Review existing file structure:**
```bash
find . -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" | head -50
```

**3. Identify reusable components:**
```bash
# Check existing UI components
ls -la public/js/ 2>/dev/null || ls -la src/components/ 2>/dev/null

# Check existing styles
cat public/css/styles.css 2>/dev/null | head -100
```

**4. Check for similar patterns:**
Look for existing features that are similar to what we're building. Note:
- How are list views structured?
- How are modals/forms handled?
- How are API calls made?
- What UI patterns are used (cards, tables, tabs)?

**5. Check existing Lambda functions for patterns:**
```bash
ls infrastructure/lambda/functions/
```

---

### Phase 3: Create Feature Plan

Create `docs/New_Feature_[FeatureName].md`:

```markdown
# Feature: [Feature Name]

## Overview
**One-liner:** [What this feature does]
**User:** [Who uses it]
**Trigger:** [User says "new feature" or similar]

## User Story
As a [role], I want to [action] so that [benefit].

## User Flow
1. User navigates to [location]
2. User clicks [button/link]
3. System displays [what]
4. User [action]
5. System [response]

## Implementation Plan

### Reusable Components Identified
| Component | Location | How We'll Use It |
|-----------|----------|------------------|
| [Component] | `path/to/file.js` | [How it applies] |
| [Style class] | `styles.css` | [How it applies] |
| [API pattern] | `path/to/lambda.ts` | [How it applies] |

### New Code Required
| Type | File | Description |
|------|------|-------------|
| Frontend | `public/js/[feature].js` | [What it does] |
| Lambda | `lambda/functions/[feature]/` | [What it does] |
| Database | `[Table name]` | [Schema if new] |

### Files to Modify
| File | Changes |
|------|---------|
| `public/index.html` | Add navigation link, section |
| `infrastructure/lib/api-stack.ts` | Add new endpoints |
| `CLAUDE.md` | Update docs |

## Progress Tracker
- [ ] **Phase 1:** Setup - Add HTML section, navigation
- [ ] **Phase 2:** Backend - Create Lambda functions, API routes
- [ ] **Phase 3:** Frontend - Implement UI logic
- [ ] **Phase 4:** Integration - Connect frontend to API
- [ ] **Phase 5:** Polish - Error handling, loading states
- [ ] **Phase 6:** Documentation - Update CLAUDE.md

## Technical Notes
[Any important decisions, constraints, or considerations]

## Security Checklist
- [ ] Input validation on all user inputs
- [ ] Proper authentication checks in Lambda
- [ ] No sensitive data exposed to frontend
- [ ] Role-based access control if needed
```

---

### Phase 4: Implementation

**STOP and confirm the plan with the user before implementing.**

"Here's my plan for the [Feature Name] feature. I've identified [X] reusable components and will need to create [Y] new files. Does this approach look right before I start building?"

Once approved, implement in this order:

#### Step 1: Backend First (if needed)
1. Create DynamoDB table (if new data)
2. Create Lambda functions following existing patterns
3. Add API Gateway routes
4. Test endpoints work

#### Step 2: Frontend Structure
1. Add HTML section in index.html (copy existing section structure)
2. Add navigation link (copy existing nav pattern)
3. Create new JS file for feature logic

#### Step 3: Frontend Logic
1. Implement using existing API call patterns
2. Reuse existing UI components and styles
3. Follow existing modal/form patterns
4. Match existing loading/error handling

#### Step 4: Integration & Polish
1. Connect all pieces
2. Add proper error handling
3. Add loading states
4. Test full user flow

#### Step 5: Documentation
1. Update CLAUDE.md with new feature
2. Add to API endpoints list
3. Update file structure section
4. Update architecture diagram if needed

---

## Coding Standards (Always Apply)

### 🔒 Security First
- Validate all inputs
- Check authentication in Lambda handlers
- Never expose secrets

### 📏 File Size Limits
- Max 1,000 lines per file
- Split if approaching 800 lines

### 🎨 UI Consistency
- Use existing CSS classes
- Match existing component patterns
- Don't create new styles if existing ones work

### 🔄 Code Reuse Checklist
Before writing new code, ask:
- [ ] Does a similar component exist?
- [ ] Can I extend an existing function?
- [ ] Is there a pattern I should follow?
- [ ] Will this be reusable by future features?

### 🧹 Clean Code
- Remove any unused code immediately
- No console.logs in commits
- Clear, descriptive naming

---

## Progress Updates

After completing each phase, update the feature doc:

```markdown
## Progress Tracker
- [x] **Phase 1:** Setup - Add HTML section, navigation ✅ Complete
- [x] **Phase 2:** Backend - Create Lambda functions ✅ Complete
- [ ] **Phase 3:** Frontend - Implement UI logic 🔄 In Progress
- [ ] **Phase 4:** Integration
- [ ] **Phase 5:** Polish
- [ ] **Phase 6:** Documentation
```

---

## Common Patterns to Reuse

### API Calls (Frontend)
```javascript
// Follow existing pattern in auth.js
const data = await apiGet('/api/resource');
const result = await apiPost('/api/resource', { field: value });
```

### Lambda Handler
```typescript
// Follow existing pattern
import { success, badRequest, forbidden } from '../../shared/response';
import { getUserFromEvent, isAdmin } from '../../shared/auth';

export const handler = async (event) => {
  const user = getUserFromEvent(event);
  // ... implementation
  return success(data);
};
```

### HTML Section
```html
<!-- Copy structure from existing section -->
<section id="featureName" class="d-none">
  <div class="d-flex justify-content-between align-items-center mb-4">
    <h2>Feature Name</h2>
    <button class="btn btn-primary" data-role="admin">
      <i class="bi bi-plus-lg"></i> Add New
    </button>
  </div>
  <!-- Content here -->
</section>
```

---

## Red Flags — Stop and Reconsider

🚩 **If you find yourself:**
- Creating a completely new UI pattern → Look for existing pattern first
- Writing 200+ lines without checking for reuse → Step back and analyze
- Duplicating code from another feature → Extract to shared utility
- Adding a new CSS framework or library → Use existing styles
- Creating complex nested logic → Simplify the approach

---

## Completion Checklist

Before marking the feature complete:

- [ ] Feature works end-to-end
- [ ] Matches existing UI look and feel
- [ ] All coding standards followed
- [ ] No files over 1,000 lines
- [ ] No unused code
- [ ] CLAUDE.md updated
- [ ] Feature doc marked complete
- [ ] Tested with different user roles (if applicable)
