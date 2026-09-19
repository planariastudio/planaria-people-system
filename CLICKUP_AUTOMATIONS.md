# ClickUp Automations, setup runbook

How to make ClickUp notify the right person at each step of a KPI, Peer
Appraisal, or PIP, without changing any code in this repo.

The Worker already creates, renames, moves and closes the tasks. It does **not**
send any messages. Everything here is built inside ClickUp's own Automations UI,
keyed off things the Worker is already doing.

**Numbering:** document sections are lettered (§A, §B and so on), automations are
numbered (1.1, 1.2, 2.1). So `1.2` always means an automation, never a section.

**Target:** Space **People Performance & Development**, one folder per person,
four lists in each folder (`KPI`, `Peer`, `PIP`, `To-do`).

---

## §A. Verified facts about this workspace

Checked directly in ClickUp on 2026-07-27, not assumed.

| | |
|---|---|
| Plan | **Business** |
| Active automation rules | **UNLIMITED**, so the number of automations is free |
| Actions per month | 10,000, currently **1,333 used (13.3%)** |
| Space statuses | `TO DO`, **`IN PROGRESS`**, (Done: empty), **`COMPLETE`** |
| Folders in Space | 10, one per editor (§B3) |

**The status prerequisite is already satisfied.** `clickupSetStatus()` matches
case-insensitively by substring. It asks for `in progress` and matches
**IN PROGRESS**. It asks for `complete` and matches **COMPLETE**. Nothing to
rename. This was the one thing that could have silently killed half the
automations, and it is fine.

> Warning: if anyone renames those statuses, especially `COMPLETE` to `Closed`
> which is a common ClickUp default, the Worker's status call and every
> automation that triggers on it break silently and at the same time. Nothing
> errors. Re-run `/selftest` after any status change.

### `Send direct message` exists (correction)

An earlier draft of this file said ClickUp has no automation action that sends a
direct message. **That was wrong.** `Send direct message` is a real action and
Planaria already uses it in 5 of the 15 automations on `Project 2.0`.

What it can and cannot do:

- **The recipient is fixed.** One specific person, or a typed email address.
  There is no dynamic "assignee" option, the picker is just the roster by name.
  This single constraint drives the whole structure in §C.
- **The message body is dynamic.** 20 variables are available through the
  *FIELDS FROM TRIGGER* chips: `Task Name`, `Task ID`, `Task Description`,
  `Task Link`, `Assignees`, `Watchers`, `Status Name`, `Status Color`,
  `Status Type`, `Home List Name`, `Priority`, `Due Date`, `Start Date`,
  `Date Created`, `Date Updated`, `Date Done`, `Date Closed`, `Triggered by`,
  `Creator Username`, `Creator Email`.
- `Task Link` is the useful one. A DM can link straight to the task.

### What ClickUp already does without any automation

Do not rebuild these:

- **Assigned a task, the assignee gets a notification** (bell, email, mobile
  push, depending on their own settings).
- **@mentioned in a comment, they get notified.**
- **A task you are assigned to changes status, watchers get an update.**

So the automations add two things: a real DM with instructions, and reaching
people who are not the assignee. That second one matters most for the
supervisor, who is never assigned to an editor's KPI task by design.

---

## §B. Prerequisites

### B1. Statuses. Already done, nothing to do

See §A.

### B2. ClickApps that must be on

| ClickApp | Why | If off |
|---|---|---|
| **Tags** | Every automation filters on tags. | Tags are silently rejected at creation, every condition fails, nothing fires. |
| **Priority** | Worker sets priority from score band and PIP severity. | Silently rejected. |
| **Tasks in Multiple Lists** | Moves a filed KPI from To-do into the KPI list. | Task stays in To-do marked `Filed ✓`. `1.3` still fires because it is folder-scoped (§C), it is just less tidy. |
| **Automations** | Obviously. | |

### B2a. Space access. The prerequisite nobody thinks of

Checked on 2026-07-29. **People Performance & Development is a private Space.**
"Share with → Planaria Studio (Workspace members)" is off, and the People list
holds four managers: Joshua, Julius Pandu, Maura Carla, Rashy Azhardwian.

Most of the roster are **Limited Members**, who see only what is explicitly
shared with them. That has a hard consequence for `1.1` and `2.1`:

> **`Update assignees` cannot target someone who has no access to the Space.**
> They do not appear in the picker at all. Searching their name returns
> *"No people or teams matched your search"*, so there is nothing to select and
> the automation cannot be finished as designed.

This was hit for real while building Richo's `2.1`. Sharing the folder with him
made him appear in the picker immediately, and the build went through.

Two things to know about how the pickers differ:

| Picker | Scope | Consequence |
|---|---|---|
| `Update assignees` | Space members only | Blocks the build until the person is shared in |
| `Send direct message` | Whole workspace | A DM can always be addressed, even to someone with no access |

So a DM to someone outside the Space *sends*, but its `Task Link` opens nothing
for them. **Sharing is what makes the message useful, not just deliverable.**

Before building a person's `1.1` or `2.1`, confirm they resolve in the assignee
picker. If they do not, share the Space or their folder with them first. There is
no way to tell from the finished automation that this went wrong — ClickUp's own
warning in the builder says it plainly: *"If the assignee doesn't have access to
the task, this action will be skipped."*

### B3. The roster, and three display name mismatches

