/**
 * Canned answers for the streaming simulation. Picked by keyword, with a
 * reflective fallback so any prompt gets a plausible, well-formed reply.
 * All content is synthetic.
 *
 * Order matters. The starter examples from `src/data/stack.ts` come first and
 * each has an answer written for exactly that text; change the two together.
 */

interface Canned {
  match: RegExp | ((prompt: string) => boolean)
  answer: string | ((prompt: string) => string)
}

/** The starters leave blanks in square brackets. Sent unfilled, the AI asks for what is missing. */
const BLANK = /\[(who|what|paste your text here|what you want done, and by when|who can help)\]/i

/* ------------------------------------------------------------------ */
/* Dates for the planning answer, read from the request itself so the   */
/* plan follows the date even after the person edits it.               */
/* ------------------------------------------------------------------ */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const shortDay = (d: Date) => `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
const longDay = (d: Date) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`

/** The first "27 November" style date in the request; a Friday a little over two weeks away if there is none. */
function deadlineIn(prompt: string, now = new Date()): Date {
  const m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${MONTHS.join('|')})\\b`, 'i').exec(prompt)
  if (m) {
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase())
    const d = new Date(now.getFullYear(), month, Number(m[1]))
    if (d.getTime() < now.getTime() - 30 * 86_400_000) d.setFullYear(d.getFullYear() + 1)
    return d
  }
  let d = addDays(now, 16)
  while (d.getDay() !== 5) d = addDays(d, 1)
  return d
}

/** The office move from the "Plan a project" example. The move happens on the last Saturday before the date asked for. */
function officeMovePlan(prompt: string): string {
  const deadline = deadlineIn(prompt)
  let move = addDays(deadline, -1)
  while (move.getDay() !== 6) move = addDays(move, -1)
  const on = (offset: number) => shortDay(addDays(move, offset))
  return `Here is a plan that moves everyone on **${longDay(move)}**. Moving on a Saturday means nobody loses a working day, and it leaves the days before ${longDay(deadline)} for putting right anything that goes wrong.

| When | Step | Owner |
| --- | --- | --- |
| ${on(-9)} | Order the internet line for the fourth floor and get a confirmed connection date | Imran |
| ${on(-8)} | Book the removal firm for ${on(0)} and reserve the goods lift for that day | Hannah, with Mr Petrov |
| ${on(-8)} | Approve the removal quote and check the office insurance covers the move | Jo |
| ${on(-5)} | Agree who sits where on the fourth floor and share the seating plan | Hannah |
| ${on(-3)} | Test the internet line and the Wi-Fi on the fourth floor | Imran |
| ${on(-3)} | Decide whether Saturday goes ahead as planned (see below) | Hannah |
| ${on(-2)} | Hand out crates and labels. Everyone labels their desk, chair and crates with their new desk number | Hannah |
| ${on(-1)} | Everyone packed by 4pm. Computers and phones shut down and unplugged after 5pm | Imran |
| ${on(0)} | Move day. Let the removal firm in and check each desk against the seating plan | Hannah, with Mr Petrov |
| ${on(0)} | Reconnect the network, printer and phones, and try every desk before leaving | Imran |
| ${on(2)} | First day on the fourth floor. Walk round and list anything missing or broken | Hannah |
| ${on(4)} | Pay the removal firm and update the equipment list | Jo |
| ${shortDay(deadline)} | Second floor empty, checked with Mr Petrov, keys handed back | Hannah |

**The step that decides everything**

The internet line. A new connection often takes one to two weeks, and nothing else on this list matters if people cannot get online on their first morning. That is why it comes first, and why there is a decision on ${on(-3)}. If the line is not working by then, you have two choices: run the fourth floor on a temporary mobile connection for the first week, or tell everyone that day that the move is put back and the date will be missed.

**What I have assumed**

- The removal firm is free on ${on(0)}. It is the last Saturday before your date, so confirm it this week.
- The desks fit the fourth floor as they are, with no new furniture to order.
- Only Hannah, Imran and Mr Petrov need to be in the building on move day.

Tell me if an owner or a date is wrong and I'll redo the table.`
}

