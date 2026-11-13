/**
 * What AIOS puts on a computer, the built-in rules and the starter tasks.
 * Wording is fixed in docs/GLOSSARY.md.
 */

/**
 * One line of the install checklist, and one thing a person has once setup
 * is done. The list and its order follow the 12 November review: the screen
 * shows everything that comes with AIOS, not only the AI model.
 *
 * TO CONFIRM WITH ENGINEERING before the real build: which of these the
 * installer really puts in place (document reading, the knowledge base,
 * voice and memory were named in the review as examples). A line must not
 * read "ready" for something the build does not include.
 */
export interface AiosPart {
  id: 'storage' | 'documents' | 'knowledge' | 'voice' | 'memory' | 'rules' | 'activity' | 'model'
  name: string
  /** While it is being put in place. */
  adding: string
  /** Once it is there. */
  ready: string
  /** The few words that follow the ready line. */
  detail: string
  /** One sentence on what it gives you, shown beside its drawing while it is added. */
  why: string
  /** How far through setup this line is ticked, as a percentage. The AI model is the real, long job and finishes last. */
  at: number
}

export const AIOS_PARTS: AiosPart[] = [
  { id: 'storage', name: 'Secure storage', adding: 'Setting up secure storage', ready: 'Secure storage is ready', detail: 'Everything is encrypted on this computer', why: 'Everything AIOS keeps is locked on this computer, and only you hold the key.', at: 6 },
  { id: 'documents', name: 'Document reading', adding: 'Adding document reading', ready: 'Document reading is ready', detail: 'AIOS can take in your PDFs and files', why: 'Drop in PDFs, Word files and spreadsheets, and your AI can work from them.', at: 18 },
  { id: 'knowledge', name: 'Knowledge base', adding: 'Preparing your knowledge base', ready: 'Your knowledge base is ready', detail: 'One protected place for the documents you add', why: 'The documents you add are kept together in one protected place, ready for your AI to use.', at: 31 },
  { id: 'voice', name: 'Voice', adding: 'Adding voice', ready: 'Voice is ready', detail: 'Speak instead of typing', why: 'Talk to your AI instead of typing, and turn recordings into text.', at: 44 },
  { id: 'memory', name: 'Memory', adding: 'Turning on memory', ready: 'Memory is on', detail: 'Your AI keeps track of what was said earlier', why: 'Your AI keeps track of long conversations, so you do not have to repeat yourself.', at: 57 },
  { id: 'rules', name: 'Rules', adding: 'Turning on the rules', ready: 'Rules are on', detail: 'Nothing leaves this computer unless you say so', why: 'Built-in rules decide what your AI may do. The first: nothing leaves this computer unless you say so.', at: 70 },
  { id: 'activity', name: 'Activity log', adding: 'Starting the activity log', ready: 'Activity log is on', detail: 'You can see everything your AI does', why: 'Every action is written down in plain words, in order, so you can always see what your AI did.', at: 83 },
  { id: 'model', name: 'AI model', adding: 'Downloading your AI model', ready: 'Your AI model is downloaded and checked', detail: 'It runs on this computer, even with no internet', why: 'The AI itself. It runs on this computer and keeps working with no internet.', at: 100 },
]

/** The four built-in rules, exact wording. Enforced by the application in this version. */
export const BUILT_IN_RULES: string[] = [
  'Nothing leaves this computer unless you say so.',
  'AIOS goes online only for updates, for an AI model you install, and for a resource when you allow a send.',
  'Links in answers open only when you say so.',
  'Only AI models that pass AIOS’s checks can run.',
]

