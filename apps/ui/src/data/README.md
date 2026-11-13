# Sample data

Everything in this folder is synthetic. Company names, people, figures, prices, hashes and model digests
are invented for the prototype. Nothing here comes from a real client, a real person or a real pilot.

| File | What it holds |
| --- | --- |
| `catalogue.ts` | The AI models AIOS lists (Model Catalogue v1 shape, MVP 9.6) and a representative hardware profile |
| `answers.ts` | The canned answers the streaming simulation draws from |
| `seed.ts` | Projects, conversations, messages, summaries and the activity record built from them |
| `stack.ts` | The parts of AIOS shown in the install checklist, the four built-in rules and the ready-made requests |
| `knowledge.ts` | Sample folders and files for My secure knowledge, and which file kinds can be read |
| `skills.ts` | The skills shown under Add skills to my AI |
| `resources.ts` | The cloud AI models and computing power shown under Add resources to my AI, with demonstration prices |

The activity record is generated at load time so that timestamps read naturally ("2 hours ago").
Event hashes are deterministic placeholders with the right length and chain shape; they are not SHA-256.
