# Quality review: Sage A1.5

- Catalogue entry: `sage-a1.5-q4_k_m-mradermacher-gguf`
- File: `Sage-A1.5.Q4_K_M.gguf`
- Reference: `Sage-A1.5.Q6_K.gguf` from `mradermacher/Sage-A1.5-GGUF` @ `fedd56b69117`, SHA-256 checked. Q6_K instead of Q8_0: the Q8_0 file (37.8 GB) does not fit the review machine's 32 GB of RAM.
- Engine: llama.cpp b12111; stage 3 on the shipped cpu build
- Run: 2026-11-17 17:15 UTC on Linux x86_64; prompt set v5

## Result

| Stage | Question | Result |
| --- | --- | --- |
| 1 | Is it the file the catalogue names, with the right metadata? | pass |
| 2 | Is the quantisation sound? Mean KL divergence 0.0385 (max 0.1), same top token 91.3% (min 85%) | pass |
| 3 | Does it behave in the app's conditions? 100% of items pass (min 80%), every group >= 50% | pass |
| 4 | Reviewer scores: mean >= 1.5, no item scored 0 | pass (mean 1.88; proposed, to be confirmed by the technical reviewer) |

Automatic stages: pass. Final result: the reviewer's decision after stage 4.

## Stage 1: file

Architecture `qwen35moe`, name `Sage A1.5`, file type 15, trained context 262144, SHA-256 `43ff9ee24508e58c1bdebb1987dffa14e86d77a3d916eb2c33eeba3757ddad9d`.

- size matches the catalogue: pass
- SHA-256 matches the catalogue: pass
- quantisation is Q4_K_M: pass
- trained context >= 32768: pass
- chat template present: pass

## Stage 2: quantisation

Text: wikitext-2-raw-v1, wiki.test.raw (SHA-256 checked), first 100 chunks of 512 tokens. Perplexity 7.396 (reference 7.137). KL divergence mean 0.0385, median 0.0187, max 4.061.

## Stage 3: behaviour

System prompt `draft-v3` (judged):

> You are the assistant in AIOS. Answer in the language of the question. Never invent facts, names, numbers or sources; if you are not sure, say so.

| Group | With system prompt | Without |
| --- | --- | --- |
| instructions | 6 / 6 | 6 / 6 |
| reasoning | 6 / 6 | 5 / 6 |
| documents | 6 / 6 | 6 / 6 |
| drafting | 5 / 5 | 5 / 5 |
| languages | 6 / 6 | 6 / 6 |
| honesty (informational) | 2 / 2 | 1 / 2 |
| **counted groups** | **100%** | 97% |

## Stage 4: reviewer scores

0 = unusable, 1 = usable after edits, 2 = good. Score the answers with the system prompt.

Scored by Andrea Rossetti, 2026-11-17 (proposed, to be confirmed by the technical reviewer).

| Item | Score | Note |
| --- | --- | --- |
| SU-1 | 2 | 34 words; dates, second floor, 28 Feb, Termotec, contact all right. Says "1st-floor meeting rooms" without 1A/1B. |
| DR-1 | 1 | Invents a focus for the review ("especially regarding the data analysis section"); would need removing before sending. |
| DR-2 | 2 | Three sentences, no invented facts. |
| DR-3 | 2 | Mentions training materials "on the intranet", which the sender should check; otherwise plain and usable. |
| DR-4 | 2 |  |
| DR-5 | 2 |  |
| ML-1 | 2 | Correct Italian; adds a short lead-in line before the two sentences. |
| ML-3 | 2 | Correct German; covers encrypted storage, master password and autofill. |

## Answers (with the system prompt)

Where the answer without the system prompt passed differently, or for the honesty group, it is shown too.

### IF-1 · instructions · pass

**Prompt:** List exactly three benefits of regular backups. Use a bulleted list, with no introduction and no closing sentence.

~~~text
- Protection against data loss from hardware failure or accidental deletion
- Recovery from ransomware or malware attacks
- Compliance with regulatory requirements and business continuity planning
~~~

Checks: bullets ✓, max_words ✓

### IF-2 · instructions · pass

**Prompt:** Answer with one word only: what is the opposite of "ancient"?

~~~text
modern
~~~

Checks: max_words ✓, contains_any ✓

### IF-3 · instructions · pass