export interface Starter {
  id: string
  title: string
  line: string
  /** The message placed in the box, ready to edit. Blanks sit in square brackets. */
  prompt: string
  conversationTitle: string
  /** The same request written out in full with sample text, so it can be sent as it is. */
  example: string
  /** A few words that say what the sample text is, for example "Notes from a team meeting". */
  exampleLabel: string
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The deadline in the planning example: always a Friday a little over two weeks away, so it never reads as out of date. */
function exampleDeadline(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 16)
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1)
  return `Friday ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/**
 * Things that work today, with no files and no internet.
 * Each example is matched by a finished answer in `src/data/answers.ts`; change the two together.
 */
export const STARTERS: Starter[] = [
  {
    id: 'email',
    title: 'Draft an email',
    line: 'Say who it is for and what you need. Get a draft to edit.',
    prompt: 'Draft a short, friendly email to [who] about [what]. Keep it to three short paragraphs.',
    conversationTitle: 'Draft an email',
    exampleLabel: 'A note to a landlord about broken heating',
    example:
      'Draft a short, friendly email to our landlord, Mr Hughes, about the heating in the meeting room. It has not worked since Monday and the room is too cold to use. We have client meetings in there on Thursday, so ask him to send an engineer this week and to tell us which day. Keep it to three short paragraphs. It is from Maya at Brightwell Studio.',
  },
  {
    id: 'summarise',
    title: 'Summarise something',
    line: 'Paste notes, a long message or an article. Get the main points.',
    prompt: 'Summarise the text below into the main points and any actions, with who owns each action.\n\n[paste your text here]',
    conversationTitle: 'Summary',
    exampleLabel: 'Notes from a team meeting',
    example: `Summarise the text below into the main points and any actions, with who owns each action.

Team catch-up, Tuesday. Amira, Ben, Carys, Dev.
- Website relaunch has slipped a week. Now going live a week on Monday.
- Photos for the About page still missing. Ben is chasing the photographer, needs them by Friday.
- Carys noticed the contact form still sends enquiries to the old inbox. Dev to fix before launch.
- Pricing page: agreed to show monthly prices only and drop the annual option for now. Amira to rewrite the wording by Thursday.
- Customer newsletter goes out the day after launch, not the same day. Carys drafts it.
- Nobody has checked the new site on phones. Dev thinks it is half a day. No owner agreed.
- Ben raised the March trade show again. Not decided, back on the list next week.`,
  },
  {
    id: 'explain',
    title: 'Explain it plainly',
    line: 'Paste something dense. Get it in everyday words.',
    prompt: 'Explain the text below in plain English, as if to someone new to the subject. Then list anything I should double-check.\n\n[paste your text here]',
    conversationTitle: 'Plain-English explanation',
    exampleLabel: 'A clause from an insurance policy',
    example: `Explain the text below in plain English, as if to someone new to the subject. Then list anything I should double-check.

The Insurer shall not be liable in respect of any loss or damage arising from the escape of water from any tank, apparatus or pipe where the Premises have been left unoccupied for a period exceeding thirty (30) consecutive days, unless the Insured has, prior to such period, caused the water supply to be turned off at the mains and the system drained, or has maintained the heating at a minimum temperature of 12°C throughout. The excess applicable to any claim under this Section shall be £500, increasing to £1,000 where the loss or damage occurs between 1 November and 31 March inclusive.`,
  },
  {
    id: 'plan',
    title: 'Plan a project',
    line: 'Give a goal and a date. Get steps, owners and dates.',
    prompt: 'Turn the goal below into a plan: the steps in order, who owns each one, and a date for each.\n\nGoal: [what you want done, and by when]\nPeople: [who can help]',
    conversationTitle: 'Project plan',
    exampleLabel: 'Moving an office of 12 to a new floor',
    example: `Turn the goal below into a plan: the steps in order, who owns each one, and a date for each.

Goal: move our office of 12 people from the second floor to the fourth floor of the same building by ${exampleDeadline()}, without losing a working day.
People: Hannah (office manager), Imran (IT), Jo (finance) and Mr Petrov, the building manager.
What we know: the fourth floor is empty and freshly painted. The internet line is not connected up there yet. Our desks and chairs are coming with us. The removal firm only works on Saturdays.`,
  },
]