/** "Plan a project" with the person's own goal: an outline, and an honest request for what would make it specific. */
function outlinePlan(prompt: string): string {
  const goal = /Goal:\s*(.+)/i.exec(prompt)?.[1]?.trim() ?? ''
  const people = /People:\s*(.+)/i.exec(prompt)?.[1]?.trim() ?? ''
  if (!goal || BLANK.test(goal)) {
    return `Happy to. Tell me the goal and the date you are working towards, and who can help. One line each is enough, for example:

*Goal: open the new shop by 1 March. People: me, Sam and our builder.*`
  }
  const names = BLANK.test(people) ? [] : people.split(/,|\band\b/).map((x) => x.replace(/\.$/, '').trim()).filter(Boolean)
  const owner = (i: number) => (names.length ? names[i % names.length] : 'To be agreed')
  return `Here is a first outline for: *${goal.replace(/\.$/, '')}*.

| Step | Owner | When |
| --- | --- | --- |
| Write down what "done" looks like in a sentence or two that everyone agrees with | ${owner(0)} | This week |
| List everything that has to be true by the date, then put the list in order | ${owner(0)} | This week |
| Find the step with the longest wait (an order, an approval, a booking) and start it first | ${owner(1)} | This week |
| Give every remaining step one owner and one date | ${owner(0)} | Next week |
| Hold a ten-minute check each week: what is done, what is late, what is in the way | ${owner(2)} | Every week |
| Keep the last few days free for whatever goes wrong | Everyone | The final week |

This is an outline, because the goal is all I have to go on. Tell me what is already done, what you are waiting for and any dates that cannot move, and I'll turn it into a dated plan with real steps.`
}

/** "Summarise something" with the person's own text: the opening points of what they pasted. */
function summarisePasted(prompt: string): string {
  const pasted = prompt.split(/\n\s*\n/).slice(1).join('\n').trim()
  const points = pasted
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((x) => x.replace(/^[-*\u2022\d.)\s]+/, '').trim())
    .filter((x) => x.length > 24)
    .slice(0, 5)
    .map((x) => (x.length > 170 ? `${x.slice(0, 167).trimEnd()}\u2026` : x))
  if (points.length === 0) {
    return `That is very short, so there is little to cut. Paste the full text under your request and send again, and I'll pull out the main points and the actions.`
  }
  return `**Main points**

${points.map((x) => `- ${x}`).join('\n')}

**Actions**

I could not see a clear owner beside every action in this text. Tell me who was involved and I'll set the actions out as a table, with a name and a date beside each.`
}

function emailDraft(prompt: string): string {
  const m = prompt.match(/email to (.+?) about (.+?)(?:\.|\n|$)/i)
  const who = m?.[1]?.trim() ?? ''
  const what = m?.[2]?.trim() ?? ''
  if (!who || !what || BLANK.test(who) || BLANK.test(what)) {
    const missing = !who || BLANK.test(who) ? (!what || BLANK.test(what) ? 'who the email is for and what it is about' : 'who the email is for') : 'what the email is about'
    return `Happy to. Tell me ${missing} and I'll write the draft. A line or two is enough, for example: *our landlord, about the broken heating in the meeting room*.`
  }
  const subject = what.charAt(0).toUpperCase() + what.slice(1)
  return `Here is a first draft to ${who}. I have left the details I can't know in brackets.

> **Subject:** ${subject}
>
> Hello [name],
>
> I'm writing about ${what}. [One sentence on what has happened, or what you need.]
>
> [The detail: dates, amounts, or what you would like them to do, and by when.]
>
> Thank you for your help. If it is easier to talk it through, I'm free [day and time].
>
> Kind regards,  
> [your name]

Tell me a little more about the situation and I'll fill in the brackets. Or say "more formal" or "shorter" and I'll change the tone.`
}

