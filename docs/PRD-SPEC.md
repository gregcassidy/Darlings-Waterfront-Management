# PRD & Technical Spec — Darling's Waterfront Ticket Management

## Quick Reference
| Resource | Value |
|----------|-------|
| AWS Account | 119002863133 |
| Region | us-east-1 |
| App URL | https://d2ih87vneh642g.cloudfront.net |
| API Gateway URL | https://r7wuhspii5.execute-api.us-east-1.amazonaws.com/prod/ |
| CloudFront Distribution ID | E32EW6VUY7FGE7 |
| S3 Bucket | *(post-deploy)* |
| CDK Stack Prefix | `DarlingsWaterfront` |

---

## Overview

**App:** Darling's Waterfront Ticket Management  
**Venue:** Maine Savings Pavilion, Bangor, ME  
**Concert Source:** https://www.waterfrontconcerts.com/  
**Purpose:** Allow Darling's employees to submit their top-5 concert preferences each season. Admins manage the concert list, assign tickets, issue parking passes, track attendance, and send notifications.

---

## User Roles

| Role | Access |
|------|--------|
| `employee` | Submit/view/update top-5 preferences, view their own assignments |
| `admin` | Full access — concerts, preferences, assignments, parking passes, notifications, settings |

All users authenticate via **Azure AD SSO** (MSAL.js). Employee profile data (name, work email) is pulled automatically from Azure AD at login.

---

## User Stories

### Employee
- As an employee, I want to log in with my Darling's account so I don't need a separate password.
- As an employee, I want to submit my top 5 concert preferences for the season.
- As an employee, I want to provide my personal email so I can receive ticket notifications.
- As an employee, I want to update my preferences if the admin re-opens submissions.
- As an employee, I want to view my current selections.

### Admin
- As an admin, I want to sync the concert list from waterfrontconcerts.com so I don't enter shows manually.
- As an admin, I want to manually add/edit/remove concerts.
- As an admin, I want to view all employee preferences per concert to help decide who gets tickets.
- As an admin, I want to assign tickets (with type) to employees for each concert.
- As an admin, I want to issue and track parking passes per assignment.
- As an admin, I want to track whether a ticket holder actually attended.
- As an admin, I want to send a winner announcement email to all employees for each event.
- As an admin, I want to send ticket details to the winner's personal email.
- As an admin, I want to open/close the submission window globally or per employee.
- As an admin, I want an admin settings panel to configure the app.

---

## Data Model (DynamoDB)

### Table: `WF-Concerts`
| Attribute | Type | Notes |
|-----------|------|-------|
| `concertId` | String (PK) | UUID |
| `name` | String | Show name |
| `date` | String | ISO date (YYYY-MM-DD) |
| `time` | String | e.g., "7:00 PM" |
| `season` | String | e.g., "2026" (GSI PK) |
| `status` | String | `upcoming` \| `past` \| `cancelled` |
| `ticketsAvailable` | Number | Tickets Darling's has for this show |
| `sourceUrl` | String | Link to waterfrontconcerts.com page |
| `createdAt` | String | ISO timestamp |
| `updatedAt` | String | ISO timestamp |

GSI: `season-date-index` (PK: season, SK: date)

---

### Table: `WF-Employees`
| Attribute | Type | Notes |
|-----------|------|-------|
| `userId` | String (PK) | Azure AD Object ID |
| `name` | String | Full name from Azure AD |
| `workEmail` | String | Azure AD email |
| `personalEmail` | String | Provided by employee for ticket notifications |
| `department` | String | From Azure AD |
| `submissionsLocked` | Boolean | Admin can lock individual employee |
| `createdAt` | String | ISO timestamp |
| `updatedAt` | String | ISO timestamp |

---

### Table: `WF-Preferences`
| Attribute | Type | Notes |
|-----------|------|-------|
| `userId` | String (PK) | Azure AD Object ID |
| `season` | String (SK) | e.g., "2026" |
| `personalEmail` | String | Captured at submission time |
| `choices` | List | [{rank: 1, concertId: "..."}, ...] up to 5 |
| `submittedAt` | String | ISO timestamp |
| `updatedAt` | String | ISO timestamp |

GSI: `season-index` (PK: season) — for admin to view all preferences for a season

---

### Table: `WF-Assignments`
| Attribute | Type | Notes |
|-----------|------|-------|
| `assignmentId` | String (PK) | UUID |
| `concertId` | String | GSI PK |
| `userId` | String | GSI PK |
| `season` | String | e.g., "2026" |
| `ticketType` | String | e.g., `General`, `VIP`, `Suite`, `Lawn` |
| `ticketCount` | Number | Number of tickets |
| `parkingPass` | Boolean | Whether parking pass issued |
| `parkingPassCode` | String | Pass identifier/code |
| `notificationSent` | Boolean | Whether winner email sent |
| `attended` | Boolean | null until updated post-event |
| `notes` | String | Admin notes |
| `assignedAt` | String | ISO timestamp |
| `updatedAt` | String | ISO timestamp |

GSI: `concertId-index` (PK: concertId)  
GSI: `userId-index` (PK: userId)

---

### Table: `WF-Settings`
| Attribute | Type | Notes |
|-----------|------|-------|
| `settingKey` | String (PK) | e.g., `submissionsOpen`, `currentSeason` |
| `value` | String | Setting value |
| `updatedBy` | String | Admin userId |
| `updatedAt` | String | ISO timestamp |

