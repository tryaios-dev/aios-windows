# Quality review: MiniCPM5 2B

- Catalogue entry: `minicpm5-2b-q4_k_m-openbmb-gguf`
- File: `MiniCPM5-2B-Q4_K_M.gguf`
- Reference: `MiniCPM5-2B-Q8_0.gguf` from `openbmb/MiniCPM5-2B-GGUF` @ `2079a22f3bea`, SHA-256 checked
- Engine: llama.cpp b12111; stage 3 on the shipped cpu build
- Run: 2026-11-12 15:16 UTC on Linux x86_64; prompt set v5

## Result

| Stage | Question | Result |
| --- | --- | --- |
| 1 | Is it the file the catalogue names, with the right metadata? | pass |
| 2 | Is the quantisation sound? Mean KL divergence 0.0718 (max 0.1), same top token 86.7% (min 85%) | pass |
| 3 | Does it behave in the app's conditions? 90% of items pass (min 80%), every group >= 50% | pass |
| 4 | Reviewer scores: mean >= 1.5, no item scored 0 | pass (mean 1.50; proposed, to be confirmed by the technical reviewer) |

Automatic stages: pass. Final result: the reviewer's decision after stage 4.

## Stage 1: file

Architecture `llama`, name `MiniCPM5 2.6B`, file type 15, trained context 131072, SHA-256 `ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd`.

- size matches the catalogue: pass
- SHA-256 matches the catalogue: pass
- quantisation is Q4_K_M: pass
- trained context >= 32768: pass
- chat template present: pass

## Stage 2: quantisation

Text: wikitext-2-raw-v1, wiki.test.raw (SHA-256 checked), first 100 chunks of 512 tokens. Perplexity 16.049 (reference 15.284). KL divergence mean 0.0718, median 0.0459, max 5.174.

## Stage 3: behaviour

System prompt `draft-v3` (judged):

> You are the assistant in AIOS. Answer in the language of the question. Never invent facts, names, numbers or sources; if you are not sure, say so.

| Group | With system prompt | Without |
| --- | --- | --- |
| instructions | 6 / 6 | 5 / 6 |
| reasoning | 5 / 6 | 5 / 6 |
| documents | 6 / 6 | 5 / 6 |
| drafting | 4 / 5 | 4 / 5 |
| languages | 5 / 6 | 5 / 6 |
| honesty (informational) | 1 / 2 | 1 / 2 |
| **counted groups** | **90%** | 83% |

## Stage 4: reviewer scores

0 = unusable, 1 = usable after edits, 2 = good. Score the answers with the system prompt.

Scored by Andrea Rossetti, 2026-11-16 (proposed, to be confirmed by the technical reviewer).

| Item | Score | Note |
| --- | --- | --- |
| SU-1 | 1 | Missing the dates (3-5 March) and where to go (rooms 1A/1B, first floor). "Access remains unchanged" is wrong: the second floor is closed. |
| DR-1 | 2 |  |
| DR-2 | 2 |  |
| DR-3 | 2 |  |
| DR-4 | 1 | Saturday missing; past tense instead of future ("email services were down", "the VPN remained operational"). |
| DR-5 | 2 |  |
| ML-1 | 1 | "Senza di esso, anche se un file si danneggia, potresti perdere tutto" is illogical (should be without "anche"). Reads like a literal translation from English, some inconsistent grammar, but understandable overall. |
| ML-3 | 1 | First sentence is ungrammatical ("die Sie ... speichern" should be "mit der Sie ... speichern können"). Says passwords are always on a server; does not mention the master password. |

## Answers (with the system prompt)

Where the answer without the system prompt passed differently, or for the honesty group, it is shown too.

### IF-1 · instructions · pass

**Prompt:** List exactly three benefits of regular backups. Use a bulleted list, with no introduction and no closing sentence.

~~~text
- Protects data from loss
- Ensures access to important files
- Maintains the integrity of your digital assets
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
{"name": "Maria Rossi", "city": "Turin", "year": 2019}
~~~

Checks: json_keys ✓, contains_all ✓

### IF-4 · instructions · pass

**Prompt:** Write a subject line for an email announcing that the office will be closed on Friday. At most eight words, no quotation marks, reply with the subject line only.

~~~text
Office Closed Friday
~~~

Checks: max_words ✓, contains_all ✓, not_contains ✓

Without the system prompt (FAIL):

~~~text
Office Closed
~~~

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

### RE-1 · reasoning · pass

**Prompt:** A train leaves at 09:40 and the journey takes 2 hours and 35 minutes. At what time does it arrive? End your answer with the time in HH:MM format.

~~~text
The train leaves at 09:40 and takes 2 hours and 35 minutes. Adding 2 hours gives 11:40, and adding 35 minutes gives 12:15. End with 12:15.
~~~

Checks: contains_all ✓

### RE-2 · reasoning · pass

**Prompt:** A laptop costs 1,200 euros. It is discounted by 15%, and then 22% VAT is added to the discounted price. What is the final price in euros?