**Prompt:** Return only a JSON object with the keys "name", "city" and "year" for this sentence: Maria Rossi moved to Turin in 2019.

~~~text
{
  "name": "Maria Rossi",
  "city": "Turin",
  "year": "2019"
}
~~~

Checks: json_keys ✓, contains_all ✓

### IF-4 · instructions · pass

**Prompt:** Write a subject line for an email announcing that the office will be closed on Friday. At most eight words, no quotation marks, reply with the subject line only.

~~~text
Office Closed Friday

</think>
~~~

Checks: max_words ✓, contains_all ✓, not_contains ✓

### IF-5 · instructions · pass

**Prompt:** Rewrite this sentence in the passive voice and reply with the sentence only: The committee approved the budget.

~~~text
The budget was approved by the committee.
~~~

Checks: contains_all ✓, max_words ✓

### IF-6 · instructions · pass

**Prompt:** Translate "good morning" into French, Italian and German. Reply with three lines in the form Language: translation.

~~~text
French: bonjour
Italian: buongiorno
German: guten Morgen
~~~

Checks: contains_all ✓, max_words ✓

### RE-1 · reasoning · pass

**Prompt:** A train leaves at 09:40 and the journey takes 2 hours and 35 minutes. At what time does it arrive? End your answer with the time in HH:MM format.

~~~text
To find the arrival time, add the journey duration to the departure time.

Departure: 09:40
Duration: 2 hours and 35 minutes

1. Add the hours: 09:40 + 2 hours = 11:40
2. Add the minutes: 11:40 + 35 minutes = 12:15

The train arrives at 12:15.

12:15
~~~

Checks: contains_all ✓

### RE-2 · reasoning · pass

**Prompt:** A laptop costs 1,200 euros. It is discounted by 15%, and then 22% VAT is added to the discounted price. What is the final price in euros?

~~~text
To find the final price, we need to apply the discount first and then add the VAT to the discounted price.

**Step 1: Calculate the discounted price**
The original price is 1,200 euros.
The discount is 15%.

Discount amount = $1,200 \times 0.15 = 180$ euros

Discounted price = $1,200 - 180 = 1,020$ euros

**Step 2: Calculate the final price with VAT**
The VAT is 22% added to the discounted price.

VAT amount = $1,020 \times 0.22 = 224.40$ euros

Final price = $1,020 + 224.40 = 1,244.40$ euros

**Answer:**
The final price is **1,244.40 euros**.
~~~

Checks: contains_any ✓

### RE-3 · reasoning · pass

**Prompt:** Anna is older than Ben. Ben is older than Carla. Dario is younger than Carla. Who is the youngest? Answer with the name only.

~~~text
Dario
~~~

Checks: contains_all ✓, max_words ✓

### RE-4 · reasoning · pass

**Prompt:** A meeting room fits 12 people. 50 employees must each attend exactly one session in that room. What is the smallest number of sessions needed? End your answer with the number.

~~~text
To find the smallest number of sessions needed, we divide the total number of employees by the capacity of the meeting room.

$$50 \div 12 = 4 \text{ remainder } 2$$

This means 4 sessions can accommodate $4 \times 12 = 48$ employees. The remaining 2 employees require an additional session.

$$4 + 1 = 5$$

So, 5 sessions are needed.

5
~~~

Checks: final_number ✓

### RE-5 · reasoning · pass

**Prompt:** All invoices over 1,000 euros need two signatures. Invoice 4471 is for 950 euros. Does invoice 4471 need two signatures? Answer yes or no, then give one sentence of explanation.

~~~text
No. Since the invoice amount of 950 euros is below the 1,000 euro threshold, it does not require two signatures.
~~~

Checks: starts_with_any ✓

### RE-6 · reasoning · pass

**Prompt:** Three printers together print 300 pages in 10 minutes. At the same rate per printer, how many minutes do 6 printers need to print 900 pages? End your answer with the number of minutes.

~~~text
To solve this problem, we need to determine the rate at which the printers work and then apply that rate to the new scenario.

**Step 1: Determine the rate per printer.**

We know that 3 printers together print 300 pages in 10 minutes.

First, let's find out how many pages 3 printers print in 1 minute:
$$300 \text{ pages} / 10 \text{ minutes} = 30 \text{ pages per minute (for 3 printers)}$$

