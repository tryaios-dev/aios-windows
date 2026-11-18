# Quality review: Qwen3.8 27B

- Catalogue entry: `qwen3.8-27b-ud-q4_k_m-unsloth-gguf`
- File: `Qwen3.8-27B-UD-Q4_K_M.gguf`
- Reference: `Qwen3.8-27B-Q8_0.gguf` from `unsloth/Qwen3.8-27B-GGUF` @ `4af51b3542f7`, SHA-256 checked
- Engine: llama.cpp b12111; stage 3 on the shipped cpu build
- Run: 2026-11-17 17:02 UTC on Linux x86_64; prompt set v5

## Result

| Stage | Question | Result |
| --- | --- | --- |
| 1 | Is it the file the catalogue names, with the right metadata? | pass |
| 2 | Is the quantisation sound? Mean KL divergence 0.0082 (max 0.1), same top token 96.1% (min 85%) | pass |
| 3 | Does it behave in the app's conditions? 93% of items pass (min 80%), every group >= 50% | pass |
| 4 | Reviewer scores: mean >= 1.5, no item scored 0 | pass (mean 2.00; proposed, to be confirmed by the technical reviewer) |

Automatic stages: pass. Final result: the reviewer's decision after stage 4.

## Stage 1: file

Architecture `qwen35`, name `Qwen3.8-27B`, file type 15, trained context 262144, SHA-256 `1bce504dfecd84153666928a41d8a66706f0158d3a317bc5196b72819d7dc529`.

- size matches the catalogue: pass
- SHA-256 matches the catalogue: pass
- quantisation is UD-Q4_K_M: pass
- trained context >= 32768: pass
- chat template present: pass

## Stage 2: quantisation

Text: wikitext-2-raw-v1, wiki.test.raw (SHA-256 checked), first 100 chunks of 512 tokens. Perplexity 6.738 (reference 6.745). KL divergence mean 0.0082, median 0.0034, max 3.898.

## Stage 3: behaviour

System prompt `draft-v3` (judged):

> You are the assistant in AIOS. Answer in the language of the question. Never invent facts, names, numbers or sources; if you are not sure, say so.

| Group | With system prompt | Without |
| --- | --- | --- |
| instructions | 6 / 6 | 6 / 6 |
| reasoning | 5 / 6 | 5 / 6 |
| documents | 5 / 6 | 6 / 6 |
| drafting | 5 / 5 | 5 / 5 |
| languages | 6 / 6 | 6 / 6 |
| honesty (informational) | 2 / 2 | 1 / 2 |
| **counted groups** | **93%** | 97% |

## Stage 4: reviewer scores

0 = unusable, 1 = usable after edits, 2 = good. Score the answers with the system prompt.

Scored by Andrea Rossetti, 2026-11-17 (proposed, to be confirmed by the technical reviewer).

| Item | Score | Note |
| --- | --- | --- |
| SU-1 | 2 | 37 words; dates, rooms 1A/1B, 28 Feb, contact all right. Leaves out the Termotec visit, which needs no action from staff. |
| DR-1 | 2 |  |
| DR-2 | 2 | Three sentences, no invented facts. |
| DR-3 | 2 | Opens with "Welcome to the team!" and then talks about new staff in the third person; small edit. Generic content, nothing that needs checking. |
| DR-4 | 2 |  |
| DR-5 | 2 | Good tips; 203 words, longer than needed. |
| ML-1 | 2 | Natural, correct Italian. |
| ML-3 | 2 | Correct German; covers encrypted storage, master password and generated passwords. |

## Answers (with the system prompt)

Where the answer without the system prompt passed differently, or for the honesty group, it is shown too.

### IF-1 · instructions · pass

**Prompt:** List exactly three benefits of regular backups. Use a bulleted list, with no introduction and no closing sentence.

~~~text
*   Protection against data loss from hardware failures, software corruption, or accidental deletion.
*   Defense against cyber threats such as ransomware attacks that encrypt or steal critical files.
*   Ensured business continuity by allowing for rapid system restoration and minimizing downtime.
~~~

Checks: bullets ✓, max_words ✓

### IF-2 · instructions · pass

**Prompt:** Answer with one word only: what is the opposite of "ancient"?