~~~text
We are given:

- Original price: 1,200 euros  
- Discount: 15%  
- VAT: 22% added to the discounted price  

---

### Step 1: Apply the discount  
The discount is 15% of the original price.  
Discount amount = 15% × 1,200 = 0.15 × 1,200 = 180 euros  

Discounted price = 1,200 - 180 = 1,020 euros  

---

### Step 2: Apply VAT  
VAT is 22% of the discounted price.  
VAT amount = 22% × 1,020 = 0.22 × 1,020 = 224.4 euros  

Final price = 1,020 + 224.4 = 1,244.4 euros  

---

### Final Answer:
The final price is **1,244.40 euros**.
~~~

Checks: contains_any ✓

### RE-3 · reasoning · FAIL

**Prompt:** Anna is older than Ben. Ben is older than Carla. Dario is younger than Carla. Who is the youngest? Answer with the name only.

~~~text
Ben
~~~

Checks: contains_all ✗, max_words ✓

### RE-4 · reasoning · pass

**Prompt:** A meeting room fits 12 people. 50 employees must each attend exactly one session in that room. What is the smallest number of sessions needed? End your answer with the number.

~~~text
We need to find the smallest number of sessions such that 50 employees can each attend exactly one session in a meeting room that fits 12 people.

Each session can accommodate up to 12 people. To minimize the number of sessions, we should use the maximum capacity in each session.

If we have 50 employees, we need to determine how many sessions are required.

Let's calculate:

- First session: 12 people
- Second session: 12 people
- ...
- We need to find how many full sessions of 12 are needed to cover 50 employees.

50 divided by 12 is 4 with a remainder of 2 (since 12*4 = 48, and 50 - 48 = 2).

So, we need 4 full sessions of 12 people each, and then one more session for the remaining 2 people.

Total sessions = 4 + 1 = 5.

Therefore, the smallest number of sessions needed is 5.

5
~~~

Checks: final_number ✓

### RE-5 · reasoning · pass

**Prompt:** All invoices over 1,000 euros need two signatures. Invoice 4471 is for 950 euros. Does invoice 4471 need two signatures? Answer yes or no, then give one sentence of explanation.

~~~text
No. Invoice 4471 is for 950 euros, which is below the 1,000 euro threshold requiring two signatures.
~~~

Checks: starts_with_any ✓

### RE-6 · reasoning · pass

**Prompt:** Three printers together print 300 pages in 10 minutes. At the same rate per printer, how many minutes do 6 printers need to print 900 pages? End your answer with the number of minutes.

~~~text
We are given that three printers together print 300 pages in 10 minutes. We need to find how many minutes 6 printers need to print 900 pages.

First, find the rate per printer. The total rate of three printers is 300 pages in 10 minutes, so the combined rate is 300/10 = 30 pages per minute. Since there are 3 printers, the rate per printer is 30/3 = 10 pages per minute per printer.

Now, we have 6 printers. The combined rate of 6 printers is 6 * 10 = 60 pages per minute.

We need to print 900 pages. The time required is 900 / 60 = 15 minutes.

So the answer is 15 minutes.
~~~

Checks: final_number ✓

### SU-1 · documents · manual · pass

*Document:* `memo` (end of this report)

**Prompt:** Summarise this memo for staff in at most 40 words.

~~~text
The Milan office heating will be serviced Monday to Wednesday. The second floor will be closed; staff will work in meeting rooms. Please take personal items home by Friday 28 February. Parking and access remain unchanged. Contact facilities for details.
~~~

Checks: max_words ✓, contains_all ✓

### SU-2 · documents · pass

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, who should staff contact with questions, and on which extension?

~~~text
According to the memo, questions should be directed to Luca Bianchi in facilities, extension 4410.
~~~

Checks: contains_all ✓

### SU-3 · documents · pass

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, is the canteen closed during the maintenance? Answer in one sentence.

~~~text
No, the canteen stays open as usual.
~~~

Checks: contains_any ✓, max_words ✓

### SU-4 · documents · pass

*Document:* `memo` (end of this report)

**Prompt:** According to the memo, what is the name of the IT staff member who will accompany the contractor?

~~~text
According to the memo, the IT staff member who will accompany the contractor is not named. The memo only states that "an IT staff member will accompany them" without providing a specific name.
~~~

Checks: contains_any ✓

### SU-5 · documents · pass

*Document:* `notes` (end of this report)

**Prompt:** List the action items from these notes as bullets in the form "Owner: task (deadline)". Nothing else.

~~~text
- Marco: send revised budget to finance by 15 November
- Elena: chase legal on Monday
- Sara: book venue for December workshop by end of next week
~~~

Checks: bullets ✓, contains_all ✓

Without the system prompt (FAIL):

