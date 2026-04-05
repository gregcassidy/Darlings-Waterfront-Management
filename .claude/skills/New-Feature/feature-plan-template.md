# Feature: [Feature Name]

## Overview
**One-liner:** [Single sentence describing the feature]
**User:** [Who uses this feature]
**Priority:** [Must-have / Nice-to-have]
**Created:** [Date]

---

## User Story

As a [role], I want to [action] so that [benefit].

---

## User Flow

1. User navigates to [location]
2. User clicks [button/action]
3. System displays [what appears]
4. User [performs action]
5. System [responds with]
6. User sees [final state]

---

## Implementation Plan

### Existing Components to Reuse

| Component | Location | How We'll Use It |
|-----------|----------|------------------|
| [Button style] | `styles.css` | Use `.btn-primary` class |
| [Modal pattern] | `public/js/[file].js` | Copy modal structure |
| [API call pattern] | `public/js/auth.js` | Use `apiGet/apiPost` helpers |
| [Table layout] | `index.html` | Copy from similar section |
| [Lambda pattern] | `lambda/functions/[x]/` | Follow existing handler structure |

### New Code Required

| Type | File Path | Description | Est. Lines |
|------|-----------|-------------|------------|
| Frontend JS | `public/js/[feature].js` | Feature logic | ~150 |
| Lambda | `lambda/functions/[feature]/list.ts` | List endpoint | ~50 |
| Lambda | `lambda/functions/[feature]/create.ts` | Create endpoint | ~60 |
| HTML Section | `public/index.html` | UI section | ~40 |

### Files to Modify

| File | Changes Required |
|------|------------------|
| `public/index.html` | Add nav link, add section |
| `public/js/app.js` | Add navigation handler |
| `infrastructure/lib/api-stack.ts` | Add Lambda + routes |
| `CLAUDE.md` | Document new feature |

### Database Changes

**New Table:** [Table name if needed]

| Attribute | Type | Description |
|-----------|------|-------------|
| id | String (UUID) | Primary key |
| [field] | [type] | [description] |
| createdAt | String (ISO) | Creation timestamp |
| createdBy | String | User ID |

**Or:** No new tables - uses existing [Table name]

---

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/[feature]` | List all | Required |
| POST | `/api/[feature]` | Create new | Admin |
| GET | `/api/[feature]/{id}` | Get one | Required |
| PUT | `/api/[feature]/{id}` | Update | Admin |
| DELETE | `/api/[feature]/{id}` | Delete | Admin |

---

## Progress Tracker

### Phase 1: Setup
- [ ] Add HTML section structure
- [ ] Add navigation link
- [ ] Create empty JS file

### Phase 2: Backend
- [ ] Create DynamoDB table (if needed)
- [ ] Create Lambda functions
- [ ] Add API Gateway routes
- [ ] Test endpoints with curl/Postman

### Phase 3: Frontend
- [ ] Implement list view
- [ ] Implement create form/modal
- [ ] Implement edit functionality
- [ ] Implement delete with confirmation

### Phase 4: Integration
- [ ] Connect frontend to API
- [ ] Handle loading states
- [ ] Handle errors gracefully
- [ ] Test full user flow

### Phase 5: Polish
- [ ] Add input validation
- [ ] Add success/error toasts
- [ ] Handle edge cases
- [ ] Test with different roles

### Phase 6: Documentation
- [ ] Update CLAUDE.md
- [ ] Update this feature doc status
- [ ] Mark feature complete

---

## Security Checklist

- [ ] All inputs validated (frontend + backend)
- [ ] Authentication checked in all Lambda handlers
- [ ] Role-based access implemented where needed
- [ ] No sensitive data exposed
- [ ] SQL/NoSQL injection prevented

---

## Technical Notes

[Any important decisions, constraints, or things to remember]

---

## Status

**Current Phase:** [Phase X - Description]
**Started:** [Date]
**Completed:** [Date or "In Progress"]
