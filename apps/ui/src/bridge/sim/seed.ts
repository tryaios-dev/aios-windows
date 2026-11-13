/** Browser preview only: sample workspace from the design handover. Never reaches the desktop app. */
import type {
  Checkpoint,
  Classification,
  Conversation,
  EvidenceEvent,
  EvidenceStream,
  EventType,
  InstalledModel,
  Message,
  Project,
  ProviderType,
  Summary,
} from '@/lib/types'
import { hashHex, ZERO_HASH } from '@/lib/hash'
import { SIM_CATALOGUE as CATALOGUE } from './catalogue'
import { pickAnswer, summaryFor } from './answers'

/* ------------------------------------------------------------------ */
/* Time helpers: everything is relative to "now" so the data reads     */
/* naturally whenever the prototype is opened.                         */
/* ------------------------------------------------------------------ */

const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const ago = (ms: number) => new Date(NOW - ms).toISOString()

/* Calendar dates inside sample conversations follow "now" too, so a plan never points at a date long past. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const shortDay = (d: Date) => `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
const longDay = (d: Date) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`

/** The handbook goes live on the first Monday at least seventeen days from now. */
const HANDBOOK_LIVE = (() => {
  let d = addDays(new Date(NOW), 17)
  while (d.getDay() !== 1) d = addDays(d, 1)
  return d
})()
const live = (offset: number) => shortDay(addDays(HANDBOOK_LIVE, offset))

/* ------------------------------------------------------------------ */
/* Models                                                               */
/* ------------------------------------------------------------------ */

// The sample installation has the Standard and the Light AI model of the catalogue.
const qwen8 = CATALOGUE.find((e) => e.tier === 'medium')!
const qwen4 = CATALOGUE.find((e) => e.tier === 'small')!

export const SEED_INSTALLED_MODELS: InstalledModel[] = [
  {
    id: qwen8.entry_id,
    catalogue_entry_id: qwen8.entry_id,
    name: qwen8.name,
    file_path: `%LOCALAPPDATA%\\AIOS\\models\\${qwen8.file_name}`,
    artifact_digest: qwen8.artifact_digest,
    size_bytes: qwen8.size_bytes,
    context_length: qwen8.context_length,
    licence: qwen8.licence,
    tier: qwen8.tier,
    installed_at: ago(19 * DAY + 2 * HOUR),
    source: 'download',
  },
  {
    id: qwen4.entry_id,
    catalogue_entry_id: qwen4.entry_id,
    name: qwen4.name,
    file_path: `%LOCALAPPDATA%\\AIOS\\models\\${qwen4.file_name}`,
    artifact_digest: qwen4.artifact_digest,
    size_bytes: qwen4.size_bytes,
    context_length: qwen4.context_length,
    licence: qwen4.licence,
    tier: qwen4.tier,
    installed_at: ago(12 * DAY + 5 * HOUR),
    source: 'offline',
  },
]

/* ------------------------------------------------------------------ */
/* Projects                                                             */
/* ------------------------------------------------------------------ */

const P = {
  workspace: 'f3a1c2d4-7e8b-4a9c-8d1e-2f3a4b5c6d70',
  harbourline: 'a8b7c6d5-4e3f-4a2b-9c1d-0e9f8a7b6c51',
  handbook: 'c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e52',
  blogWorking: 'e5f6a7b8-9c0d-4e1f-a2b3-c4d5e6f7a803',
  blog: 'b9c8d7e6-f5a4-4b3c-9d2e-1f0a9b8c7d64',
  q3: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f75',
}

export const SEED_PROJECTS: Project[] = [
  {
    id: P.workspace,
    name: 'My workspace',
    classification: 'restricted',
    classification_source: 'project',
    company_ai_enabled: false,
    archived: false,
    created_at: ago(19 * DAY + 2 * HOUR),
    updated_at: ago(40 * MIN),
  },
  {
    id: P.harbourline,
    name: 'Harbourline lease review',
    classification: 'restricted',
    classification_source: 'project',
    company_ai_enabled: false,
    archived: false,
    created_at: ago(14 * DAY + 3 * HOUR),
    updated_at: ago(3 * HOUR),
  },
  {
    id: P.handbook,
    name: 'Team handbook',
    classification: 'internal',
    classification_source: 'project',
    company_ai_enabled: false,
    archived: false,
    created_at: ago(11 * DAY),
    updated_at: ago(20 * HOUR - 7 * MIN),
  },
  {
    id: P.blogWorking,
    name: 'Launch post (working)',
    classification: 'restricted',
    classification_source: 'project',
    company_ai_enabled: false,
    archived: false,
    created_at: ago(8 * DAY),
    updated_at: ago(2 * DAY + 6 * HOUR),
  },
  {
    id: P.blog,
    name: 'Launch post (public draft)',
    classification: 'public',
    classification_source: 'review',
    derived_from_project_id: P.blogWorking,
    company_ai_enabled: false,
    archived: false,
    created_at: ago(2 * DAY + 5 * HOUR),
    updated_at: ago(2 * DAY + 1 * HOUR),
  },
  {
    id: P.q3,
    name: 'Q3 planning',
    classification: 'internal',
    classification_source: 'project',
    company_ai_enabled: false,
    archived: true,
    created_at: ago(17 * DAY),
    updated_at: ago(9 * DAY),
  },
]