Key settings:
- `submissionsOpen`: `"true"` / `"false"`
- `currentSeason`: `"2026"`
- `notificationFromEmail`: SES-verified sender address

---

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/token` | Validate Azure AD JWT, return user profile |

### Concerts
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/concerts` | All | List concerts for current season |
| GET | `/concerts/{id}` | All | Get single concert |
| POST | `/concerts` | Admin | Create concert manually |
| PUT | `/concerts/{id}` | Admin | Update concert |
| DELETE | `/concerts/{id}` | Admin | Remove concert |
| POST | `/concerts/sync` | Admin | Scrape & sync from waterfrontconcerts.com |

### Preferences
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/preferences/me` | Employee | Get own preferences |
| POST | `/preferences` | Employee | Submit/update preferences |
| GET | `/preferences` | Admin | List all preferences for current season |
| GET | `/preferences/{userId}` | Admin | Get specific employee preferences |

### Assignments
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/assignments` | Admin | List all assignments |
| GET | `/assignments/concert/{id}` | Admin | Assignments for a concert |
| GET | `/assignments/me` | Employee | Own assignments |
| POST | `/assignments` | Admin | Create assignment |
| PUT | `/assignments/{id}` | Admin | Update assignment (parking, attendance, etc.) |
| DELETE | `/assignments/{id}` | Admin | Remove assignment |

### Notifications
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/notifications/winner` | Admin | Email winner their ticket details |
| POST | `/notifications/announce` | Admin | Announce winners to all employees |

### Settings
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/settings` | Admin | Get all settings |
| PUT | `/settings/{key}` | Admin | Update a setting |
| PUT | `/settings/submissions/lock/{userId}` | Admin | Lock/unlock individual employee submissions |

---

## Architecture

```
[Employee/Admin Browser]
        │
        ▼
[CloudFront CDN]
        │
   ┌────┴────┐
   │  S3     │  ← Static HTML/JS/CSS
   └─────────┘
        │
        ▼
[API Gateway (REST)]
        │
[Lambda Authorizer] ← validates Azure AD JWT
        │
   ┌────┴──────────────────────────────┐
   │  Lambda Functions                 │
   │  ├── concerts (CRUD + sync)       │
   │  ├── preferences (submit/view)    │
   │  ├── assignments (manage)         │
   │  ├── notifications (SES)          │
   │  └── settings (admin config)      │
   └───────────────────────────────────┘
        │
   ┌────┴──────────────────┐
   │  DynamoDB Tables      │
   │  ├── WF-Concerts      │
   │  ├── WF-Employees     │
   │  ├── WF-Preferences   │
   │  ├── WF-Assignments   │
   │  └── WF-Settings      │
   └───────────────────────┘
        │
   [SES] ← winner + announcement emails
```

---

## Concert Sync Feature

**Source:** https://www.waterfrontconcerts.com/  
**Trigger:** Admin clicks "Sync Concerts" button in settings  
**Lambda behavior:**
1. Fetch main page HTML, parse show names and dates
2. For each show found, fetch individual show page to extract time
3. Upsert into `WF-Concerts` (match on name+date, don't overwrite manual edits)
4. Return list of added/updated/unchanged counts to admin

**Note:** If site structure changes, admin can fall back to manual concert entry.

---

## Email Notifications (SES)

Two notification types:

**Winner Email** (to personal email):
> "Congratulations! You've been selected to attend [Concert Name] on [Date]. Your ticket type: [Type]. Parking pass: [Yes/No - Code]. Please contact [admin] with any questions."

**Announcement Email** (to all employees):
> "Ticket winners for [Concert Name] on [Date] have been selected. Congratulations to [Name(s)]! Stay tuned for upcoming concert announcements."

---

## Frontend Pages

| Page | Route | Access |
|------|-------|--------|
| Login | `/login.html` | Public |
| My Preferences | `/index.html#preferences` | Employee |
| My Tickets | `/index.html#my-tickets` | Employee |
| Concert Management | `/index.html#concerts` | Admin |
| Preference Reports | `/index.html#reports` | Admin |
| Assignments | `/index.html#assignments` | Admin |
| Notifications | `/index.html#notifications` | Admin |
| Settings | `/index.html#settings` | Admin |

---

## Implementation Phases

- [ ] **Phase 1:** Infrastructure (CDK stacks, DynamoDB, API Gateway, CloudFront)
- [ ] **Phase 2:** Auth (Azure AD SSO, Lambda authorizer, login page)
- [ ] **Phase 3:** Concert management (CRUD + sync from waterfrontconcerts.com)
- [ ] **Phase 4:** Employee preference submission
- [ ] **Phase 5:** Admin assignment management (tickets, parking passes)
- [ ] **Phase 6:** Attendance tracking
- [ ] **Phase 7:** Notifications (SES — winner emails + announcements)
- [ ] **Phase 8:** Settings panel (submissions open/close, season management)
- [ ] **Phase 9:** Polish (employee view of own assignments, mobile responsiveness)

---

## Open Items
- [ ] Confirm Azure AD App Registration client ID / tenant ID with IT
- [ ] Confirm SES-verified sender email address
- [ ] Review last year's Excel spreadsheet to validate data model
- [ ] Determine ticket types used (General, VIP, Suite, Lawn, etc.)
- [ ] Confirm number of employees (~how many use Azure AD vs not)