~~~text
Modern
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
Office Closed This Friday
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
French: Bonjour
Italian: Buongiorno
German: Guten Morgen
~~~

Checks: contains_all ✓, max_words ✓

### RE-1 · reasoning · FAIL

**Prompt:** A train leaves at 09:40 and the journey takes 2 hours and 35 minutes. At what time does it arrive? End your answer with the time in HH:MM format.

~~~text
To find the arrival time, we add the duration of the journey to the departure time.

1.  **Start Time:** 09:40
2.  **Duration:** 2 hours and 35 minutes

**Step 1: Add the hours**
09:40 + 2 hours = 11:40

**Step 2: Add the minutes**
11:40 + 35 minutes

Since 40 minutes + 35 minutes = 75 minutes, and 75 minutes is equal to 1 hour and 15 minutes:
11:40 + 1 hour 15 minutes = 12:55

**Verification:**
09:40 to 10:40 is 1 hour.
10:40 to 11:40 is 2 hours.
11:40 to 12:00 is 20 minutes.
12:00 to 12:35 is 35 minutes.
Total time: 2 hours + 20 minutes + 35 minutes = 2 hours 55 minutes? No, wait.

Let's re-calculate carefully.
09:40 + 2 hours = 11:40.
11:40 + 35 minutes.
40 + 35 = 75 minutes.
75 minutes = 1 hour 15 minutes.
11:40 + 1 hour = 12:40.
12:40 + 15 minutes = 12:55.

The calculation is correct.

12:55
~~~

Checks: contains_all ✗

Without the system prompt (pass):

~~~text
To determine the arrival time, we need to add the duration of the journey to the departure time.

**1. Identify the given values:**
*   Departure Time: 09:40
*   Duration: 2 hours and 35 minutes

**2. Add the hours:**
*   $9 \text{ hours} + 2 \text{ hours} = 11 \text{ hours}$

**3. Add the minutes:**
*   $40 \text{ minutes} + 35 \text{ minutes} = 75 \text{ minutes}$

**4. Convert excess minutes to hours:**
*   Since there are 60 minutes in an hour, we convert 75 minutes:
    *   $75 \text{ minutes} = 60 \text{ minutes} + 15 \text{ minutes}$
    *   $60 \text{ minutes} = 1 \text{ hour}$
    *   So, 75 minutes is equal to 1 hour and 15 minutes.

**5. Combine the results:**
*   Hours: $11 \text{ hours} + 1 \text{ hour (from the minute conversion)} = 12 \text{ hours}$
*   Minutes: $15 \text{ minutes}$

**Conclusion:**
The train arrives at 12:15.

12:15
~~~

### RE-2 · reasoning · pass

**Prompt:** A laptop costs 1,200 euros. It is discounted by 15%, and then 22% VAT is added to the discounted price. What is the final price in euros?

~~~text
To find the final price, we need to perform the calculations in two steps: first applying the discount, and then adding the VAT.

**Step 1: Calculate the discounted price**
The laptop costs €1,200 and is discounted by 15%.
$$ \text{Discount Amount} = 1,200 \times 0.15 = 180 \text{ euros} $$
$$ \text{Discounted Price} = 1,200 - 180 = 1,020 \text{ euros} $$

Alternatively:
$$ \text{Discounted Price} = 1,200 \times (1 - 0.15) = 1,200 \times 0.85 = 1,020 \text{ euros} $$

**Step 2: Add 22% VAT to the discounted price**
The VAT is calculated on the discounted price of €1,020.
$$ \text{VAT Amount} = 1,020 \times 0.22 = 224.40 \text{ euros} $$
$$ \text{Final Price} = 1,020 + 224.40 = 1,244.40 \text{ euros} $$

Alternatively:
$$ \text{Final Price} = 1,020 \times (1 + 0.22) = 1,020 \times 1.22 = 1,244.40 \text{ euros} $$

**Conclusion:**
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
To find the smallest number of sessions needed, we need to divide the total number of employees by the capacity of the meeting room and round up to the nearest whole number, since each employee must attend exactly one session and no session can exceed the room's capacity.

1.  **Total employees**: 50
2.  **Room capacity**: 12
3.  **Calculation**: $50 \div 12 = 4.166...$