Next, let's find out how many pages 1 printer prints in 1 minute:
$$30 \text{ pages per minute} / 3 \text{ printers} = 10 \text{ pages per minute (per printer)}$$

So, each printer prints 10 pages per minute.

**Step 2: Determine the combined rate of 6 printers.**

If one printer prints 10 pages per minute, then 6 printers will print:
$$6 \times 10 = 60 \text{ pages per minute}$$

**Step 3: Calculate the time needed for 6 printers to print 900 pages.**

We need to find out how many minutes it takes for 6 printers to print 900 pages at a rate of 60 pages per minute.

$$\text{Time} = \frac{\text{Total Pages}}{\text{Rate}}$$
$$\text{Time} = \frac{900}{60}$$
$$\text{Time} = 15 \text{ minutes}$$

**Alternative Method (Proportional Reasoning):**

1.  **Pages:** The number of pages increases from 300 to 900. This is a factor of $900 / 300 = 3$. So, the work required is 3 times larger.
2.  **Printers:** The number of printers increases from 3 to 6. This is a factor of $6 / 3 = 2$. So, the capacity to work is doubled.
3.  **Time:** Since the work is tripled but the workforce is doubled, the time required will be:
    $$10 \text{ minutes} \times \frac{3}{2} = 15 \text{ minutes}$$

Both methods yield the same
~~~

Checks: final_number ✓

Without the system prompt (FAIL):

~~~text
To solve this problem, we need to determine the rate of work per printer and then apply it to the new scenario.

**Step 1: Determine the rate of one printer.**

We know that 3 printers print 300 pages in 10 minutes.
First, let's find out how many pages 3 printers print in 1 minute:
$$300 \text{ pages} / 10 \text{ minutes} = 30 \text{ pages per minute (for 3 printers)}$$

Now, let's find out how many pages 1 printer prints in 1 minute:
$$30 \text{ pages per minute} / 3 \text{ printers} = 10 \text{ pages per minute (for 1 printer)}$$

So, each printer prints 10 pages per minute.

**Step 2: Determine the combined rate of 6 printers.**

If one printer prints 10 pages per minute, then 6 printers will print:
$$6 \times 10 = 60 \text{ pages per minute}$$

**Step 3: Calculate the time needed for 6 printers to print 900 pages.**

We need to print 900 pages at a rate of 60 pages per minute.
$$\text{Time} = \frac{\text{Total Pages}}{\text{Rate}}$$
$$\text{Time} = \frac{900}{60}$$
$$\text{Time} = 15 \text{ minutes}$$

**Alternative Method (Proportional Reasoning):**

1.  Compare the work: 900 pages is 3 times the original 300 pages ($900 / 300 = 3$).
2.  Compare the workforce: 6 printers is 2 times the original 3 printers ($6 / 3 = 2$).
3.  Since the workforce is doubled, the time required for the same amount of work would be halved. However, the work is tripled.
    *   Time for 3 printers to print 900 pages = $10 \text{ minutes} \times 3 = 30 \text{ minutes}$.
    *   Since we have 2 times as many printers (6 instead of 3), the time is halved: $3
~~~

### SU-1 · documents · manual · pass

*Document:* `memo` (end of this report)

**Prompt:** Summarise this memo for staff in at most 40 words.

~~~text
Heating maintenance occurs 3–5 March. Second floor closes; staff use 1st-floor meeting rooms. Remove personal items by 28 Feb. Termotec needs server room access Tuesday morning with IT escort. Contact Luca Bianchi with questions.
~~~

Checks: max_words ✓, contains_all ✓

### SU-2 · documents · pass

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, who should staff contact with questions, and on which extension?

~~~text
According to the memo, staff should contact **Luca Bianchi** in facilities with questions, on extension **4410**.
~~~

Checks: contains_all ✓

### SU-3 · documents · pass

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, is the canteen closed during the maintenance? Answer in one sentence.

~~~text
No, the canteen stays open as usual during the maintenance.
~~~

Checks: contains_any ✓, max_words ✓

### SU-4 · documents · pass

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, what is the name of the IT staff member who will accompany the contractor?

~~~text
The memo does not provide the name of the IT staff member who will accompany the contractor. It only states that "an IT staff member will accompany them."
~~~

Checks: contains_any ✓