Folder names are created from roster names, so **the folder names are the roster
names**. Assignee resolution needs an exact match (lowercased, whitespace
normalised) on the ClickUp username, or on the email prefix against the name with
spaces removed:

```js
const hit = CLICKUP_MEMBER_CACHE.find((u) => norm(u.username) === target)
  || CLICKUP_MEMBER_CACHE.find((u) => norm((u.email || "").split("@")[0]) === target.replace(/ /g, ""));
```

| # | Folder / roster name | ClickUp display name | Assignee resolves? |
|---|---|---|---|
| 1 | Rafli Ibrahim | `Rafli Ibrahim` | yes |
| 2 | Reza Ali Akbar | `Reza Ali Akbar` | yes |
| 3 | Richo Darma Agi | `Richo Darma` | **no** |
| 4 | Davin Edbert | `Davin E` | **no** |
| 5 | Aqilla Fauzan | `Aqilla Fauzan` | yes |
| 6 | Eduardus Kent Sutanza | `Eduardus Kent Sutanza` | yes |
| 7 | Evander Arther Lesnussa | `Evander Arther Lesnussa` | yes |
| 8 | Fitra Pratama | `Fitra Pratama` | yes |
| 9 | Fitriani Utami Dewi | `Fitriani UD` | **no** |
| 10 | Ifan Ahmad | `Ifan Ahmad` | yes |

For rows 3, 4 and 9 every KPI and Peer task is currently created **unassigned**.
No native notification, and the task never shows up in their My Tasks. The one
thing that could save it is the email fallback, if their ClickUp email happens to
be `richodarmaagi@...` and so on. Worth confirming.

**This gets fixed in ClickUp, with no code change.** Each per-person automation
includes an `Update assignees` action pointing at the correct ClickUp user, so
the task gets assigned properly even when the name does not resolve. Apply it to
**all ten**, not just the three. It is a no-op where the Worker already got it
right, it keeps every folder's automation identical in shape, and it self-heals
if someone's display name changes later.

The DM recipient is picked by hand per folder, so the mismatch never affects
notifications either:

| Folder | DM recipient to pick |
|---|---|
| Richo Darma Agi | `Richo Darma` |
| Davin Edbert | `Davin E` |
| Fitriani Utami Dewi | `Fitriani UD` |

The other option, a `roster.clickup_username` override column in the Worker, is
not being built. Renaming those three display names in ClickUp to match the
roster would also work and takes about 30 seconds each, but it is not required.

---

## §C. Where each automation goes, and why

**The rule: an automation's scope has to match its recipient.**

A DM recipient is fixed. So an automation that DMs *the editor whose task this
is* cannot live on the Space, because it would fire on everyone's tasks and DM
the wrong person. The folder is what makes it work. One folder is one person, so
a folder-scoped automation only ever sees that person's tasks.

Space level is only safe when the recipient is the same no matter whose task
triggered it, which means the supervisor.

```
People Performance & Development   (Space)
│
├── 1.2 · Locked → Supervisor         ← Space: always DMs Rashy
├── 3.1 · PIP opened → Supervisor     ← Space: always DMs Rashy
├── 3.2 · PIP closed → Supervisor     ← Space: always DMs Rashy
│
├── 📁 Rafli Ibrahim                  (Folder)
│   ├── 1.1 · Self-review opened → Rafli    ← Folder: only Rafli's tasks
│   ├── 1.3 · Filed → Rafli                 ← Folder
│   ├── KPI
│   ├── Peer      → 2.2 · Result ready → Rafli      ← List
│   ├── PIP
│   └── To-do     → 2.1 · Rating requested → Rafli  ← List
│
├── 📁 Reza Ali Akbar     … same four
└── … 8 more folders
```

**Why 1.1 and 1.3 sit on the folder instead of a list.** When a KPI is filed the
Worker moves the task out of To-do and into the KPI list. A folder-scoped
automation sees it in either place, so `1.3` still fires if that move fails
(Tasks in Multiple Lists disabled, §B2).

**Why 2.1 and 2.2 go one level deeper, onto lists.** Both peer task kinds carry
the same `Peer Appraisal` tag. What separates them is the list. `To-do` means "go
rate someone", `Peer` means "here is your result about you". A folder-level
automation sees both and cannot tell them apart.

**Count: 43.** Four per person across 10 people, plus 3 on the Space. Rules are
unlimited on the Business plan, so the count costs nothing but build time.

### Untagged tasks, and why the tag conditions have to stay

The Worker creates these with **no tags**:

- `Focus · <area>` subtasks under a filed KPI, created right after filing
- PIP support-action subtasks

Every automation filters on a tag, which is what stops them firing on these.
**Do not remove the tag conditions.** A filed KPI with three focus areas would
otherwise send three "you have something to do" DMs.

---

## §D. State map, what the Worker actually does

This is the trigger reference. Everything in §F fires off one of these.

### KPI, one task per editor per quarter, evolving in place

| When | Task name becomes | Where | Status set | Tags |
|---|---|---|---|---|
| Admin clicks "Add task in ClickUp" | `KPI self-review · Name · Q3 2026` | editor's **To-do** | `TO DO` | `KPI`, `Q3-2026` |
| Editor locks their self-review | `… · Awaiting supervisor` | editor's **To-do** | **`IN PROGRESS`** | unchanged |
| Supervisor files it | `KPI · Name · Q3 2026 · Filed ✓` | moved to editor's **KPI** | **`COMPLETE`** | unchanged |

