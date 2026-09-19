# GoodDay automations for the People System

Runbook for the rules that replace ClickUp's 43.

Pairs with `CLICKUP_AUTOMATIONS.md`, which documents what is being replaced, and
with §15 of `CLAUDE.md`, which documents the code side.

---

## 0. BUILT. What is actually live, as of 2026-09-19

**All five rules exist and are enabled.** Do not build them. Read this section
before touching anything, or you will create a second set: the sections below
were written before they existed and still read as build instructions.

Open one with `https://www.goodday.work/automation/<ID>`.

| | ID | Trigger | Action required | Notification |
|---|---|---|---|---|
| P1 | `jtAquC` | Task created | Assigned to user | Assigned to user |
| P2 | `vFlgxh` | status → `Locked` | Rashy | Joshua + Rashy |
| P3 | `qps6uM` | status → `Filed` | No action required | Assigned to user |
| P4 | `D32a3j` | Task created | Assigned to user | Assigned to user |
| P5 | `Ad3FRZ` | Task created | Rashy | Joshua + Rashy |

All five are scoped to **Project → Performance Records → Apply to subfolders**,
which is what makes them reach the per-person projects underneath. Cascade is off
on all of them.

The statuses they watch, created 2026-09-19 (ids from `GET /statuses`):

```
Self review open  CaTCiL    Peer rating open  zvwRy1    PIP open    2qt2ip
Locked            0Ns2vR    Peer submitted    pQTQ8W    PIP closed  bgaCOf
Filed             lVa21x
```

### Proven live: rules DO fire on API-created tasks

Section 1 below calls this blocking and says to test it before building anything
on top. It is now tested. A KPI Scorecard task created through `POST /tasks` in a
person's project had `actionRequiredUserId` set by P1 **within 4 seconds**, and
`Assigned to user` resolved to the real assignee.

```
created sCxsk0  assignee tJJs1d
+4s  actionRequiredUserId = tJJs1d
```

So the division of labour holds: the Worker creates the task and sets the status
through the API, and a rule picks it up and sets Action Required. The thing the
API cannot write, an automation writes for it.

### The whole KPI chain, run end to end

Driven through the API exactly as the Worker drives it, against `Test Josh` as an
associate editor, in a `Test Josh` project under Performance Records:

```
KPI task created, assigned to Test Josh
  P1  +4s  action required -> Test Josh
status -> Locked
  P2  +4s  action required -> Rashy
status -> Filed
  P3  +4s  action required -> (none)
final: status "Filed", assignee Test Josh
```

The baton passes correctly at every step: editor, then supervisor, then cleared.
Forty-three ClickUp rules replaced by five, and the per-person folder structure is
no longer doing any routing work.

What is still unproven is whether Action Required also produces a **notification**
a person actually sees. That needs a human to look at their own GoodDay, and it
is why every rule now carries an explicit notification action rather than relying
on Action Required alone to be noticed. P2 fires at the Locked step and names
Joshua and Rashy, so that step is the one to check.

### Three ways the built rules differ from the spec below, and why

**P1, P4 and P5 trigger on `Task created`, not on a status.** The statuses did
not exist when the rules were built. It also happens to be better for P1 and P4:
the Worker creates the task at exactly the moment the work becomes real, so a
status round-trip would add a step and change nothing. Leave them.

**Action Required takes exactly ONE user.** The picker is single-select, no
checkboxes, unlike the notification picker which takes several. So "Action
required → Rashy, Joshua" in the P2 and P5 recipes below is not achievable.
Rashy is the single action-required user; both are on the notification. That is
the better split anyway: one person owns it, both can see it.

**`Self review open`, `Peer rating open` and `Peer submitted` are currently
unused**, because P1 and P4 fire on creation instead. They exist and are on the
workflow, but nothing sets them until something does.

### Still missing

**PIP closed has no rule.** P5 fires on `Task created`, so it covers a PIP
opening and nothing at all when one closes. ClickUp rule `3.2` has no
replacement. Adding a second trigger to P5 would also re-set Action Required to
Rashy on close, which is wrong, so this wants a sixth rule rather than an edit.