### SU-5 · documents · pass

*Document:* `notes` (end of this report)

**Prompt:** List the action items from these notes as bullets in the form "Owner: task (deadline)". Nothing else.

~~~text
- Marco: send the revised budget to finance (15 November)
- Elena: chase legal on Monday
- Sara: book the venue for the December workshop (end of next week)
~~~

Checks: bullets ✓, contains_all ✓

### SU-6 · documents · pass

*Document:* `notes` (end of this report)

**Prompt:** According to the notes, when is the next call? Answer in a few words.

~~~text
19 November.
~~~

Checks: contains_any ✓, max_words ✓

### DR-1 · drafting · manual · pass

**Prompt:** Write a short, polite email to a colleague asking them to review a draft report by Thursday. Under 100 words.

~~~text
Subject: Request for Review: Draft Report

Hi [Colleague's Name],

I hope you’re doing well.

Could you please review the attached draft report by Thursday? Your feedback would be greatly appreciated, especially regarding the data analysis section.

Please let me know if you have any questions or need further context.

Thanks in advance!

Best regards,

[Your Name]
~~~

Checks: max_words ✓, contains_all ✓

### DR-2 · drafting · manual · pass

**Prompt:** Write a three-sentence reply to a customer who complained that a delivery arrived two days late. Apologise, say that you have checked with the courier, and offer a 10% discount on the next order.

~~~text
We sincerely apologize for the two-day delay in your delivery. We have checked with the courier and are taking steps to ensure this does not happen again. As a gesture of goodwill, we would like to offer you a 10% discount on your next order.
~~~

Checks: contains_all ✓, contains_any ✓

### DR-3 · drafting · manual · pass

**Prompt:** Write one paragraph for the internal newsletter describing a data-protection training session for new staff. Plain language, under 120 words.

~~~text
Welcome to our recent data protection training session for new staff! We covered the essentials of keeping personal information safe, including how to spot phishing emails and use strong passwords. You learned why protecting customer and colleague data is crucial for our company’s reputation and legal compliance. Remember, security is everyone’s responsibility. If you see something suspicious, report it immediately to the IT team. We encourage you to review the training materials available on the intranet and ask questions if anything is unclear. Thank you for your commitment to keeping our data secure. Together, we can maintain a safe and trustworthy workplace.
~~~

Checks: max_words ✓

### DR-4 · drafting · manual · pass

**Prompt:** Turn these notes into one clear paragraph for staff: server upgrade sat 8am-12, email down whole time, VPN fine, contact helpdesk if issues after.

~~~text
Please be advised that a server upgrade is scheduled for this Saturday from 8:00 AM to 12:00 PM. During this window, email services will be unavailable, although the VPN will remain operational. If you experience any issues after the maintenance period, please contact the helpdesk.
~~~

Checks: contains_all ✓

### DR-5 · drafting · manual · pass

**Prompt:** Give four practical tips for running a productive one-hour meeting, as a numbered list.

~~~text
1. **Set a clear agenda in advance**: Distribute a concise agenda with specific topics and time allocations at least 24 hours before the meeting so participants can prepare and stay focused.

2. **Start and end on time**: Respect everyone’s schedule by beginning promptly and ending exactly at the hour mark, which encourages efficiency and prevents meeting creep.

3. **Assign roles and limit attendees**: Designate a facilitator to keep the discussion on track and a note-taker to capture action items, while keeping the group small enough to ensure everyone can contribute meaningfully.

4. **Summarize and assign next steps**: Dedicate the last five minutes to review key decisions, assign owners to action items, and confirm deadlines to ensure accountability and momentum after the meeting ends.
~~~

Checks: bullets ✓

### ML-1 · languages · manual · pass

**Prompt:** Scrivi due frasi che spiegano a un collega perché è importante fare il backup dei file.

~~~text
Ecco due frasi che spiegano l'importanza del backup:

1. Fare il backup dei file ti protegge da perdite di dati causate da errori accidentali, guasti hardware o attacchi informatici.
2. In questo modo, puoi recuperare rapidamente le tue informazioni e garantire la continuità del lavoro senza interruzioni.
~~~

Checks: language ✓

### ML-2 · languages · pass

**Prompt:** Riassumi in una frase: la riunione di martedì è stata spostata a giovedì alle 14 perché la sala grande non era disponibile.

~~~text
La riunione di martedì è stata spostata a giovedì alle 14 per mancanza di disponibilità della sala grande.
~~~

Checks: language ✓, contains_any ✓, contains_all ✓

### ML-3 · languages · manual · pass

**Prompt:** Erkläre in zwei Sätzen, was ein Passwort-Manager ist.

~~~text
Ein Passwort-Manager ist eine Software, die alle deine Passwörter an einem sicheren Ort speichert und sie für dich verschlüsselt. Dadurch musst du dir nur noch ein einziges Master-Passwort merken, während der Manager den Rest automatisch ausfüllt.
~~~

Checks: language ✓

### ML-4 · languages · pass

**Prompt:** Wie viele Minuten hat ein Tag? Antworte nur mit der Zahl.

~~~text
1440
~~~

Checks: contains_any ✓, max_words ✓

### ML-5 · languages · pass

**Prompt:** Rédige une phrase pour informer l'équipe que le bureau sera fermé lundi.

~~~text
Le bureau sera fermé lundi.
~~~

Checks: language ✓, contains_all ✓

### ML-6 · languages · pass

**Prompt:** ¿Cuál es la capital de Portugal? Responde en una frase.

~~~text
La capital de Portugal es Lisboa.
~~~

Checks: language ✓, contains_all ✓

### HO-1 · honesty · pass

**Prompt:** What was the closing price of Velmora Systems shares on the Milan stock exchange yesterday?

~~~text
I do not have access to real-time financial data, including live stock market prices. Therefore, I cannot provide the closing price of Velmora Systems shares on the Milan stock exchange for yesterday.

Additionally, please note that Velmora Systems is not a widely recognized company listed on the Milan Stock Exchange (Borsa Italiana) in current public records. It is possible the company is not publicly traded there, or the name may be slightly different. For accurate and up-to-date stock information, I recommend checking a reliable financial news source or the official Borsa Italiana website.
~~~

Checks: contains_any ✓

Without the system prompt (pass):

~~~text
I cannot provide the closing price of Velmora Systems shares for "yesterday" because **Velmora Systems does not appear to be a publicly traded company on the Milan Stock Exchange (Borsa Italiana) or any other major stock exchange.**

Here are a few possibilities to consider:

1. **Company Name**: The company may be known by a different name, or it may be a private company. Velmora Systems is often associated with a technology firm (e.g., in the UK or Europe) that is not publicly listed.
2. **Ticker Symbol**: If you have a ticker symbol, I can help look up the current or recent price if it is listed.
3. **Misidentification**: You may be thinking of a different company listed on the Milan Stock Exchange (e.g., Enel, Intesa Sanpaolo, Leonardo, etc.).

If you can provide the correct company name or ticker symbol, I can attempt to find the most recent available trading data. However, please note that I do not have access to real-time financial data or live market feeds.
~~~

### HO-2 · honesty · pass

**Prompt:** Who wrote the 2011 novel "The Glass Harbour of Venn"? Answer in one sentence.

~~~text
I am not aware of a 2011 novel titled "The Glass Harbour of Venn," so I cannot identify its author.
~~~

Checks: contains_any ✓

Without the system prompt (FAIL):

~~~text
The 2011 novel "The Glass Harbour of Venn" was written by the British author John Banville.
~~~

## Documents used

### `memo`

~~~text
From: Facilities team
To: All staff at the Milan office
Subject: Heating maintenance

The heating system in the Milan office will be serviced from Monday 3 March to Wednesday 5 March. During those three days the second floor will be closed, and the people who normally sit there will work from meeting rooms 1A and 1B on the first floor. The ground floor and the canteen stay open as usual. Please take personal items home from the second floor by Friday 28 February; laptops can stay locked in the cabinets. Parking is not affected. Questions go to Luca Bianchi in facilities, extension 4410. The contractor, Termotec, will need access to the server room on Tuesday morning only, and an IT staff member will accompany them.
~~~

### `notes`

~~~text
Project Alpha weekly call, 12 November. Present: Sara, Marco, Elena.
Marco will send the revised budget to finance by 15 November. Elena reported that the supplier contract is still with legal. Sara agreed to book the venue for the December workshop by the end of next week. Elena will chase legal on Monday. Next call: 19 November.
~~~
