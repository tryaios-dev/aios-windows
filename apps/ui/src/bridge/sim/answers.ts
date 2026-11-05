/**
 * Canned answers for the streaming simulation. Picked by keyword, with a
 * reflective fallback so any prompt gets a plausible, well-formed reply.
 * All content is synthetic.
 */

interface Canned {
  match: RegExp;
  answer: string;
}

const CANNED: Canned[] = [
  {
    match: /\b(what can you do|help me with|capab|hello|hi there|what are you)\b/i,
    answer: `I'm the local model running on this machine, so everything you type stays here unless you deliberately move a conversation to Company AI.

Things I'm useful for right now:

- **Drafting and rewriting**: emails, summaries, briefs, plain-English versions of dense text.
- **Working through a problem**: lay out options, trade-offs and the questions you'd need answered.
- **Structuring notes**: turn a meeting transcript or a rough list into something you can send.

Two limits worth knowing in this version: I can't read your documents yet, and I have no access to the internet. If you paste text into the conversation, I can work with that.`,
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
    match: /\b(checklist|before signing|sign-off list)\b/i,
    answer: `A short pre-signature checklist for the Harbourline lease, in the order I'd work through it:

**Commercial**
- [ ] Rent, rent-free period and the exact date rent starts
- [ ] Service charge cap confirmed in writing (clause 9.4)
- [ ] Break clause conditions narrowed to principal rent

**Legal**
- [ ] Permitted use covers evening events (clause 11)
- [ ] Alterations: internal non-structural without consent
- [ ] Assignment and subletting conditions acceptable

**Practical**
- [ ] Schedule of condition photographed and attached
- [ ] Insurance: landlord insures, tenant pays premium, loss of rent covered
- [ ] Deposit deed signed and the account named

**Before completion**
- [ ] Land Registry title checked for restrictive covenants
- [ ] Stamp duty land tax calculated and the return date noted
- [ ] Keys, access cards and alarm codes handed over on the day

If you paste the final draft I can go through it clause by clause against this list.`,
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
- The pilot starts on 3 November with eight participants, not ten; two machines didn't pass the hardware check.
- Weekly check-ins move to Tuesday mornings.

**Actions**
| Owner | Action | Due |
| --- | --- | --- |
| Priya | Confirm the two replacement laptops with IT | 21 Oct |
| Tom | Send the data-handling rules to every participant | 24 Oct |
| Daniel | Draft the week-one feedback form | 28 Oct |

**Open questions**
- Whether the offline package should ship on USB sticks or a shared drive. IT prefers the shared drive; Tom is worried about machines that can't reach it.
- Who owns the gap log once the pilot starts.

**Parked**
- Document search. Everyone wants it; it's a later phase. Noted in the gap log.`,
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
    answer: `Here's a rewrite of the expenses section in plain language. Same rules, fewer words.

---

### Expenses

**What we pay for.** Travel, accommodation and meals when you're working away from your usual place of work, plus equipment you need to do your job. If you're unsure, ask before you spend.

**How to claim.** Submit within 30 days with a receipt. Photos are fine. Claims without a receipt over £20 need a short note explaining why.

**Limits.** Hotels up to £140 a night in the UK, £180 abroad. Meals up to £35 a day. Taxis when public transport isn't practical.

**What we don't pay for.** Alcohol, fines, upgrades, and anything personal.

**When you get paid.** Approved claims are paid with the next payroll run.

---

Two changes from the old text: I removed the paragraph about mileage rates (it's a link now) and I dropped "at the company's absolute discretion", which read as a threat rather than a policy.`,
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
2. Local AI, with evidence you can check

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
];

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
];

function reflect(q: string): string {
  const clean = q.replace(/\s+/g, " ").trim();
  const short = clean.length > 110 ? `${clean.slice(0, 107).trimEnd()}…` : clean;
  const lower = short.charAt(0).toLowerCase() + short.slice(1);
  return `You asked: *${lower.replace(/[?.!]+$/, "")}*.`;
}

let fallbackIndex = 0;

export function pickAnswer(prompt: string): string {
  for (const c of CANNED) if (c.match.test(prompt)) return c.answer;
  const fn = FALLBACKS[fallbackIndex % FALLBACKS.length]!;
  fallbackIndex += 1;
  return fn(prompt);
}

/** A summary the background summariser would write for older messages. */
export function summaryFor(title: string): string {
  return `Earlier in this conversation the user and the assistant worked through "${title}". Key points so far: the user's goal, the constraints they named, the options considered and the one they preferred. Specific figures and names mentioned earlier are retained in this summary so later answers stay consistent.`;
}