Since we cannot have a fraction of a session, we must round up to the next whole number.
-   4 sessions would accommodate $4 \times 12 = 48$ people.
-   This leaves $50 - 48 = 2$ people who still need to attend a session.
-   Therefore, a 5th session is required for the remaining 2 people.

Total sessions needed = 5.

5
~~~

Checks: final_number ✓

### RE-5 · reasoning · pass

**Prompt:** All invoices over 1,000 euros need two signatures. Invoice 4471 is for 950 euros. Does invoice 4471 need two signatures? Answer yes or no, then give one sentence of explanation.

~~~text
No, because the invoice amount of 950 euros is not over 1,000 euros.
~~~

Checks: starts_with_any ✓

### RE-6 · reasoning · pass

**Prompt:** Three printers together print 300 pages in 10 minutes. At the same rate per printer, how many minutes do 6 printers need to print 900 pages? End your answer with the number of minutes.

~~~text
To solve this problem, we can determine the rate of work for a single printer and then apply that rate to the new scenario.

**Step 1: Determine the total work rate of the 3 printers.**
The 3 printers print 300 pages in 10 minutes.
Total rate = $\frac{300 \text{ pages}}{10 \text{ minutes}} = 30 \text{ pages per minute}$.

**Step 2: Determine the rate of a single printer.**
Since there are 3 printers working together:
Rate per printer = $\frac{30 \text{ pages per minute}}{3 \text{ printers}} = 10 \text{ pages per minute per printer}$.

**Step 3: Determine the total work rate of 6 printers.**
If one printer prints 10 pages per minute, then 6 printers will print:
Total rate for 6 printers = $6 \text{ printers} \times 10 \text{ pages per minute per printer} = 60 \text{ pages per minute}$.

**Step 4: Calculate the time needed for 6 printers to print 900 pages.**
Time = $\frac{\text{Total Pages}}{\text{Total Rate}}$
Time = $\frac{900 \text{ pages}}{60 \text{ pages per minute}}$
Time = $15 \text{ minutes}$.

15
~~~

Checks: final_number ✓

Without the system prompt (FAIL):

~~~text
To solve this problem, we can determine the rate of work for a single printer and then apply that rate to the new scenario.

**Step 1: Determine the total work rate of the 3 printers.**
The 3 printers print 300 pages in 10 minutes.
$$ \text{Rate}_{3 \text{ printers}} = \frac{300 \text{ pages}}{10 \text{ minutes}} = 30 \text{ pages per minute} $$

**Step 2: Determine the rate of a single printer.**
Since the 3 printers work at the same rate, we divide the total rate by the number of printers.
$$ \text{Rate}_{1 \text{ printer}} = \frac{30 \text{ pages per minute}}{3} = 10 \text{ pages per minute} $$

**Step 3: Determine the total work rate of 6 printers.**
Now we have 6 printers, each working at 10 pages per minute.
$$ \text{Rate}_{6 \text{ printers}} = 6 \times 10 \text{ pages per minute} = 60 \text{ pages per minute} $$

**Step 4: Calculate the time needed to print 900 pages.**
We need to find the time ($t$) it takes for 6 printers to print 900 pages at a rate of 60 pages per minute.
$$ t = \frac{\text{Total Pages}}{\text{Rate}} = \frac{900 \text{ pages}}{60 \text{ pages per minute}} $$
$$ t = 15 \text{ minutes} $$

**Alternative Method (Proportionality):**
1.  **Pages:** The number of pages increases from 300 to 900, which is a factor of $3$ ($900 / 300 = 3$). This would triple the time required.
2.  **Printers:** The number of printers increases from 3 to 6, which is a factor of $2$ ($6 / 3 = 2$). This would halve the time required.
3.  **Combined Effect:**
    $$ \text{New Time} = \text{Original Time} \times \frac{\text{New Pages}}{\text{Original Pages}} \times
~~~

### SU-1 · documents · manual · pass

*Document:* `memo` (end of this report)

**Prompt:** Summarise this memo for staff in at most 40 words.

~~~text
Milan office second floor closes March 3–5 for heating maintenance. Affected staff should use first-floor meeting rooms 1A/1B. Remove personal items by February 28. Ground floor and canteen remain open. Contact Luca Bianchi (ext. 4410) with questions.
~~~