### Two traps found while building these

**Check "Apply to subfolders" on every rule.** P5 was saved with it OFF while
the other four had it on. Scoped to `Performance Records` without it, a rule
never fires, because every task lives in a person's sub-project and not in the
folder itself. It fails silently and looks exactly like a rule that is simply
not working.

**A newly added action accepts real keystrokes even on a saved rule.** The
standing note is that a saved rule's message editor rejects them. Both are true:
the distinction is the *action*, not the rule. Adding a fresh notification action
to a long-saved rule and typing its body works fine.

---

## 1. Why these are load-bearing, not optional

The obvious design is "the Worker does everything through the API and needs no
automations". That does not work, and the reason is worth stating up front so
nobody rediscovers it:

> **`actionRequiredUserId` is readable through the API but not writable.**
> Neither `POST /tasks` nor `PUT /task/:id/update` accepts it. The only related
> field is `toUserId`, which is assignment, not action required.

Action Required is the whole substitute for ClickUp's DMs, and only an automation
can set it. So the division of labour is:

| Does what | Who |
|---|---|
| Creates the task, sets the status, attaches the PDF | the Worker, via the API |
| Sets Action Required, sends the notification | a GoodDay automation, watching the status |

**This makes one question blocking.** Does a status change made *through the API*
fire an automation, or do automations only watch changes made in the UI? Every
rule below assumes it does. If it does not, the entire design collapses back to
the Worker having to nudge people some other way. Test this first, on one throwaway
task, before building five rules on top of it.

---

## 2. The statuses these rules watch

Create these on the People workspace's task workflow before building any rule. The
names matter because the rules match on them, and because `goodDaySetStatus()`
matches case-insensitively **by substring** from the Worker side.

| Status | Means | Whose turn |
|---|---|---|
| `Self review open` | KPI case opened, editor has not locked | editor |
| `Locked` | editor locked, supervisor has not scored | supervisor |
| `Filed` | supervisor filed, PDF attached | nobody, it is done |
| `Peer rating open` | a peer assignment exists for this rater | rater |
| `Peer submitted` | that rating is in | nobody |
| `PIP open` | plan is live, check-ins running | supervisor |
| `PIP closed` | verdict recorded | nobody |

Do not reuse an existing org-shared status for these. Create new ones. Editing a
shared status changes it for every other project that uses it.

---

## 3. The rules

Five rules replace forty three. The collapse is entirely because GoodDay
notifications can target **Assigned to user**, which ClickUp's "send direct
message" could not — that single limitation is why ClickUp needed one rule per
person per event, and ten editor folders to hang them on.

A new hire needs **no new rule**. That is the whole point.

### P1 — Self review opened

| | |
|---|---|
| **Trigger** | Task status changed to `Self review open` |
| **Scope** | People workspace |
| **Condition** | Task type is `KPI` |
| **Action 1** | Action required → **Assigned to user** |
| **Action 2** | Notification → **Assigned to user** |
| **Message** | `Your KPI self review is open. Open the task and use your personal link. Locking is final for your side.` |
| **Replaces** | ten copies of ClickUp rule `1.1` |

### P2 — Locked, awaiting supervisor

| | |
|---|---|
| **Trigger** | Task status changed to `Locked` |
| **Scope** | People workspace |
| **Condition** | Task type is `KPI` |
| **Action 1** | Action required → **Rashy**, **Joshua** (named) |
| **Action 2** | Notification → the same two |
| **Message** | `A KPI self review is locked and waiting for supervisor scoring.` |
| **Replaces** | ClickUp rule `1.2` |

Named recipients here, not "assigned to user", because the task stays assigned to
the editor while the supervisor acts on it. The recipient list is the one place a
new supervisor means editing a rule.

### P3 — Filed