At filing the Worker's order is: rename, attach PDF, add to KPI list, remove from
To-do, set COMPLETE, create focus subtasks. So by the time `1.3` fires the PDF is
attached and the task is already in the KPI list. Telling the editor "your result
is ready, it is in your KPI list" is accurate at that moment.

### Peer Appraisal, two task kinds sharing one tag

| When | Task name | Where | Status set | Tags |
|---|---|---|---|---|
| Admin clicks the per-row "Add task" | `Peer Appraisal · Rate Target · Q3 2026` | **rater's To-do** | `TO DO` | `Peer Appraisal`, `Q3-2026` |
| Rater submits | `… · Done ✓` | rater's To-do | **`COMPLETE`** | unchanged |
| 2nd rater submits (`MIN_N=2`) | `Peer Scorecard · Target · Q3 2026` | **target's Peer** | `IN PROGRESS` | `Peer Appraisal`, `Q3-2026` |
| All assigned raters in | unchanged | target's Peer | **`COMPLETE`** | unchanged |

### PIP

| When | Task name | Where | Status set | Tags |
|---|---|---|---|---|
| Admin clicks "Create case" | nothing in ClickUp yet, the id is only reserved | | | |
| Supervisor's first real save | `PIP · Editor · PIP-2026-Q3-Name-01` | editor's **PIP** | **`IN PROGRESS`** | `PIP`, `Q3-2026` |
| Every later save or checkpoint | unchanged | | | fresh PDF attached |
| Final verdict filed | unchanged | editor's PIP | **`COMPLETE`** | priority set by verdict |

PIP tasks are assigned to the **managers**, not the editor. That is deliberate,
an editor should never be handed a live PIP form. The task sits in the editor's
own PIP folder so it is visible if they go looking, but they get no notification
and no DM. Have the conversation first.

---

## §E. Names and the click path

### E1. Naming