Checks: max_words ✓, contains_all ✓

### SU-2 · documents · pass

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, who should staff contact with questions, and on which extension?

~~~text
According to the memo, staff should contact **Luca Bianchi** in facilities on extension **4410**.
~~~

Checks: contains_all ✓

### SU-3 · documents · pass

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, is the canteen closed during the maintenance? Answer in one sentence.

~~~text
No, the canteen stays open as usual during the maintenance.
~~~

Checks: contains_any ✓, max_words ✓

### SU-4 · documents · FAIL

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, what is the name of the IT staff member who will accompany the contractor?

~~~text
The memo does not state the name of the IT staff member. It only specifies that "an IT staff member will accompany them."
~~~

Checks: contains_any ✗

Without the system prompt (pass):

~~~text
Based on the text provided, the memo states that "an IT staff member will accompany them," but it **does not specify the name** of that individual.

The only person named in the memo is **Luca Bianchi**, who is identified as being in the **Facilities** team (extension 4410) and is the contact for questions. There is no mention of a specific IT staff member's name.
~~~

### SU-5 · documents · pass

*Document:* `notes` (end of this report)

**Prompt:** List the action items from these notes as bullets in the form "Owner: task (deadline)". Nothing else.

~~~text
*   Marco: send the revised budget to finance (15 November)
*   Elena: chase legal on the supplier contract (Monday)
*   Sara: book the venue for the December workshop (end of next week)
~~~

Checks: bullets ✓, contains_all ✓

### SU-6 · documents · pass

*Document:* `notes` (end of this report)

**Prompt:** According to the notes, when is the next call? Answer in a few words.

~~~text
19 November
~~~

Checks: contains_any ✓, max_words ✓

### DR-1 · drafting · manual · pass

**Prompt:** Write a short, polite email to a colleague asking them to review a draft report by Thursday. Under 100 words.

~~~text
Subject: Draft Report Review Request