/* ------------------------------------------------------------------ */
/* Conversations and messages                                           */
/* ------------------------------------------------------------------ */

interface Turn {
  q: string
  a?: string
  status?: Message['status']
  gap?: number
}

interface ConvSpec {
  id: string
  project: string
  title: string
  model: string
  start: number
  turns: Turn[]
  archived?: boolean
  summary?: boolean
}

const C = {
  welcome: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c01',
  northgate: '1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d02',
  notes: '2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e03',
  breakClause: '3d4e5f6a-7b8c-4d9e-9f0a-1b2c3d4e5f04',
  rentReview: '4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a05',
  checklist: '5f6a7b8c-9d0e-4f1a-9b2c-3d4e5f6a7b06',
  onboarding: '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c07',
  expenses: '7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d08',
  conduct: '8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e09',
  headlines: '9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f10',
  explainer: 'ae1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a11',
  headlinesPublic: 'bf2a3b4c-5d6e-4f7a-9b8c-9d0e1f2a3b12',
  checksum: 'c03b4c5d-6e7f-4a8b-8c9d-0e1f2a3b4c13',
  q3Risks: 'd14c5d6e-7f8a-4b9c-9d0e-1f2a3b4c5d14',
  archivedNotes: 'e25d6e7f-8a9b-4c0d-8e1f-2a3b4c5d6e15',
  cleaningQuotes: 'f36e7f8a-9b0c-4d1e-9f2a-3b4c5d6e7f16',
  handbookRollout: 'a47f8a9b-0c1d-4e2f-8a3b-4c5d6e7f8a17',
}

const HEADLINES_QUESTION =
  'Give me ten headline options for a blog post launching AIOS, a private AI that runs on your own computer so nothing you type leaves it. Group them by angle and tell me your pick.'