ClickUp auto-names an automation after its own trigger ("When status changes to
In Progress, then..."). Several of these would look identical in the Manage list,
so rename every one.

`1` is KPI, `2` is Peer Appraisal, `3` is PIP. The second digit follows lifecycle
order, so reading the Manage list top to bottom tells you the flow.

| Name | Scope | Trigger |
|---|---|---|
| `1.1 · Self-review opened → <Name>` | folder | task created |
| `1.2 · Locked, awaiting supervisor → Supervisor` | Space | status → IN PROGRESS |
| `1.3 · Filed → <Name>` | folder | status → COMPLETE |
| `2.1 · Rating requested → <Name>` | To-do list | task created |
| `2.2 · Result ready → <Name>` | Peer list | task created |
| `3.1 · Case opened → Supervisor` | Space | task created |
| `3.2 · Case closed → Supervisor` | Space | status → COMPLETE |

`<Name>` is the person's roster name, which is the folder name, not their ClickUp
display name. That way the automation reads consistently with the folder it sits
in.

Use the **description field** at the bottom of the builder for the "why", the way
`Project 2.0`'s automations do ("Send message to SPV if editor send to spv").

### E2. Click path

**Use the ⚡ button, not the `...` menu.** Open the list itself, then click the
**⚡ Automations** icon in the top-right toolbar and pick **Create Automation**.
It scopes to exactly the list you are looking at and the builder opens directly.

The `...` → **Automations** route works but is genuinely dangerous here: in a
list's context menu, **Convert List to Sprint** sits one row above Automations,
and the menu re-renders after it opens, so a click aimed at Automations can land
on Convert instead. That happened twice while building these. It opens a
confirmation dialog, so nothing is lost if you read before clicking, but do not
click that menu blind.

For **folder-scoped** automations (`1.1`, `1.3`) there is no ⚡ button, so open
the Automations panel from anywhere, then use the **scope dropdown at the top
left** of the Manage tab. Click into its own search field before typing —
clicking the dropdown alone leaves focus in the Manage search box, and what you
type silently filters the automation list instead of the scope tree.

1. Open Automations on the target (Space, folder or list).
2. **+ Add Automation**, then **Custom Automation**. Skip the template gallery.
3. **When**: pick the trigger and fill in its settings.
4. **And**: **+ Add condition** for each condition listed below. Conditions are
   ANDed together.
5. **Then**: **+ Add action**. Multiple actions in one automation are fine,
   `Project 2.0`'s `Automation #7` has five.
6. **Rename** by clicking the title at the top and typing the name. Do this
   before saving. It is easy to forget and annoying to find later.
7. **Create**.

Insert message variables using the **FIELDS FROM TRIGGER** chips under the
message box. The `+16` chip expands the full list.

---

## §F. The automations

`{Task Link}` and `{Task Name}` mean an inserted variable chip, not literal text.

---

### 1.1 · Self-review opened (per person)

**Build on:** that person's **folder**

| | |
|---|---|
| **When** | Task Created |
| **And** | Tag is `KPI`, and Status is `TO DO`, and Task name contains `self-review` |
| **Then** | 1. `Update assignees` → their ClickUp user.  2. `Send direct message` → their ClickUp user. |

```
Your KPI self-review for this quarter is open.

{Task Name}
{Task Link}

Open the link inside the task. It only opens your own review, nobody else's.

Score each metric 1 to 5, write down what you actually did as evidence, pick a
focus area, then hit Lock.

Lock is final. You only get one submission per quarter, so don't lock until
you're done.
```

**Why the `TO DO` status condition.** When a KPI is filed it gets added to the
KPI list, which can read as a new task arriving there. Requiring the default
status means only genuinely fresh tasks match.

**Why the name condition as well.** There is one path where the Worker really
does create a brand new task at filing time: a supervisor files a case that never
went through the admin "Add task in ClickUp" step, so there is nothing to rename
and `clickupCreateTaskInList()` runs instead. That task is created in the KPI
list, tagged `KPI`, and sits at the default `TO DO` for the moment before the
Worker sets it to `COMPLETE`. Tag and status both match, and the editor gets told
their self-review is open on a KPI that is already finished. The name is what
separates the two cases: a fresh task is `KPI self-review · …`, a filed one is
`KPI · … · Filed ✓`.

---

### 1.2 · Locked, awaiting supervisor → Supervisor

**Build on:** **Space**

This is the one that cannot be done any other way. The KPI task is only ever
assigned to the editor, so the supervisor gets no native notification that a
self-review is sitting there waiting.

| | |
|---|---|
| **When** | Status changes → to `IN PROGRESS` |
| **And** | Tag is `KPI` |
| **Then** | `Send direct message` → **Rashy Azhardwian** |

```
{Task Name} is locked and waiting for your score.

https://planariastudio.github.io/planaria-people-system/kpi_scorecard.html

You'll see the editor's answers read-only next to your scoring panels. Respond to
the focus areas, write the assessment, check the result card preview, then File
to ClickUp.
```

`IN PROGRESS` inside a person's To-do list means exactly one thing, a locked KPI
self-review, because a submitted Peer Appraisal goes straight to `COMPLETE` and
never passes through `IN PROGRESS`. The tag condition is belt and braces.

**Rashy only, not Joshua.** Joshua owns the workspace and is the account this was
built from, so a DM there would just be messaging yourself. If a third supervisor
joins, add a second `Send direct message` action here rather than a new
automation.

---

### 1.3 · Filed (per person)

**Build on:** that person's **folder**

| | |
|---|---|
| **When** | Status changes → to `COMPLETE` |
| **And** | Tag is `KPI`, and Task name contains `Filed ✓` |
| **Then** | 1. `Send direct message` → their ClickUp user.  2. `Add comment`. |

DM:
```
Your KPI for this quarter is done and filed.

{Task Name}
{Task Link}

The result PDF is attached to the task. It shows your official score, how it
compares to your own self-score, and the supervisor's note on every metric.

Any focus areas you agreed on are now subtasks under it, due next quarter.
```

Comment, which is the durable record on the task:
```
Filed. Result PDF attached above, focus areas added as subtasks. Editor has been
notified.
```

**What the `Filed ✓` name condition is for.** It guards against a human. `Focus ·`
subtasks are untagged, so `Tag is KPI` already excludes them, because tags are
not inherited by subtasks. The real risk is someone ticking the KPI task
`COMPLETE` by hand before the supervisor has filed it, which would tell the
editor their KPI is done when it isn't. Only the Worker's filing step puts
`Filed ✓` in the name.

---

### 2.1 · Rating requested (per person)

**Build on:** that person's **`To-do` list**

| | |
|---|---|
| **When** | Task Created |
| **And** | Tag is `Peer Appraisal` |
| **Then** | 1. `Update assignees` → their ClickUp user.  2. `Send direct message` → their ClickUp user. |

```
You've been asked to rate a teammate this cycle.

{Task Name}
{Task Link}

The link inside goes straight to their rating page. You don't pick a name.

Your ratings are pooled and anonymous. Nothing you write is shown as coming from
you, and no result shows up until at least two people have rated the same person.
```

The tag on its own is enough here, because a Peer **Scorecard** never lands in a
To-do list. It is created straight into the target's Peer list.

One edge case to know about. The rater's prompt normally goes to their To-do
list, but the Worker falls back to their **Peer** list if To-do cannot be
resolved:

```js
const listId = todoListId || await resolveEditorList(env, rater.id, rater.name, "peer");
```

If that fallback ever fires, a "go rate someone" task lands in a Peer list and
picks up `2.2`'s wrong message. It is visible when it happens, because
`POST /peer/create-assignment-task` returns `list_name: "To-do"` or `"Peer"`. It
should always say `To-do`. If you see `Peer`, that person's To-do list is
missing, so fix that rather than working around it here.

---

### 2.2 · Result ready (per person)

**Build on:** that person's **`Peer` list**

| | |
|---|---|
| **When** | Task Created |
| **And** | Tag is `Peer Appraisal` |
| **Then** | `Add comment` |

```
Your peer appraisal result for this cycle is ready. This one is about you,
there's nothing to fill in.

The PDF attached here is the full scorecard. It updates as more people rate you,
so a newer PDF may show up later this cycle.

Comments are pooled and never attributed to anyone.
```

This is a comment rather than a DM, the one editor-facing event that isn't a DM.
The task is assigned to them so ClickUp notifies them natively. Upgrading it to a
DM costs nothing extra, since it is already per-person, if you want that later.

---

### 3.1 · Case opened → Supervisor

**Build on:** **Space**

| | |
|---|---|
| **When** | Task Created |
| **And** | Tag is `PIP` |
| **Then** | `Send direct message` → **Rashy Azhardwian** |

```
A PIP case has been opened and saved for the first time.

{Task Name}
{Task Link}

The attached PDF is the full report as it stands now. A new PDF gets attached
every time the case is saved, so the newest one is always current.

Support actions are subtasks with real due dates.
```

The editor is deliberately not notified. See §D.

---

### 3.2 · Case closed → Supervisor

**Build on:** **Space**

| | |
|---|---|
| **When** | Status changes → to `COMPLETE` |
| **And** | Tag is `PIP` |
| **Then** | `Send direct message` → **Rashy Azhardwian** |

```
{Task Name} is closed.

The verdict is in the final PDF attached to the task. There's no un-filing. If
anything changes, open a new case.
```

PIP support-action subtasks are untagged, so the tag condition already excludes
them. If you ever see this fire on one, add a name condition of `PIP · `.

---

## §G. Build and test order

Build in this order and test as you go. It is much easier to work out which
automation misfired when two are live than when 43 are.

1. **`1.2`** on the Space. Highest value, and it proves the `IN PROGRESS` trigger
   works.
2. **`1.3`** on one folder only, whoever `system_check.html` uses. Proves the
   `COMPLETE` trigger.
3. Run just the **KPI** check in `system_check.html`. It walks a real case
   through create, lock and file against live ClickUp. Expect a DM at lock, then
   a DM and a comment at filing.
4. If nothing arrives, open the task and look at its **actual status**, not its
   name. See the warning in §A.
5. Clean up with the check tool's delete button. Then build **`1.1`**, **`2.1`**
   and **`2.2`** for that same person and run the **Peer** check. Prove all four
   work on one person before touching the other nine.
6. Build **`3.1`** and **`3.2`** on the Space, then run the **PIP** check.
7. Replicate the four per-person automations across the remaining nine folders.
   **There is no shortcut for this.** An earlier draft of this file said to use
   `Automations → Manage → ... → Copy to`. **That feature does not exist in this
   workspace.** The only menu on an automation is Copy URL, Activity log, Turn
   off, Delete, plus a `Duplicate automation rule` icon that copies within the
   same folder or list only — it cannot target another person's folder.
   So every one of the 40 per-person automations is built from scratch, by hand,
   in its own folder or list. Budget roughly 30 UI steps each.
8. Full **Run all checks**. Confirm the message count per person is what you
   expect. No doubles, nothing on `Focus ·` subtasks.
9. Delete everything the session created.

`system_check.html` uses obviously fake quarters (Q4 2090 through 2099) so test
runs never mix into real tracker data. The DMs it triggers are real though, which
is the point. Run it when the team won't be confused by a test message, or aim it
at yourself.

---

## §H. Things that will bite

### H1. New hires need four automations added by hand

This is the standing cost of per-person scoping, and the one thing here that will
silently rot.

A new editor's folder and four lists are created automatically by
`resolveEditorList()` the first time they get any task. No prompt, no setup step.
The three Space-level automations pick them up for free. The four per-person ones
do not exist until someone makes them.

**Onboarding checklist:** once a new editor's first ClickUp task exists, build
their `1.1` and `1.3` on the folder, `2.1` on their To-do list, and `2.2` on
their Peer list, with `Update assignees` and the DM recipient both pointed at
their ClickUp user.

Symptom if it gets forgotten: that one person gets no DMs and their tasks come
out unassigned, while everyone else is fine. Nothing errors.

### H2. Copying an automation does not remap the person

`Copy to` duplicates the trigger, conditions and actions, including the **DM
recipient and the assignee target**, which will still point at whoever the
original was built for. Repoint both on every copy. This is the easiest way to
end up DMing Rafli about Davin's review.

### H3. Automations don't chain

ClickUp won't let one automation's action trigger another one, on purpose, as
loop protection. Nothing here depends on chaining, but don't build "A sets a
status, B watches for that status" and expect it to work.

### H4. The Worker's status calls are best-effort by design

`clickupSetStatus()` is wrapped in try/catch and returns false on any failure,
with no error surfacing anywhere. An outage, a rate limit, or a renamed status
all mean the automation silently doesn't fire while the case still reports as
filed.

The **task name suffix is the source of truth**, not the status. If someone says
they never got notified, check the name first. `Filed ✓` in the name with a
status that isn't `COMPLETE` is a status problem, not a lost notification.

### H5. Actions budget

Each automation run consumes actions, and a multi-action automation consumes
several. Rough estimate for a full quarter across 10 editors: about 30 KPI events
at 2 actions each, about 30 peer prompts at 2 each, 10 scorecards, plus whatever
PIP activity happens. Call it 150 to 200 actions. Against 8,667 per month of
remaining headroom that is negligible, but check **Automations → Usage** after
the first full quarter rather than assuming.

### H6. Comments accumulate on PIP tasks

The PIP task already re-attaches a PDF on every save, because ClickUp's API
cannot replace an attachment and the PDF is the only thing anyone sees now the
live form link is gone. `3.1` and `3.2` are DMs rather than comments partly for
this reason.

---

## §I. Notes from Planaria's existing automations

`Project 2.0` in the **Staff Hub** space has 15 active automations. Read for
reference, not copied. Worth knowing how they differ.

- **They are custom-field driven.** Approval gates live in custom fields (SPV
  approved, client approved, editor set, request download link) and most triggers
  are `Custom field changed`. The People System writes no ClickUp custom fields
  at all, it signals state through task name suffixes and real statuses. So the
  trigger style here is necessarily different.
- **`Automation #27` is the closest match** to what `1.2` does:
  `Status changed` plus `Condition is true`, then `Send direct message`.
- **They already duplicate per-person for DMs.** There are two `Automation #27`s,
  one tagged `(jul)` and one `(j++)`. Same fixed-recipient constraint, same
  workaround. Per-person scoping here is consistent with what already works.
- **Naming convention there** is `Automation #N - <ClickUp's auto summary>` plus a
  human note in the description field. This runbook uses meaningful names
  instead, but keeps the description field habit.

> Possible pre-existing breakage, worth a look. Opening `Automation #23` in
> **Project 2.0 (copy)** showed its trigger as `Field: Unavailable field` with
> From and To empty and flagged red. The custom field reference looks like it did
> not survive the list being copied. Eight more automations in that copy list are
> custom-field triggered and may be in the same state. Nothing was changed,
> it was cancelled without saving. Unrelated to the People System, but if that
> copy list is live its automations may not be firing.

---

## §J. Build tracker

Forty of these are the same four automations typed ten times. This section is the
part you keep open while clicking, so you are not scrolling back to §F for every
one.

### J1. The per-person set, on one screen

Everything below is built inside that person's folder. `<Name>` is the folder
name. **Their user** means the row from §B3, which is not always spelled like the
folder.

| Name | Build on | When | And | Then |
|---|---|---|---|---|
| `1.1 · Self-review opened → <Name>` | folder | Task Created | Tag `KPI` · Status `TO DO` · Name contains `self-review` | Update assignees → their user · DM → their user |
| `1.3 · Filed → <Name>` | folder | Status → `COMPLETE` | Tag `KPI` · Name contains `Filed ✓` | DM → their user · Add comment |
| `2.1 · Rating requested → <Name>` | `To-do` list | Task Created | Tag `Peer Appraisal` | Update assignees → their user · DM → their user |
| `2.2 · Result ready → <Name>` | `Peer` list | Task Created | Tag `Peer Appraisal` | Add comment |

Message bodies are in §F. They are identical for every person, nothing in them is
name-specific, so they can be pasted straight across. The two things that are
**not** identical and that copying will get wrong every time are the
`Update assignees` target and the DM recipient (§H2).

### J2. Progress grid

Tick as you go. Four columns per person, and the same two mistakes to check on
each: right person assigned, right person DMed.

State as of **2026-07-30**. ✅ built and active, ☐ not built.

| # | Folder | ClickUp user to point at | 1.1 | 1.3 | 2.1 | 2.2 |
|---|---|---|---|---|---|---|
| 1 | Rafli Ibrahim | `Rafli Ibrahim` | ✅† | ✅† | ✅ | ✅ |
| 2 | Reza Ali Akbar | `Reza Ali Akbar` | ✅ | ✅ | ✅ | ✅ |
| 3 | Richo Darma Agi | **`Richo Darma`** | ✅ | ✅ | ✅ | ✅ |
| 4 | Davin Edbert | **`Davin E`** | ✅ | ✅ | ✅ | ✅ |
| 5 | Aqilla Fauzan | `Aqilla Fauzan` | ✅ | ✅ | ✅ | ✅ |
| 6 | Eduardus Kent Sutanza | `Eduardus Kent Sutanza` | ✅† | ✅† | ✅ | ✅ |
| 7 | Evander Arther Lesnussa | `Evander Arther Lesnussa` | ✅ | ✅ | ✅ | ✅ |
| 8 | Fitra Pratama | `Fitra Pratama` | ✅ | ✅ | ✅ | ✅ |
| 9 | Fitriani Utami Dewi | **`Fitriani UD`** | ✅ | ✅ | ✅ | ✅ |
| 10 | Ifan Ahmad | `Ifan Ahmad` | ✅ | ✅ | ✅ | ✅ |

**All forty per-person automations are built and active**, plus the three at
Space level, and all forty match the spec — no exceptions or partial builds left.
Every folder's Manage list was re-opened and read to confirm it, see §J3.

Three things were repaired on 2026-07-30 after the audit found them:

- Every `1.3` now carries **both** actions (`Send direct message` *and*
  `Add comment`). The two pre-existing ones from 2026-07-28, Rafli's and
  Eduardus's, were sending the DM but had no comment.
- Rafli's `1.1` gained its missing `Task Name Contains` → `self-review`
  condition, so it now has all three.
- Ifan's `1.1` gained its missing `Update assignees` action.

† Pre-existing, built 2026-07-28, not by this pass. **Always open a folder's
Manage list before building.** Eduardus already had both, and building blind
would have produced a duplicate that DMs him twice on every event. The audit that
caught this is the only reason it didn't happen.

**Assignee-picker check (§B2a).** All ten now resolve at folder scope. Richo
needed sharing in first. Ifan did not resolve at folder scope on 2026-07-29 —
Workspace People showed him with "0 Folders, 2 Lists" — but did on 2026-07-30
with no sharing change in between, so **the picker's membership data lags.** If
someone doesn't appear, re-check the next day before changing anyone's access.
Re-check for any new hire, at the *same scope* as the automation you are about to
build: list access does not imply folder access.

Space level, three in total, built once:

| | Name | Done |
|---|---|---|
| ✅ | `1.2 · Locked, awaiting supervisor → Supervisor` | |
| ✅ | `3.1 · Case opened → Supervisor` | |
| ✅ | `3.2 · Case closed → Supervisor` | |

### J2a. Six things the builder does that will cost you an automation

All six were hit repeatedly while building these. None of them error in a way
you would notice if you were moving fast.

1. **The person picker clears itself when you click the result.** You type
   "Evander", one row appears, you click it, and the field stays empty — the
   click landed as the dropdown was re-rendering the unfiltered list. **Always
   zoom in on `Send to this user` and confirm an avatar is sitting there before
   you hit Create.** An automation saved with an empty recipient will not save at
   all, and one saved with the *wrong* recipient saves silently.
2. **The name field steals nothing, but the comment box steals everything.**
   Click the title bar straight after typing a comment and your automation name
   gets appended to the comment body instead. Click a blank part of the dialog
   first, then the title.
3. **Create leaves the dialog open.** It looks like it failed. It did not. Click
   it a second time and you get *"Automation name already taken"* — that error
   means the first click worked. Close the dialog and check the Manage list
   rather than clicking Create again. **But it does sometimes genuinely fail**,
   so the rule is: close the dialog, reopen Manage, and confirm the automation is
   listed. Do not trust either the open dialog or a single Create click.
4. **Picking `COMPLETE` in a status dropdown.** It sits inside a collapsed
   *Closed* group and clicking the group header does not expand it. Tick the
   *Closed* group's own checkbox on the right — that selects `COMPLETE`
   directly. Typing "complete" into the picker's search box also works.
5. **Escape does not close a dropdown — it closes the whole builder, and your
   unsaved edits go with it.** There is no confirmation. Dismiss a picker by
   clicking an empty part of the dialog instead. This costs you the entire
   automation if you hit it just before Save.
6. **Never scroll the action dropdown — search it.** The action list is long and
   `Do anything with AI` sits right where your click lands after a scroll. One
   `1.3` was silently built as an AI action this way. Type "direct" or "comment"
   into the dropdown's search field and click the single filtered row instead.
   The same dropdown also defaults a newly added second action to
   **`Add relationship`**, which fails Create with *"Automation fields are
   invalid"* if you forget to change it.

### J2b. Exact click path for the two folder-scoped ones

`1.1` and `1.3` sit on the **folder**, which has no ⚡ button. Two ways in, and
the second is faster when you are building several in a row:

- Hover the folder in the sidebar, click `...`, then **Automations** →
  **+ Add Automation**. The folder menu has no "Convert List to Sprint" in it, so
  it is safe to click, unlike the list menu (§E2).
- Or leave the Automations modal open and drive it from the **Manage tab's scope
  dropdown**: click the dropdown, click *its own* search field, type the folder
  name, click the folder row. Then click **Add Automation** — the first click
  after a scope change is sometimes swallowed, so watch for the builder and click
  again if nothing opened.

Either way, **read the Manage list for that folder before you build**. That is
what catches an automation someone already made.

**`1.1` — three conditions, two actions.** Add each condition with the `+` under
the previous one, and set its type from the dropdown:

| Condition | Setting |
|---|---|
| Tag | Is any of → `kpi` |
| Status | Is any of → expand **Not started** → tick **TO DO** |
| Task Name Contains | Contains → `self-review` |

Then set the action to `Update assignees` (their user), `+` a second action,
`Send direct message`, paste the §F 1.1 message with the `Task Name` and
`Task Link` chips, and pick the recipient. Name it, Create.

The status picker is the fiddly one: it opens on three collapsed groups (Not
started / Active / Closed) and `TO DO` only appears once you expand **Not
started** using the small triangle to the left of the label.

### J3. Check yourself after each copy

Open the copy and read three things before moving on. It takes ten seconds and it
is the whole difference between this working and quietly DMing the wrong person
for a quarter.

1. The **title** names the person whose folder you are in.
2. `Update assignees` names that same person.
3. `Send direct message` names that same person.

The fastest way to check 3 without opening the automation: hover the avatar in
`Send to this user` and read the profile card that pops up. It gives the full
name, role and email, so a wrong pick is obvious immediately.

---

## §K. When a message doesn't arrive

### K1. Where to look, in order

1. **The task's own Activity feed.** Anything an automation did shows up there,
   attributed to ClickUp Automations. If the feed shows nothing, the automation
   never fired, which is a trigger or condition problem. If it shows the action
   but nobody saw the message, that is a delivery or recipient problem.
2. **The task's actual status**, not its name. See §H4.
3. **The task's tags.** Empty tags mean every condition on it failed.
4. **Automations → Manage** on the folder or Space, to confirm the automation is
   still there and still enabled.

### K2. Symptom table

| What you see | Most likely cause | Fix |
|---|---|---|
| One person gets nothing, everyone else is fine | Their four per-person automations were never built | §H1, build them |
| The wrong person gets the DM | Copied automation, recipient never repointed | §H2, open it and repoint both fields |
| Nobody gets anything for a whole kind of task | The tag never landed, so every condition failed | K3 below |
| No DM when a self-review is locked | Status never became `IN PROGRESS` | §H4, check the status, then `/selftest` |
| No DM when a KPI is filed | Same, `COMPLETE` never got set | §H4 |
| Task says `Filed ✓` but status is not `COMPLETE` | Status call failed, filing itself was fine | Set the status by hand, the DM will fire |
| Editor DMed "your self-review is open" for a KPI that is already filed | `1.1` is missing its name condition | Add `Name contains self-review` (§F 1.1) |
| Several "you have something to do" DMs at filing | Tag condition removed from `1.1`, so `Focus ·` subtasks match | Put the tag condition back (§C) |
| A rater gets the "this is about you" message | Their To-do list is missing, so the Worker fell back to Peer | §F 2.1, fix the To-do list rather than the automation |
| Task is unassigned and nobody was notified natively | Name mismatch (§B3) and no `Update assignees` action | Add the action to that person's `1.1` and `2.1` |

### K2a. A condition that looks empty probably isn't

Opening an automation and seeing **`Select a tag`** where a tag chip should be
does not mean the condition is broken. The tag list loads after the rest of the
builder, and until it arrives the field renders as its placeholder and the picker
says *"No tags created"*. Wait a second and look again before changing anything.
The same applies to the avatar in `Update assignees`, which can render empty on
first paint.

This wasted real time during the build. Do not "fix" a condition on the strength
of one glance.

### K3. The tag failure is the quiet one

`clickupCreateTaskInList()` posts the task with its tags. **If ClickUp rejects
that, it deletes the tags and posts again**, so the task is created successfully
with no tags at all and nothing anywhere reports a problem:

```js
let res = await post();
if (!res.ok && payload.tags) { delete payload.tags; res = await post(); }
```

Every automation in §F filters on a tag. An untagged task therefore triggers
none of them, while the task itself looks completely normal in ClickUp. The
usual reason is the Tags ClickApp being off (§B2), and it takes out all ten
people at once rather than one, which is what makes it recognisable.

Open any recently created task. If it has no `KPI` / `Peer Appraisal` / `PIP`
tag on it, this is what happened. Turn Tags back on. Existing tasks stay
untagged, so tag them by hand or re-run the case.

### K4. What `/selftest` tells you

`GET /selftest?key=…` on the Worker checks the plumbing underneath the
automations, not the automations themselves. Three lines matter here:

- **`ClickUp · token`** — if this fails, the Worker is not creating anything at
  all, so there is nothing to trigger on.
- **`ClickUp · space`** — folder count, and how many have a To-do list. A folder
  missing its To-do list is the `2.1` fallback in §F.
- **`ClickUp · statuses`** — prints the real status names from a live list. Read
  it after anyone touches statuses. Something containing `in progress` and
  something containing `complete` have to be in that list or §A's warning has
  come true.

---

## §L. Changes that need a follow-up, and ones that don't

| What changed | What it does to the automations | What to do |
|---|---|---|
| **New editor joins** | Space three cover them, per-person four don't exist | Build their four once their first task exists (§H1) |
| **Editor leaves** | Their four keep running against a folder nobody uses | Mark them inactive in the roster, then delete the four. Keep the folder, it is the record |
| **Their ClickUp display name changes** | Nothing. Recipient and assignee pickers bind to the person, not the spelling | Nothing here. It can change whether the Worker's own name lookup resolves (§B3), which `Update assignees` is already covering |
| **Their roster name changes** | Nothing. `clickup_map` keys on the roster id, so the folder stays put | Nothing, but the folder name is now stale. Rename the folder to match if you care |
| **Their roster id changes** | The Worker treats them as a new person and builds a new folder | Avoid. If it happens, the new folder needs its own four |
| **New quarter** | Nothing. No automation conditions on `Q3-2026`, only on `KPI` / `Peer Appraisal` / `PIP` | Nothing |
| **Supervisor changes** | The three Space DMs still name the old person | Repoint the recipient on `1.2`, `3.1`, `3.2` |
| **Second supervisor added** | — | Add a second `Send direct message` action inside each of the three, not three more automations |
| **A status is renamed** | `1.2`, `1.3`, `3.2` and the Worker's status calls all break at once, silently | §A. Rename it back, or accept that the name suffix is now the only signal. Run `/selftest` |
| **A tag is renamed** | Every condition in §F fails | Don't. If it has already happened, rename it back |
| **A list is renamed** | Nothing. The automation follows the list, the Worker holds its id | Nothing |
| **A list is deleted and recreated** | `2.1` / `2.2` went with the old list. The Worker keeps posting to a dead id and task creation fails outright | Delete that person's row in `clickup_map` so the Worker rebuilds the lists, then rebuild `2.1` and `2.2` |
| **A folder is deleted** | All four go with it | Same as above, plus rebuild all four |

Deleting a `clickup_map` row is the reset button for one person. The Worker
re-creates the folder and all four lists on their next task, and re-caches the
new ids. It does not touch anything already filed.

---

## §M. Deliberately not built

So nobody goes looking for these.

- **Nothing chases anyone.** If an editor never opens their self-review, no
  reminder goes out. The DM fires once, when the task is created, and that is the
  whole nudge. The `peer_reminder` table is legacy and nothing writes to it.
- **Nothing escalates on an overdue task.** Due dates are set, but no automation
  watches them.
- **The editor is never notified about their own PIP.** §D explains why.
- **No automation writes back to the Worker.** Everything here is one direction,
  ClickUp telling a person something. No automation changes a status, a name or a
  tag that the Worker later reads, which is what keeps the two systems from
  fighting.

If chasing is wanted later, the shape is a `Due date arrives` trigger on the
`To-do` list, with the same tag conditions and a DM. It is per-person for the
same fixed-recipient reason as everything in §C, so it is another ten
automations, and it needs the tag conditions kept for the same reason as §C.