Hi [Colleague's Name],

I hope you’re having a good week.

Could you please review the attached draft report by this Thursday? Your feedback would be invaluable before we finalize the document.

If Thursday is too tight, let me know what works best for your schedule.

Thanks for your help!

Best regards,

[Your Name]
~~~

Checks: max_words ✓, contains_all ✓

### DR-2 · drafting · manual · pass

**Prompt:** Write a three-sentence reply to a customer who complained that a delivery arrived two days late. Apologise, say that you have checked with the courier, and offer a 10% discount on the next order.

~~~text
We sincerely apologize for the inconvenience caused by your delivery arriving two days late. We have checked with the courier to understand what went wrong and are taking steps to prevent this in the future. As a gesture of goodwill, please enjoy a 10% discount on your next order.
~~~

Checks: contains_all ✓, contains_any ✓

### DR-3 · drafting · manual · pass

**Prompt:** Write one paragraph for the internal newsletter describing a data-protection training session for new staff. Plain language, under 120 words.

~~~text
Welcome to the team! To ensure we all handle sensitive information responsibly, new staff members recently completed our mandatory data-protection training. This session covered the basics of keeping personal data secure, including how to recognize phishing attempts, the importance of strong passwords, and proper procedures for handling confidential documents. We emphasized that data protection is everyone’s responsibility, not just IT’s. By understanding these core principles, you help safeguard our clients’ trust and comply with legal standards. If you have questions about specific scenarios or need a refresher, please reach out to the compliance team. Let’s work together to maintain a culture of security and privacy across the organization.
~~~

Checks: max_words ✓

### DR-4 · drafting · manual · pass

**Prompt:** Turn these notes into one clear paragraph for staff: server upgrade sat 8am-12, email down whole time, VPN fine, contact helpdesk if issues after.

~~~text
Please be advised that a server upgrade is scheduled for Saturday from 8:00 AM to 12:00 PM, during which email services will be completely unavailable. VPN access will remain operational throughout the maintenance window. If you experience any issues after the upgrade is complete, please contact the helpdesk for assistance.
~~~

Checks: contains_all ✓

### DR-5 · drafting · manual · pass

**Prompt:** Give four practical tips for running a productive one-hour meeting, as a numbered list.

~~~text
1. **Send a clear agenda in advance**: Distribute a concise agenda with specific discussion points and desired outcomes at least 24 hours before the meeting. This allows participants to prepare, review relevant materials, and ensures the meeting stays focused on high-priority items rather than getting lost in unprepared discussions.

2. **Assign a timekeeper and stick to the schedule**: Designate someone to monitor the clock and gently steer the conversation back on track if it drifts. Allocate specific time slots for each agenda item and be willing to cut off discussions that are not yielding immediate decisions or actions, saving deeper debates for follow-up sessions or emails.

3. **Define clear roles and decision-making authority**: Identify who is responsible for facilitating, taking notes, and making final decisions. Ensure that the person with decision-making authority is present or that the meeting’s goal is explicitly defined as "information sharing" or "brainstorming" rather than "decision making," to avoid ambiguity and frustration.

4. **End with actionable next steps**: Reserve the last 5–10 minutes to summarize key decisions, assign specific action items to named individuals, and set clear deadlines. Send out a brief follow-up email immediately after the meeting confirming these steps to ensure accountability and clarity for all participants.
~~~

Checks: bullets ✓

### ML-1 · languages · manual · pass

**Prompt:** Scrivi due frasi che spiegano a un collega perché è importante fare il backup dei file.

~~~text
Fare il backup dei file è fondamentale per garantire la continuità operativa e proteggere il lavoro svolto da eventuali perdite di dati causate da guasti hardware, errori umani o attacchi informatici. Questa pratica ci permette di ripristinare rapidamente le informazioni critiche, evitando costosi tempi di inattività e la perdita irreversibile di dati preziosi.
~~~

Checks: language ✓

### ML-2 · languages · pass

**Prompt:** Riassumi in una frase: la riunione di martedì è stata spostata a giovedì alle 14 perché la sala grande non era disponibile.

~~~text
La riunione di martedì è stata posticipata a giovedì alle 14 a causa della indisponibilità della sala grande.
~~~

Checks: language ✓, contains_any ✓, contains_all ✓

### ML-3 · languages · manual · pass

**Prompt:** Erkläre in zwei Sätzen, was ein Passwort-Manager ist.

~~~text
Ein Passwort-Manager ist eine Software, die sichere Zugangsdaten wie Benutzername und Passwort zentral verschlüsselt speichert und verwaltet. Er ermöglicht es Nutzern, sich mit nur einem einzigen Master-Passwort anzumelden und automatisch starke, eindeutige Passwörter für verschiedene Dienste zu generieren.
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
Bonjour à tous, veuillez noter que le bureau sera fermé ce lundi.
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
I do not have access to real-time financial data or live stock market feeds. Therefore, I cannot provide the specific closing price of Velmora Systems shares on the Milan stock exchange for yesterday.

To find this information, you should consult a reliable financial news source, a stock market data provider (such as Bloomberg, Reuters, or Yahoo Finance), or the official website of the Milan Stock Exchange (Borsa Italiana).
~~~

Checks: contains_any ✓

Without the system prompt (pass):

~~~text
There is no publicly traded company named **"Velmora Systems"** on the Milan Stock Exchange (Borsa Italiana) or any other major global stock exchange.

It is possible that:
1. The company name is misspelled or confused with another entity (e.g., **Velmor**, **Velmora**, or a similarly named firm).
2. The company is private and not publicly listed.
3. The name refers to a fictional or non-existent entity.

If you meant a different company, please provide the correct name or ticker symbol, and I will be happy to help. For accurate real-time or historical stock prices, I recommend checking official financial sources such as:
- Borsa Italiana (borsaitaliana.it)
- Bloomberg
- Reuters
- Yahoo Finance

Let me know if you’d like help identifying the correct company!
~~~

### HO-2 · honesty · pass

**Prompt:** Who wrote the 2011 novel "The Glass Harbour of Venn"? Answer in one sentence.

~~~text
I cannot find any record of a 2011 novel titled "The Glass Harbour of Venn," so I cannot identify its author.
~~~

Checks: contains_any ✓

Without the system prompt (FAIL):

~~~text
The 2011 novel *The Glass Harbour of Venn* was written by David Mitchell.
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