const CANNED: Canned[] = [
  /* ---- The four starter examples: each answer is written for exactly that sample text ---- */
  {
    // "Draft an email": the note to the landlord about the heating.
    match: (q) => /mr hughes/i.test(q) && /heating/i.test(q),
    answer: `Here is a draft you can send as it is.

> **Subject:** Heating in the meeting room
>
> Dear Mr Hughes,
>
> I hope you are well. I'm writing because the heating in our meeting room has not worked since Monday, and the room is now too cold to use.
>
> We have client meetings booked in there on Thursday, so could you send an engineer this week? If you let us know which day they are coming, we will make sure someone is here to let them in.
>
> Thank you for your help. Do ring me if it is easier to talk it through.
>
> Kind regards,  
> Maya  
> Brightwell Studio

It is three short paragraphs: what is wrong, what you need and by when, and a thank you. Say "firmer" if you would like it to press harder on the date, or "shorter" for a two-line version.`,
  },
  {
    // "Summarise something": the team catch-up notes.
    match: /contact form still sends enquiries to the old inbox/i,
    answer: `**Main points**

- The website relaunch has slipped by a week. It now goes live a week on Monday.
- The pricing page will show monthly prices only. The annual option is dropped for now.
- The customer newsletter goes out the day after launch, not on the day itself.

**Actions**

| Owner | Action | By when |
| --- | --- | --- |
| Ben | Get the About page photos from the photographer | Friday |
| Amira | Rewrite the wording on the pricing page | Thursday |
| Dev | Fix the contact form so enquiries stop going to the old inbox | Before launch |
| Carys | Draft the customer newsletter | Ready to send the day after launch |

**Not settled**

- **Checking the site on phones.** Dev thinks it is half a day of work, but nobody has taken it on. It needs an owner before launch.
- **The March trade show.** No decision. It is back on the list for next week.

One thing to watch: the photos and the contact form both have to be finished before launch, and the photos depend on someone outside the team.`,
  },
  {
    // "Explain it plainly": the insurance clause about escape of water.
    match: /escape of water/i,
    answer: `**In plain English**

This part of the policy is about water damage, such as a burst pipe, a leaking tank or a failed boiler. It says two things.

1. **If the property is empty for more than 30 days in a row, water damage is not covered**, unless you did one of these:
   - turned the water off at the mains and drained the system *before* the property was left empty, or
   - kept the heating on at 12°C or warmer for the whole time it was empty.
2. **You pay the first part of any water damage claim yourself.** That amount is £500, or £1,000 if the damage happens between 1 November and 31 March.

**An example**

You are away for six weeks in January and a pipe freezes and bursts. If the heating was left on at 12°C or above throughout, the insurer pays for the damage, less the first £1,000. If the heating was off and the water was still on, the insurer pays nothing.

**Things to double-check**

1. **What "unoccupied" means.** Policies usually define it. Ask whether a friend calling in, or you staying one night, counts as occupied.
2. **Whether a short visit restarts the 30 days.** The clause says "consecutive" days but does not say what breaks the run.
3. **How you would prove it.** If you ever claim, you may be asked to show the heating stayed on or the water was off. A photo of the stopcock or a record from the thermostat would help.
4. **"Throughout".** If the boiler fails while you are away and the temperature drops, the condition may not have been met, even though you did the right thing.
5. **The excess.** Check whether the £500 or £1,000 replaces the usual excess on the policy or is added to it.

This explains the wording. It is not advice on your own policy; your insurer or broker can confirm how they apply it.`,
  },
  {
    // "Plan a project": the office move. Dates follow the date in the request.
    match: (q) => /fourth floor/i.test(q) && /office of 12 people/i.test(q),
    answer: officeMovePlan,
  },

  /* ---- The starters with the person's own words, or with the blanks left in ---- */
  {
    match: /draft a short, friendly email/i,
    answer: emailDraft,
  },
  {
    match: /\[paste your text here\]/i,
    answer: `There is no text under your request yet. Paste it into the message box below the instruction and send again, and I'll work from that.

To work from a document, add it in My secure knowledge first, or paste its text straight into a message.`,
  },
  {
    match: /^turn the goal below into a plan/i,
    answer: outlinePlan,
  },
  {
    match: /^summarise the text below into the main points/i,
    answer: summarisePasted,
  },
  {
    match: /\b(what can you do|help me with|capab|hello|hi there|what are you)\b/i,
    answer: `I'm the AI model running on this computer, so what you type stays here.

Things I'm useful for right now:

- **Drafting and rewriting**: emails, replies, plain-English versions of dense text.
- **Summarising**: paste meeting notes or a long message and get the main points and who does what.
- **Comparing and deciding**: paste two or three quotes or options and I'll set them side by side.
- **Planning**: turn a goal into steps, with an owner and a date for each.

Two things worth knowing: I work from the documents you add in My secure knowledge and from anything you paste here, and I do not go online. Nothing leaves this computer unless you say so.`,
  },
  // The checklist comes before the break clause: a checklist request may mention the break clause in passing.
  {
    match: /\b(checklist|before signing|sign-off list)\b/i,
    answer: `A short checklist for the Harbourline lease, in the order I'd work through it:

**Commercial**
- [ ] Rent, rent-free period and the exact date rent starts
- [ ] Service charge cap confirmed in writing
- [ ] Break clause conditions narrowed to principal rent

**Legal**
- [ ] Permitted use covers evening events
- [ ] Alterations: internal, non-structural changes allowed without consent
- [ ] Assignment and subletting conditions acceptable

**Practical**
- [ ] Insurance: landlord insures, tenant pays the premium, loss of rent covered
- [ ] Deposit deed signed and the account named

**Before completion**
- [ ] Land Registry title checked for restrictive covenants
- [ ] Stamp duty land tax calculated and the return date noted
- [ ] Keys, access cards and alarm codes handed over on the day

If you paste the final draft I can go through it clause by clause against this list.`,
  },
  {
    match: /\b(break clause|break notice|terminate the lease)\b/i,
    answer: `A break clause lets one or both parties end the lease early, but the wording decides whether the right is real or theoretical. Three things to check in the Harbourline draft:

1. **Who can exercise it.** The current clause 14.1 gives the right to the tenant only. If you want it mutual, say so explicitly.
2. **Conditions attached.** The draft makes the break conditional on "all sums due having been paid". Courts read conditions strictly, so a disputed £50 service-charge balance could void the break. Narrow it to *principal rent* and consider a cure period.
3. **Notice mechanics.** Six months' written notice is standard, but check clause 22 (notices) for how service works. A notice sent to the wrong address is a notice not served.

| Point | Draft wording | Suggested change |
| --- | --- | --- |
| Conditions | all sums due paid | principal rent paid, no material breach |
| Vacant possession | required | "give up occupation" rather than full vacant possession |
| Notice | 6 months, "in writing" | 6 months, served under clause 22, by recorded delivery |

I'd flag the conditions point first; it's the one that most often turns a break into a dispute.`,
  },
  {
    match: /\b(rent review|review timeline|rent increase)\b/i,
    answer: `Here's the review timeline implied by clauses 6 and 7 of the draft, assuming a lease start of 1 March 2027.

- **1 March 2032**: first review date (fifth anniversary).
- **No earlier than 1 September 2031**: landlord may serve a review notice (six months before).
- **Within 2 months of the notice**: tenant may serve a counter-notice. Silence does **not** mean acceptance in this draft, which is in your favour.
- **If no agreement by the review date**: either party can refer to an independent surveyor. The draft says "arbitrator"; an *expert* is usually quicker and cheaper for a single-let office.

Two things to raise with the landlord's solicitor:

1. The review is **upwards only**. In the current market you have a reasonable case for upwards-and-downwards, or at least a cap.
2. There is no **time-of-the-essence** language, which is good. Keep it that way.

Want me to draft the two paragraphs for the reply email?`,
  },
  {
    match: /\b(tender|northgate|reply to|draft (a|an|the) (reply|email|response))\b/i,
    answer: `Here's a draft you can send as-is or trim:

> **Subject:** Northgate tender, clarification on question 4
>
> Dear Ms Okafor,
>
> Thank you for the clarification request. On question 4, our proposal covers on-site support for the first 90 days after go-live, with a named engineer available during working hours and a four-hour response commitment for anything that stops work.
>
> After the 90 days, support moves to the standard service desk under the terms in section 6.2. We're happy to extend the on-site period at the day rate quoted in Appendix B if that would help your rollout plan.
>
> Please let me know if a short call would be useful before the deadline on Friday.
>
> Kind regards,  
> Daniel

I kept it to three short paragraphs: the direct answer, what happens afterwards, and an offer. If you'd rather sound more formal, swap the last line for "I remain available for any further questions."`,
  },
  {
    match: /\b(summari[sz]e|meeting notes|notes from|transcript|action points)\b/i,
    answer: `**Summary of the 14 October planning meeting**

**Decisions**
- The pilot starts on 3 November with eight people, not ten. Two of the laptops are too old to take part.
- Weekly check-ins move to Tuesday mornings.

**Actions**
| Owner | Action | Due |
| --- | --- | --- |
| Priya | Ask IT for two replacement laptops | 21 Oct |
| Tom | Send the data-handling rules to everyone taking part | 24 Oct |
| Daniel | Draft the week-one feedback form | 28 Oct |

**Open questions**
- Whether the training guide is printed or kept in a shared folder. IT prefers the shared folder; Tom is worried some people will not find it.
- Who keeps the list of problems once the pilot starts.

**Parked**
- A mobile app. Everyone asked again; it belongs to a later phase and is noted.`,
  },
  {
    match: /\b(onboarding|first week|week one|new starter)\b/i,
    answer: `A first-week plan that doesn't drown a new starter in meetings:

**Day 1: Set up and orientation**
- Laptop, accounts and the two tools they'll use every day. Nothing else yet.
- A 30-minute walk through *how we work*: where decisions live, how to ask for help.
- Lunch with their buddy.

**Day 2 to 3: Shadow**
- Sit in on two real pieces of work, with the buddy narrating what's happening and why.
- Read the three documents that matter (handbook, current priorities, the glossary).

**Day 4: First small task**
- Something real, scoped to half a day, with a named reviewer. The point is a first contribution, not a test.

**Day 5: Review and plan**
- 20 minutes with their manager: what surprised them, what's unclear, what they'd like to pick up next.
- Agree the first month's focus in writing.

Keep the calendar mostly empty. The most common onboarding complaint is "I had no time to actually do anything".`,
  },
  {
    match: /\b(expense|expenses policy|reimburse)\b/i,
    answer: `Here is the section in plain language. Every rule is the same; only the wording has changed.

---

### Expenses

**What we pay for.** Reasonable costs you have to spend to do your job.

**How to claim.** Send your claim within 30 days of spending the money, with a receipt for every item.

**Limits.** Hotels up to £140 a night in the UK and £180 a night abroad. Meals up to £35 a day.

**What we don't pay for.** Alcohol, fines and penalties, and upgrades to a higher class of travel.

**Driving.** Mileage is paid at the current HMRC rates.

**When you get paid.** Approved claims are paid with the next payroll run.

---

Two things to decide before this goes out:

1. The original says claims are paid "at the company's absolute discretion". I left that out because it contradicts the promise to pay approved claims. If you need it for legal reasons, put it back as its own sentence.
2. "Reasonable" is doing a lot of work in the first line. One or two examples (a train ticket to a client, a taxi when there is no bus) would save people asking.`,
  },
  {
    match: /\b(code of conduct|conduct faq|harassment)\b/i,
    answer: `Three questions people ask about the code of conduct, with answers that are honest rather than legalistic:

**"Does it apply outside work hours?"**
Yes, when you're representing the company: conferences, client dinners, the team chat. Your private life is your own.

**"What happens if I report something?"**
You'll hear back within two working days to say who is looking at it. You'll never be asked to confront the person yourself. Retaliation for a good-faith report is itself a breach.

**"What if I'm not sure it counts?"**
Ask. Reporting something that turns out to be a misunderstanding costs nothing. Staying silent about something that was serious costs a lot.

If you'd like, I can turn these into the short Q&A format the rest of the handbook uses.`,
  },
  {
    match: /\b(headline|title options|launch post|blog title)\b/i,
    answer: `Ten headline options for the launch post, grouped by angle:

**Straight**
1. AIOS: a private AI that runs on your own computer
2. Local AI, with a record you can check

**Benefit-led**
3. Use AI on confidential work without sending it anywhere
4. Your conversations, your hardware, your record of what happened

**Contrarian**
5. Most AI tools work by uploading your life. This one doesn't.
6. The paragraph leaves. The archive stays.

**Plain**
7. What a local-first AI actually means
8. An AI assistant that works offline and keeps receipts

**Short**
9. Nothing leaves.
10. AI, on your terms.

My pick is 3 for the title and 6 as the first line of the post. Avoid 9 on its own; it reads as a slogan rather than a promise.`,
  },
  {
    match: /\b(local model|explain.*local|plain.english|how does (a )?local)\b/i,
    answer: `**What "running a local model" means, in plain English**

A language model is a large file of numbers. To use it, a program loads the file into memory and runs your text through it. That can happen on a server somewhere, which is what most AI products do, or on the computer in front of you, which is what AIOS does.

When it runs locally:

- **Your text never leaves the machine.** There's no upload. The model file was downloaded once and checked against a published fingerprint.
- **It works without internet.** On a train, in a secure room, during an outage.
- **Speed depends on your hardware.** A laptop with a decent graphics card answers quickly; an 8 GB machine without one is slower but usable.
- **The model is smaller.** A local model is a few billion parameters rather than hundreds. It's good at drafting, summarising and explaining; it's weaker at long chains of reasoning and it knows nothing after its training date.

The trade is simple: a somewhat less capable model, in exchange for certainty about where your data is.`,
  },
  {
    match: /\b(python|script|code|function|regex|sql|typescript|javascript)\b/i,
    answer: `Here's a small, dependency-free version:

\`\`\`python
from pathlib import Path
import hashlib

def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    """Stream a file through SHA-256 without loading it into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()

if __name__ == "__main__":
    for file in sorted(Path("models").glob("*.gguf")):
        print(f"{sha256_of(file)}  {file.name}")
\`\`\`

Notes:

- Reading in 1 MB chunks keeps memory flat even for a 5 GB model file.
- The output format matches \`sha256sum\`, so you can diff it against a published checksum list directly.
- If you need to verify rather than print, compare \`hexdigest()\` with the expected value using \`hmac.compare_digest\` to avoid timing differences.`,
  },
  {
    match: /\b(link|source|reference|where can i read|documentation)\b/i,
    answer: `A few starting points. Links open in your browser only after you confirm, since this conversation can't fetch anything itself.

- The llama.cpp project, which is the engine this application bundles: [github.com/ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)
- The Qwen3 model card and licence: [huggingface.co/Qwen/Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B)
- A readable explanation of quantisation: [huggingface.co/blog/introduction-to-ggml](https://huggingface.co/blog/introduction-to-ggml)

If you tell me what you're trying to decide, I can summarise the relevant parts rather than send you to read all three.`,
  },
]