| | |
|---|---|
| **Trigger** | Task status changed to `Filed` |
| **Scope** | People workspace |
| **Condition** | Task type is `KPI` |
| **Action 1** | Notification → **Assigned to user** |
| **Action 2** | Action required → **No action required** |
| **Message** | `Your KPI result is filed. The scorecard is attached to this task.` |
| **Replaces** | ten copies of ClickUp rule `1.3` |

Clearing Action Required matters. Leaving it set means the badge never goes away
and people learn to ignore it.

### P4 — Peer rating assigned

| | |
|---|---|
| **Trigger** | Task status changed to `Peer rating open` |
| **Scope** | People workspace |
| **Condition** | Task type is `Peer` |
| **Action 1** | Action required → **Assigned to user** |
| **Action 2** | Notification → **Assigned to user** |
| **Message** | `You have a peer appraisal to complete. The link knows who you are rating. Your rating is anonymous.` |
| **Replaces** | twenty copies of ClickUp rules `2.1` and `2.2` |

One task per (rater, target, cycle), so one assignee per task, so one rule covers
every rater and every target forever.

### P5 — PIP opened or closed

| | |
|---|---|
| **Trigger** | Task status changed to `PIP open` **or** `PIP closed` |
| **Scope** | People workspace |
| **Condition** | Task type is `PIP` |
| **Action** | Notification → **Rashy**, **Joshua** |
| **Message** | `A PIP case changed state. Open the task for the current position.` |
| **Replaces** | ClickUp rules `3.1` and `3.2` |

The status trigger is multi-select, so one rule covers both transitions. That is
the same trick that let DL2 replace three twin rules on the Production board.

**Deliberately no notification body token for which state it moved to.** GoodDay
notification bodies carry only Task, Task title, Project and Task links — no status
and no date tokens. Asking someone to open the task is honest; inventing a body
that implies more than it knows is not.

---

## 4. Traps, all of which have already cost time once

These are carried from the ClickUp build and the Production board build. Every one
of them is a thing that looked fine and was not.

1. **Never press Escape in the automation builder.** It closes the dialog and
   discards the rule. Dismiss a dropdown by clicking empty modal space instead.
2. **A new rule's message editor accepts real keystrokes. A saved one does not.**
   Type the body when you first create the rule. Changing it later needs
   `editor.update()`.
3. **Editing a rule moves it to the END of the evaluation order.** None of the five
   above depend on ordering, but if that ever changes, re-save all of them in order
   after touching any one.
4. **Cascade Automations is OFF by default.** Chained rules save, look correct, and
   never run. If P3 is ever made to trigger something else, this is why it does not
   fire.
5. **The automation field picker is not scoped to the project.** A rule that
   references a custom field which is not attached to the project will save happily
   and never fire.
6. **Verify after every save.** Re-open the rule list and confirm. The dialog
   staying open is not a failure signal, and a save can genuinely fail.
7. **The automation clock runs about 14 hours behind Jakarta.** Irrelevant for these
   five, which are all event-driven, but it matters the moment anything is scheduled.
8. **Read the existing rule list before building.** Two pre-existing rules nearly
   became duplicates during the ClickUp build, which would have notified people twice
   on every event.
9. **Hover a named recipient's avatar to confirm who it is before saving.** The
   picker clears itself on click more often than you would expect.

---

## 5. Build order

1. Test the blocking question in §1 on one throwaway task. Change a status through
   the API and see whether a trivial automation fires. **Stop here if it does not.**
2. Create the seven statuses in §2.
3. Build P1. Test it end to end with one real editor before building anything else,
   because P1 proves the pattern that P3 and P4 reuse.
4. Build P2, P3, P4, P5.
5. Re-open each one and confirm it saved as intended.
6. Only then point the Worker at GoodDay for KPI.

---

## 6. What is not here yet

**Hiring** gets its own rules once that workflow is designed: a public form
submission creating an applicant task, stage transitions, and a notification when
someone needs to screen. Not written because the stages do not exist yet.

**Reminders** for an unlocked self review or an overdue peer rating. ClickUp had
none either. Worth adding once the five above are proven, as a scheduled rule, and
that is where the 14-hour clock offset in §4 starts to matter.