const SPECS: ConvSpec[] = [
  {
    id: C.welcome,
    project: P.workspace,
    title: 'Getting started',
    model: qwen8.entry_id,
    start: 19 * DAY + 1 * HOUR,
    turns: [
      { q: 'Hello. What can you do in this version?' },
      {
        q: 'Where can I read more about the AI model and the software you run on?',
        gap: 4 * MIN,
      },
    ],
  },
  {
    id: C.northgate,
    project: P.workspace,
    title: 'Reply to the Northgate tender question',
    model: qwen8.entry_id,
    start: 2 * DAY + 3 * HOUR,
    turns: [
      {
        q: 'Draft a reply to Northgate. They asked in question 4 whether on-site support is included after go-live. We offer 90 days on site with a named engineer and a 4-hour response, then standard service desk under section 6.2. Extra on-site days at the Appendix B rate. Keep it short, addressed to Ms Okafor, from Daniel.',
      },
      {
        q: 'Good. Make the second paragraph slightly warmer without adding length.',
        gap: 3 * MIN,
        a: `Here's the second paragraph with a warmer tone and the same length:

> After the 90 days, support continues through our service desk under the terms in section 6.2, and we'd be glad to extend the on-site period at the day rate in Appendix B if that suits your rollout.

The change is small: "moves to" became "continues through", and "happy to" became "glad to", which reads as an offer rather than a concession.`,
      },
    ],
  },
  {
    id: C.notes,
    project: P.workspace,
    title: 'Summarise planning meeting notes',
    model: qwen8.entry_id,
    start: 40 * MIN,
    turns: [
      {
        q: `Summarise these notes into decisions, actions with owners, open questions and parked items.

Planning meeting 14 Oct. Present: Priya, Tom, Daniel, Lena. Pilot: start 3 Nov. Ten people invited, two laptops are too old to take part, so eight for now. Priya to ask IT for two replacements by 21 Oct. Check-ins: weekly, moving to Tuesday mornings. Tom sends the data-handling rules to everyone taking part by 24 Oct. Daniel drafts the week-one feedback form by 28 Oct. Training guide: printed copies vs a shared folder, IT wants the shared folder, Tom thinks some people won't find it. Nobody keeps the list of problems yet. Everyone asked about a mobile app again. Later phase, note it.`,
      },
    ],
  },
  {
    id: C.cleaningQuotes,
    project: P.workspace,
    title: 'Compare three cleaning quotes',
    model: qwen8.entry_id,
    start: 1 * DAY + 6 * HOUR,
    turns: [
      {
        q: `I have three quotes for cleaning our office (14 desks, one kitchen, two meeting rooms). Compare them and tell me which you would pick. We care most about reliability and not being tied in for long.

Brightside Cleaning: £640 a month. Three visits a week, evenings. Kitchen and bins included, inside windows once a month. Cleaning products included. 12-month contract, 90 days notice.

Kestrel Facilities: £585 a month. Two visits a week. Kitchen and bins included, windows extra at £45 a visit. We supply the cleaning products. Rolling monthly contract, 30 days notice.

Marlow & Daughters: £710 a month. Three visits a week, early mornings, the same two cleaners each time. Kitchen, bins and inside windows once a month. Products included. Six-month contract, then rolling with 30 days notice. They cover holidays with their own staff.`,
        a: `Here are the three side by side. A month is about 13 visits at three a week, and about 9 at two a week.

| | Brightside Cleaning | Kestrel Facilities | Marlow & Daughters |
| --- | --- | --- | --- |
| Price a month | £640 | £585 | £710 |
| Visits a week | 3, evenings | 2 | 3, early mornings |
| Cost per visit | about £49 | about £67 | about £55 |
| Windows | Included, monthly | £45 extra each time | Included, monthly |
| Cleaning products | Included | You supply them | Included |
| Tied in for | 12 months | Nothing, monthly | 6 months |
| Notice to leave | 90 days | 30 days | 30 days after month six |
| Same cleaners each visit | Not stated | Not stated | Yes, the same two |
| Holiday cover | Not stated | Not stated | Their own staff |

**My pick: Marlow & Daughters.**

You said reliability and not being tied in matter most, and they are the only one that answers both. The same two cleaners and their own holiday cover are the things that decide whether a cleaning contract works in practice, and after six months you can leave with 30 days notice. The price for that is £70 a month more than Brightside, or £840 a year.

**Why not the others**

- **Brightside** is the best value per visit, but twelve months with 90 days notice is the opposite of what you asked for. If the service slips in month three you are paying for another nine.
- **Kestrel** looks cheapest, but it is two visits, not three. Add monthly windows (£45) and your own products and it is close to £640 for a third less cleaning. It is the right choice only if two visits a week is enough.

**Before you sign**

1. Ask Marlow & Daughters whether they would do £675 a month for the six-month term. They have room to move and you are offering a commitment.
2. Ask all three what happens when a visit is missed: a credit, or an extra visit.
3. Check each has public liability insurance, and ask who holds the keys.`,
      },
      {
        q: 'Write two or three lines to Marlow & Daughters asking if they would do £675 a month if we sign for the six months.',
        gap: 4 * MIN,
        a: `Short and direct, with the commitment up front:

> Hello,
>
> Thank you for your quote for our office. We would like to go ahead with you and are happy to sign for the six months. Could you do £675 a month on that basis? If so, we can confirm this week and start from the first Monday of next month.
>
> Kind regards,  
> Daniel

If they say no, £710 is still the one I would choose. You could ask for a second window clean each month in place of the discount.`,
      },
    ],
  },
  {
    id: C.breakClause,
    project: P.harbourline,
    title: 'Break clause wording',
    model: qwen8.entry_id,
    start: 14 * DAY + 2 * HOUR,
    turns: [
      {
        q: 'In the Harbourline draft lease, clause 14 is the break clause. It says the tenant may break on the fifth anniversary with six months notice "provided all sums due have been paid and vacant possession is given". Clause 22 covers how notices are served. What should I push back on?',
      },
      {
        q: 'Draft the replacement wording for 14.1 with the narrowed conditions.',
        gap: 6 * MIN,
        a: `Suggested replacement for clause 14.1:

> **14.1** The Tenant may determine this Lease on the Break Date by giving the Landlord not less than six months' written notice served in accordance with clause 22. The notice shall be effective provided that, on the Break Date, (a) the Principal Rent reserved by this Lease has been paid up to and including the Break Date, and (b) the Tenant has given up occupation of the Premises leaving no person in occupation and no continuing subleases. For the avoidance of doubt, the Tenant's right to determine shall not be affected by any breach of any other covenant or by any sums other than the Principal Rent being outstanding.

Three deliberate choices in that wording:

1. **Principal Rent only.** Service charge, insurance rent and interest are excluded from the condition.
2. **"Given up occupation"** rather than "vacant possession". It avoids the argument over leftover furniture or a partition wall.
3. **An express carve-out** for other breaches, so a minor repairing breach can't be used to defeat the break.

Expect the landlord to resist (3). A fallback is to keep the carve-out but add "material" before "breach" in a separate condition.`,
      },
    ],
  },
  {
    id: C.rentReview,
    project: P.harbourline,
    title: 'Rent review timeline',
    model: qwen8.entry_id,
    start: 10 * DAY + 5 * HOUR,
    turns: [
      {
        q: `Here are clauses 6 and 7 from the Harbourline draft. Walk me through the rent review timeline if the lease starts on 1 March 2027, and tell me anything I should raise.

6.1 The Principal Rent shall be reviewed on the fifth anniversary of the Term Commencement Date (the "Review Date").
6.2 The reviewed rent shall be the higher of the Principal Rent payable immediately before the Review Date and the Open Market Rent on the Review Date.
6.3 The Landlord may serve a review notice specifying the proposed rent not earlier than six months before the Review Date.
6.4 The Tenant may serve a counter-notice within two months of receipt of the review notice. Failure to serve a counter-notice shall not be deemed acceptance of the proposed rent.
7.1 If the reviewed rent has not been agreed by the Review Date, either party may require it to be determined by an arbitrator appointed by agreement or, failing agreement, by the President of the Royal Institution of Chartered Surveyors.`,
      },
    ],
  },
  {
    id: C.checklist,
    project: P.harbourline,
    title: 'Checklist before signing',
    model: qwen8.entry_id,
    start: 3 * DAY + 4 * HOUR,
    summary: true,
    turns: [
      {
        q: 'Give me a checklist of what to confirm before we sign the Harbourline lease. It is a ten-year office lease. Already on my mind: the service charge cap, the break clause conditions, and whether we are allowed to hold evening events.',
      },
      {
        q: 'Add a line about the schedule of condition. We photographed everything on 9 October.',
        gap: 5 * MIN,
        a: `Added under **Practical**:

- [ ] Schedule of condition: the photographs taken on 9 October attached to the lease as a schedule, with the landlord's solicitor confirming receipt in writing

Worth doing before signature rather than after: a schedule that isn't formally attached is much harder to rely on at the end of the term.`,
      },
      {
        q: 'What is the stamp duty position if the annual rent is £84,000 and the term is ten years?',
        gap: 22 * MIN,
        a: `For a ten-year lease at £84,000 a year, stamp duty land tax is charged on the **net present value (NPV)** of the rent, not on the total.

Rough calculation (England, non-residential rates):

- NPV of £84,000 a year over 10 years at the statutory 3.5% discount: about **£698,000**
- 0% on the first £150,000
- 1% on £150,001 to £5,000,000: 1% of £548,000 = **£5,480**

So roughly **£5,500**, payable within 14 days of the effective date. If there's a premium or a rent-free period the figure changes, and the first five years' rent is what drives the NPV, so confirm the rent review mechanism doesn't count as a variable rent for this purpose.

This is an estimate to plan around, not advice to rely on; have the figure checked before the return is filed.`,
      },
      {
        q: 'Thanks. Is the 1% band right for this year?',
        gap: 3 * HOUR,
        a: `For non-residential leases in England the rent NPV bands have been 0% up to £150,000 and 1% from £150,001 to £5,000,000, with 2% above that. I don't have access to anything after my training date, so if a Budget has changed the thresholds since then I wouldn't know. The safest step is to run the figures through the official calculator on the day the return is prepared.`,
      },
    ],
  },
  {
    id: C.onboarding,
    project: P.handbook,
    title: 'Onboarding: week one',
    model: qwen8.entry_id,
    start: 11 * DAY - 1 * HOUR,
    turns: [{ q: 'Plan a first week for a new starter that leaves time to actually do something.' }],
  },
  {
    id: C.expenses,
    project: P.handbook,
    title: 'Expenses policy rewrite',
    model: qwen8.entry_id,
    start: 6 * DAY + 2 * HOUR,
    turns: [
      {
        q: `Rewrite this section of our expenses policy in plain language. Keep every rule the same.

Employees shall be entitled to reimbursement of reasonable expenses wholly, exclusively and necessarily incurred in the performance of their duties, subject to the submission of a valid receipt in respect of each item claimed within thirty (30) days of the expense being incurred. Accommodation shall not exceed £140 per night within the United Kingdom or £180 per night elsewhere. Subsistence shall not exceed £35 per day. Alcohol, fines and penalties, and class-of-travel upgrades shall not be reimbursed. Mileage is payable at the rates published by HMRC from time to time. Approved claims shall be paid with the next available payroll run, at the company's absolute discretion.`,
      },
    ],
  },
  {
    id: C.conduct,
    project: P.handbook,
    title: 'Code of conduct FAQ',
    model: qwen4.entry_id,
    start: 1 * DAY + 2 * HOUR,
    turns: [
      { q: 'Write three honest FAQ answers for the code of conduct: does it apply outside work, what happens when I report something, what if I am not sure.' },
    ],
  },
  {
    id: C.handbookRollout,
    project: P.handbook,
    title: 'Handbook rollout plan',
    model: qwen8.entry_id,
    start: 20 * HOUR,
    turns: [
      {
        q: `We want the new team handbook in front of all 34 staff by ${longDay(HANDBOOK_LIVE)}. Turn that into a plan with owners and dates.

People: me (Daniel) for the text, Priya for HR sign-off, Tom for the intranet page, Lena for the two briefing sessions.
Where we are: expenses and the code of conduct are written. Onboarding needs one more read-through. Nothing is on the intranet yet.`,
        a: `Here is the plan, working back from ${longDay(HANDBOOK_LIVE)}.

| When | Step | Owner |
| --- | --- | --- |
| ${live(-12)} | Finish the read-through of the onboarding section | Daniel |
| ${live(-10)} | Send the complete text to Priya for sign-off | Daniel |
| ${live(-6)} | HR sign-off, with any changes marked | Priya |
| ${live(-5)} | Make Priya's changes and freeze the text | Daniel |
| ${live(-4)} | Build the intranet page and check every link | Tom |
| ${live(-3)} | Tell managers what is changing, so they hear it first | Daniel |
| ${live(-3)} | Book rooms and send invitations for both briefing sessions | Lena |
| ${live(0)} | Handbook goes live. Email all 34 staff with the link | Tom publishes, Daniel sends |
| ${live(1)} | Briefing session one | Lena |
| ${live(3)} | Briefing session two, for anyone who missed the first | Lena |
| ${live(11)} | Check who has not opened it and follow up | Priya |

**Where it could slip**

- **Sign-off is the narrow point.** Priya has three working days. If her changes are large, the freeze on ${live(-5)} moves and Tom loses his day to build the page.
- **The intranet page has one day.** Ask Tom to set up the empty page this week so only the text is left to add.

**What I left out**

Printing. If anyone needs a paper copy, add it after the text is frozen so nothing is printed twice.`,
      },
      {
        q: `Priya is on leave from ${live(-7)} to ${live(-3)}. What has to move?`,
        gap: 9 * MIN,
        a: `Only the first three steps move, and they all move earlier. Everything from the freeze onwards stays where it is.

| Step | Was | Now | Owner |
| --- | --- | --- | --- |
| Finish the onboarding read-through | ${live(-12)} | ${live(-13)} | Daniel |
| Send the complete text to Priya | ${live(-10)} | ${live(-12)} | Daniel |
| HR sign-off | ${live(-6)} | ${live(-10)} | Priya |

That gives Priya two working days before she goes, which is tight for a whole handbook. Two ways to make it easier:

1. Send her the expenses and code of conduct sections today, since they are finished, so only onboarding is left for the last two days.
2. Ask her to name someone who can approve small wording changes while she is away. Then a late correction does not have to wait until the morning the handbook goes live.`,
      },
    ],
  },
  {
    id: C.headlines,
    project: P.blogWorking,
    title: 'Headline options',
    model: qwen8.entry_id,
    start: 8 * DAY - 2 * HOUR,
    turns: [{ q: HEADLINES_QUESTION }],
  },
  {
    id: C.explainer,
    project: P.blogWorking,
    title: 'Plain-English explainer on local models',
    model: qwen8.entry_id,
    start: 5 * DAY + 3 * HOUR,
    turns: [{ q: 'Explain in plain English what it means to run a local model, for a reader who has only used ChatGPT.' }],
  },
  {
    id: C.headlinesPublic,
    project: P.blog,
    title: 'Headline options',
    model: qwen8.entry_id,
    start: 8 * DAY - 2 * HOUR,
    turns: [{ q: HEADLINES_QUESTION }],
  },
  {
    id: C.checksum,
    project: P.workspace,
    title: 'Checksum script for model files',
    model: qwen8.entry_id,
    start: 4 * DAY + 7 * HOUR,
    turns: [
      { q: 'Write a small Python script that prints the SHA-256 of every .gguf file in a models folder, without loading whole files into memory.' },
    ],
  },
  {
    id: C.q3Risks,
    project: P.q3,
    title: 'Q3 risks list',
    model: qwen4.entry_id,
    start: 16 * DAY,
    turns: [
      {
        q: 'List the main delivery risks for Q3 and one line on how to reduce each. What we have: two developers, a twelve-week build, a pilot with 5 to 10 people inside the company, and contracts frozen for the first six weeks.',
        a: `Five risks, each with one thing to do about it.

| Risk | Why it matters here | How to reduce it |
| --- | --- | --- |
| Only two developers | If one is ill or leaves, half the build stops | Have both work on the two hardest parts, so either can carry on alone |
| No slack in twelve weeks | Any surprise pushes the pilot out of the quarter | Plan ten weeks of work and keep two in reserve |
| Contracts frozen until week 7 | Anything that needs a new supplier cannot start in the first half | List what needs a contract now and have it ready to sign in week 7 |
| A small pilot | With 5 to 10 people, one bad experience looks like a pattern | Pick people from at least three teams and agree the questions before it starts |
| The list of features growing | New requests arrive as soon as people see it working | Keep one written list of what is in. Anything new waits for the next quarter |

The one I would watch first is the contract freeze. It is the only risk with a fixed date, and it is cheap to prepare for now and expensive to discover in week 7.`,
      },
    ],
  },
  {
    id: C.archivedNotes,
    project: P.workspace,
    title: 'Old notes from the kickoff',
    model: qwen4.entry_id,
    start: 12 * DAY + 4 * HOUR,
    archived: true,
    turns: [
      {
        q: 'Tidy these kickoff notes into something I can paste into an email: kickoff on 7 Oct, agreed two developers, twelve weeks, pilot of 5 to 10 people inside the company, contracts frozen in weeks 1 to 6.',
        a: `**Kickoff, 7 October: what we agreed**

- **Team:** two developers.
- **Length:** twelve weeks.
- **Pilot:** 5 to 10 people inside the company.
- **Contracts:** frozen in weeks 1 to 6, so anything that needs a new supplier starts in week 7 at the earliest.

The notes do not mention actions or owners. If there were any, tell me and I'll add them as a short list underneath.`,
      },
    ],
  },
]