const FALLBACKS = [
  (q: string) => `Here's a first pass at that.

${reflect(q)}

A few points to consider:

1. **Start with the outcome you want**, then work backwards to what has to be true for it. It usually shortens the list.
2. **Separate what's known from what's assumed.** Most of the disagreement in questions like this comes from unstated assumptions.
3. **Decide what "done" looks like** before starting, so you know when to stop.

If you give me more detail, or paste the text you're working from, I can be more specific.`,
  (q: string) => `${reflect(q)}

I'd approach it in three steps:

- **Clarify the question.** What exactly needs deciding, and by when?
- **List the options**, including "do nothing". Two or three is usually enough.
- **Pick the one you'd be happy to explain** to someone who disagrees with you.

Tell me which of those you're stuck on and I'll go deeper.`,
  (q: string) => `${reflect(q)}

Short answer: it depends on what you're optimising for, and it's worth being explicit about that before going further.

| If you care most about | Then |
| --- | --- |
| Speed | Take the simplest option that works and revisit later |
| Cost | Get two comparable quotes and decide on the second one |
| Risk | Write down what would have to go wrong, and what you'd do then |

Which of those is closest to your situation?`,
]

function reflect(q: string): string {
  const clean = q.replace(/\s+/g, ' ').trim()
  const short = clean.length > 110 ? `${clean.slice(0, 107).trimEnd()}…` : clean
  const lower = short.charAt(0).toLowerCase() + short.slice(1)
  return `You asked: *${lower.replace(/[?.!]+$/, '')}*.`
}

let fallbackIndex = 0

export function pickAnswer(prompt: string): string {
  for (const c of CANNED) {
    const hit = typeof c.match === 'function' ? c.match(prompt) : c.match.test(prompt)
    if (hit) return typeof c.answer === 'function' ? c.answer(prompt) : c.answer
  }
  const fn = FALLBACKS[fallbackIndex % FALLBACKS.length]
  fallbackIndex += 1
  return fn(prompt)
}

/** A summary the background summariser would write for older messages. */
export function summaryFor(title: string): string {
  return `Earlier in this conversation the user and the assistant worked through "${title}". Key points so far: the user's goal, the constraints they named, the options considered and the one they preferred. Specific figures and names mentioned earlier are retained in this summary so later answers stay consistent.`
}