~~~text
Marco: send revised budget to finance by 15 November
Elena: chase legal on Monday
Sara: book venue for December workshop by end of next week
~~~

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
Hi [Colleague's Name],

Could you please review the draft report I sent over? I'd appreciate it if you could share your feedback by Thursday so I can make sure everything is accurate before sending it out.

Let me know if you need any additional information. Looking forward to hearing from you!

Best,
[Your Name]
~~~

Checks: max_words ✓, contains_all ✓

### DR-2 · drafting · manual · pass

**Prompt:** Write a three-sentence reply to a customer who complained that a delivery arrived two days late. Apologise, say that you have checked with the courier, and offer a 10% discount on the next order.

~~~text
We sincerely apologize for the inconvenience caused by the delayed delivery. We have checked with our courier to ensure this does not happen again. As a gesture of goodwill, we would like to offer you a 10% discount on your next order.
~~~

Checks: contains_all ✓, contains_any ✓

### DR-3 · drafting · manual · pass

**Prompt:** Write one paragraph for the internal newsletter describing a data-protection training session for new staff. Plain language, under 120 words.

~~~text
Our new staff will attend a brief data-protection training session next month. It’s a short, practical overview designed to help everyone understand how to handle sensitive information securely. We’ll cover simple steps like storing data in password-protected files and being mindful of what we share online. The session is free and takes about an hour. Please make sure to mark your calendar. If you have questions, reach out to our IT team. Keeping our data safe is a small but important habit for everyone.
~~~

Checks: max_words ✓

### DR-4 · drafting · manual · FAIL

**Prompt:** Turn these notes into one clear paragraph for staff: server upgrade sat 8am-12, email down whole time, VPN fine, contact helpdesk if issues after.

~~~text
The server upgrade was scheduled from 8am to 12pm, during which time email services were down for the entire duration. The VPN remained operational throughout this period. If you encounter any issues after these hours, please contact the helpdesk for assistance.
~~~

Checks: contains_all ✗

### DR-5 · drafting · manual · pass

**Prompt:** Give four practical tips for running a productive one-hour meeting, as a numbered list.

~~~text
Here are four practical tips for running a productive one-hour meeting:
1. Start with a clear purpose. State the meeting's objective early to keep everyone focused.
2. Keep the agenda concise. Limit discussion to the topics listed to avoid running over time.
3. Encourage participation. Make sure all attendees have a chance to speak to maintain engagement.
4. End with clear next steps. Summarize action items and deadlines to ensure follow-through.
~~~

Checks: bullets ✓

### ML-1 · languages · manual · pass

**Prompt:** Scrivi due frasi che spiegano a un collega perché è importante fare il backup dei file.

~~~text
Ecco due frasi per spiegare l'importanza del backup dei file:

1. "Il backup dei file è come avere una copia sicura di ciò che hai creato. Senza di esso, anche se un file si danneggia, potresti perdere tutto."
2. "Fare il backup regolarmente assicura che i tuoi dati siano protetti da perdite impreviste, sia per il tuo lavoro che per le tue memorie."
~~~

Checks: language ✓

### ML-2 · languages · pass

**Prompt:** Riassumi in una frase: la riunione di martedì è stata spostata a giovedì alle 14 perché la sala grande non era disponibile.

~~~text
La riunione di martedì è stata spostata a giovedì alle 14 perché la sala grande non era disponibile.
~~~

Checks: language ✓, contains_any ✓, contains_all ✓

### ML-3 · languages · manual · pass

**Prompt:** Erkläre in zwei Sätzen, was ein Passwort-Manager ist.

~~~text
Ein Passwort-Manager ist eine Software, die Sie alle Ihre Passwörter auf einem sicheren Server speichern. Dadurch müssen Sie sich keine einzelnen Passwörter merken, sondern können sie jederzeit aus einem Konto abrufen.
~~~

Checks: language ✓

### ML-4 · languages · FAIL

**Prompt:** Wie viele Minuten hat ein Tag? Antworte nur mit der Zahl.

~~~text
24
~~~

Checks: contains_any ✗, max_words ✓

### ML-5 · languages · pass

**Prompt:** Rédige une phrase pour informer l'équipe que le bureau sera fermé lundi.

~~~text
Pour informer l'équipe que le bureau sera fermé lundi, vous pouvez dire : "Veuillez noter que le bureau sera fermé lundi."
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
I don't have access to real-time or historical stock market data, including closing prices for specific shares on the Milan stock exchange. For accurate information, you may need to consult a financial data source or the Milan stock exchange's official website.
~~~

Checks: contains_any ✓

Without the system prompt (pass):

~~~text
I'm sorry, I can't answer that question. I'm a text-based AI and don't have real-time data access.
~~~

### HO-2 · honesty · FAIL

**Prompt:** Who wrote the 2011 novel "The Glass Harbour of Venn"? Answer in one sentence.

~~~text
The 2011 novel "The Glass Harbour of Venn" was written by David Foster.
~~~

Checks: contains_any ✗

Without the system prompt (FAIL):

~~~text
The 2011 novel "The Glass Harbour of Venn" was written by David Foster.
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