const projectById = Object.fromEntries(SEED_PROJECTS.map((p) => [p.id, p]))

function classOf(projectId: string): Classification {
  return projectById[projectId].classification
}

function classSourceOf(projectId: string): Project['classification_source'] {
  return projectById[projectId].classification_source === 'review' ? 'review' : 'project'
}

export const SEED_CONVERSATIONS: Conversation[] = []
export const SEED_MESSAGES: Message[] = []
export const SEED_SUMMARIES: Summary[] = []

let msgCounter = 0
function mid(convId: string) {
  msgCounter += 1
  return `${convId.slice(0, 8)}-m${String(msgCounter).padStart(3, '0')}`
}

for (const spec of SPECS) {
  let t = NOW - spec.start
  let last = ''
  const cls = classOf(spec.project)
  const src = classSourceOf(spec.project)
  const provider: ProviderType = 'local'

  for (const turn of spec.turns) {
    if (turn.gap) t += turn.gap
    const userId = mid(spec.id)
    SEED_MESSAGES.push({
      id: userId,
      conversation_id: spec.id,
      role: 'user',
      content: turn.q,
      classification_effective: cls,
      classification_source: src,
      status: 'complete',
      provider,
      model_id: spec.model,
      prompt_tokens: 0,
      completion_tokens: 0,
      created_at: new Date(t).toISOString(),
    })
    t += 9_000
    const answer = turn.a ?? pickAnswer(turn.q)
    SEED_MESSAGES.push({
      id: mid(spec.id),
      conversation_id: spec.id,
      role: 'assistant',
      content: answer,
      classification_effective: cls,
      classification_source: src,
      status: turn.status ?? 'complete',
      provider,
      model_id: spec.model,
      prompt_tokens: Math.ceil(turn.q.length / 3.5) + 180,
      completion_tokens: Math.ceil(answer.length / 3.5),
      created_at: new Date(t).toISOString(),
    })
    last = answer
    t += 20_000
  }

  if (spec.summary) {
    const msgs = SEED_MESSAGES.filter((m) => m.conversation_id === spec.id)
    const covers = msgs[Math.max(0, msgs.length - 5)]
    SEED_SUMMARIES.push({
      id: `${spec.id.slice(0, 8)}-s001`,
      conversation_id: spec.id,
      covers_until_message_id: covers.id,
      content: summaryFor(spec.title),
      classification_effective: cls,
      classification_source: src,
      model_id: spec.model,
      provider,
      created_at: new Date(t - 10_000).toISOString(),
    })
  }

  SEED_CONVERSATIONS.push({
    id: spec.id,
    project_id: spec.project,
    title: spec.title,
    classification_effective: cls,
    classification_source: src,
    provider_mode: 'local',
    current_provider: 'local',
    model_id: spec.model,
    archived: !!spec.archived,
    created_at: new Date(NOW - spec.start).toISOString(),
    updated_at: new Date(t - 20_000).toISOString(),
    last_message_preview: last.replace(/[#*`>|\-\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140),
  })
}

/* ------------------------------------------------------------------ */
/* Evidence stream (Evidence Wire Format v1)                            */
/* ------------------------------------------------------------------ */

export const SEED_STREAM: EvidenceStream = {
  stream_id: 'c7e1a4f09b3d4e2a8f6c1b5d9e3a7c20',
  device_id: 'win-7f3a9c2e',
  epoch: 1,
  signer_key_id: hashHex('signer-key-epoch-1'),
  created_at: ago(19 * DAY + 2 * HOUR),
}

interface Draft {
  ts: number
  type: EventType
  actor: EvidenceEvent['actor']
  project_id?: string
  conversation_id?: string
  provider?: ProviderType
  model_digest?: string
  input?: string
  output?: string
  payload?: EvidenceEvent['payload']
}

const drafts: Draft[] = []
const installT = NOW - (19 * DAY + 2 * HOUR)

drafts.push({ ts: installT, type: 'install', actor: 'app', payload: { app_version: '0.9.4', installer: 'Setup.exe' } })
drafts.push({ ts: installT + 70_000, type: 'store_created', actor: 'app', payload: { schema_version: 7 } })
drafts.push({ ts: installT + 72_000, type: 'recovery_package_written', actor: 'app', payload: { package_version: 1 } })
drafts.push({ ts: installT + 73_000, type: 'recovery_key_issued', actor: 'app' })
drafts.push({
  ts: installT + 9 * MIN,
  type: 'model_installed',
  actor: 'user',
  model_digest: qwen8.artifact_digest,
  payload: { entry_id: qwen8.entry_id, source: 'download', size_bytes: qwen8.size_bytes },
})
drafts.push({ ts: installT + 10 * MIN, type: 'project_created', actor: 'app', project_id: P.workspace, payload: { classification: 'restricted', default: true } })

for (const p of SEED_PROJECTS) {
  if (p.id === P.workspace) continue
  drafts.push({
    ts: new Date(p.created_at).getTime(),
    type: p.derived_from_project_id ? 'project_reclassified' : 'project_created',
    actor: 'user',
    project_id: p.id,
    payload: p.derived_from_project_id
      ? { from_class: 'restricted', to_class: p.classification, derived_from_project_id: p.derived_from_project_id, reviewed_copy: true }
      : { classification: p.classification },
  })
}

drafts.push({
  ts: NOW - (12 * DAY + 5 * HOUR),
  type: 'model_installed',
  actor: 'user',
  model_digest: qwen4.artifact_digest,
  payload: { entry_id: qwen4.entry_id, source: 'offline', size_bytes: qwen4.size_bytes },
})

for (const m of SEED_MESSAGES) {
  if (m.role !== 'assistant') continue
  const conv = SEED_CONVERSATIONS.find((c) => c.id === m.conversation_id)!
  const entry = CATALOGUE.find((e) => e.entry_id === m.model_id)!
  drafts.push({
    ts: new Date(m.created_at).getTime(),
    type: 'request',
    actor: 'user',
    project_id: conv.project_id,
    conversation_id: conv.id,
    provider: 'local',
    model_digest: entry.artifact_digest,
    input: `ctx:${m.id}`,
    output: m.content,
    payload: { prompt_tokens: m.prompt_tokens, completion_tokens: m.completion_tokens, runtime: 'llama-server b6471 vulkan' },
  })
}

drafts.push({
  ts: NOW - (2 * DAY + 1 * HOUR),
  type: 'export',
  actor: 'user',
  project_id: P.blog,
  payload: { kind: 'project_package', package_version: 1, file_name: 'launch-post-public-draft.aiosproj' },
})

// The backups Home and Settings report: the latest three days ago, the one before a week earlier.
for (const d of [10, 3]) {
  drafts.push({
    // The same moment Home and Settings give for the last backup; it sorts ahead of that day's closing entry.
    ts: NOW - d * DAY - 2 * HOUR,
    type: 'export',
    actor: 'user',
    payload: { kind: 'backup', size_bytes: d === 3 ? 23_600_000 : 21_900_000, conversations: SEED_CONVERSATIONS.filter((c) => new Date(c.created_at).getTime() < NOW - d * DAY).length, models_included: false },
  })
}

// The sample library in My secure knowledge (src/data/knowledge.ts) and the one added skill.
drafts.push({ ts: NOW - (9 * DAY + 3 * HOUR), type: 'knowledge_added', actor: 'user', payload: { documents: 4, could_not_read: 1, collection: 'Client contracts', size_bytes: 6_888_000 } })
drafts.push({ ts: NOW - (6 * DAY + 5 * HOUR), type: 'knowledge_added', actor: 'user', payload: { documents: 2, could_not_read: 0, collection: 'Team handbook', size_bytes: 3_254_000 } })
drafts.push({ ts: NOW - (5 * DAY + 1 * HOUR), type: 'skill_installed', actor: 'user', payload: { skill: 'Meeting minutes', publisher: 'Open Notes Project', version: '2.3.1', licence: 'MIT' } })
drafts.push({ ts: NOW - (2 * DAY + 1 * HOUR + 20 * MIN), type: 'knowledge_added', actor: 'user', payload: { documents: 2, could_not_read: 0, collection: 'Added one by one', size_bytes: 552_000 } })

for (const d of [18, 16, 13, 9, 6, 3, 1]) {
  drafts.push({ ts: NOW - d * DAY - 2 * HOUR, type: 'shutdown', actor: 'app', payload: { checkpoint: true } })
}

drafts.sort((a, b) => a.ts - b.ts)

export const SEED_EVENTS: EvidenceEvent[] = []
export const SEED_CHECKPOINTS: Checkpoint[] = []

let prev = ZERO_HASH
let seq = 0
let lastCheckpointSeq = 0

for (const d of drafts) {
  seq += 1
  const event: EvidenceEvent = {
    seq,
    format_version: 1,
    stream_id: SEED_STREAM.stream_id,
    epoch: 1,
    ts: new Date(d.ts).toISOString(),
    event_type: d.type,
    actor: d.actor,
    project_id: d.project_id,
    conversation_id: d.conversation_id,
    provider: d.provider,
    model_digest: d.model_digest,
    input_commitment: d.input ? hashHex(`aios-input-v1\n${d.input}`) : undefined,
    output_commitment: d.output ? hashHex(`aios-output-v1\n${d.output}`) : undefined,
    prev_hash: prev,
    event_hash: '',
    payload: d.payload,
  }
  const { event_hash: _omit, ...rest } = event
  event.event_hash = hashHex(`aios-evidence-v1\n${JSON.stringify(rest, Object.keys(rest).sort())}`)
  prev = event.event_hash
  SEED_EVENTS.push(event)

  if (d.type === 'shutdown') {
    SEED_CHECKPOINTS.push({
      id: `cp-${String(SEED_CHECKPOINTS.length + 1).padStart(3, '0')}`,
      stream_id: SEED_STREAM.stream_id,
      epoch: 1,
      seq_from: lastCheckpointSeq + 1,
      seq_to: seq,
      root_hash: event.event_hash,
      signer_key_id: SEED_STREAM.signer_key_id,
      signature: hashHex(`sig|${SEED_STREAM.signer_key_id}|${seq}|${event.event_hash}`, 512),
      created_at: event.ts,
    })
    lastCheckpointSeq = seq
  }
}

// Link assistant messages to their request events
for (const e of SEED_EVENTS) {
  if (e.event_type !== 'request') continue
  const msg = SEED_MESSAGES.find((m) => m.role === 'assistant' && m.conversation_id === e.conversation_id && new Date(m.created_at).toISOString() === e.ts)
  if (msg) msg.evidence_seq = e.seq
}

export const SEED_DEFAULT_PROJECT_ID = P.workspace
