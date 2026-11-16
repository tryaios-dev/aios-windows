"""The skills AIOS lists under "Add skills to my AI".

Each skill is an instruction the AI on this computer follows while the skill is on. Nothing is
downloaded and nothing runs outside the AI, so a skill can only use what its ``uses`` list says.
Ids match the UI's icons (``apps/ui/src/assets/icons``).
"""

from dataclasses import dataclass

PUBLISHER = "AIOS"
INCLUDED = "Included"
LICENCE = "Apache-2.0"
CONVERSATION = "The conversation you are in"
CATEGORIES = ("Writing", "Documents", "Numbers", "Voice", "Languages", "Images")


@dataclass(frozen=True)
class Entry:
    id: str
    name: str
    line: str
    detail: str
    category: str
    uses: tuple[str, ...]
    example: str
    instruction: str
    included: bool = False
    version: str = "1.0"
    # A skill listed before it can run (it needs an engine a later version brings).
    available: bool = True
    publisher: str = PUBLISHER
    licence: str | None = None
    download_bytes: int | None = None

    @property
    def size_bytes(self) -> int:
        return self.download_bytes or len(self.instruction.encode())


SKILLS: tuple[Entry, ...] = (
    Entry(
        id="write",
        name="Write and summarise",
        line="Draft, rewrite and shorten. The everyday work.",
        detail=(
            "Writes emails, letters and reports, rewrites text in a different tone, and turns long "
            "text into the main points."
        ),
        category="Writing",
        uses=(CONVERSATION,),
        example="Draft a short, friendly email to our landlord about the heating.",
        instruction="",
        included=True,
    ),
    Entry(
        id="read-documents",
        name="Read my documents",
        line="Answer from what is in My secure knowledge.",
        detail=(
            "Finds the right passages in the documents you have added and answers from them, "
            "showing which document each point came from."
        ),
        category="Documents",
        uses=(CONVERSATION, "Documents in My secure knowledge"),
        example="What notice period does the lease give us?",
        instruction="",
        included=True,
    ),
    Entry(
        id="minutes",
        name="Meeting minutes",
        line="Turn rough notes or a transcript into minutes with actions.",
        detail=(
            "Takes notes or a transcript and writes minutes: decisions, actions with owners and "
            "dates, and questions left open."
        ),
        category="Writing",
        uses=(CONVERSATION,),
        example="Write minutes from these notes, with an action list.",
        instruction=(
            "Meeting minutes skill: when the person gives meeting notes or a transcript, or asks "
            "for minutes, write minutes under these headings: Attendees (if named), Decisions, "
            "Actions (each with an owner and a date when given, otherwise 'owner not stated'), "
            "Open questions. Keep to what the notes say and never invent names or dates."
        ),
    ),
    Entry(
        id="spreadsheets",
        name="Spreadsheet analyst",
        line="Ask questions of a table and get figures back.",
        detail=(
            "Reads spreadsheets and tables, works out totals, averages and trends, and shows the "
            "working so you can check it."
        ),
        category="Numbers",
        uses=(CONVERSATION, "Spreadsheets you choose from My secure knowledge"),
        example="Which supplier was cheapest over the year, and by how much?",
        instruction=(
            "Spreadsheet analyst skill: when a question is about a table or spreadsheet, work "
            "from the rows given. Show the working step by step (which rows, which figures, the "
            "sum or average), then the answer. Say plainly when the table does not hold what is "
            "needed instead of guessing."
        ),
    ),
    Entry(
        id="contracts",
        name="Contract checker",
        line="Flag unusual clauses and missing terms in an agreement.",
        detail=(
            "Compares an agreement with a checklist of common terms and points out what is "
            "unusual, missing or one-sided. It is a first read, not legal advice."
        ),
        category="Documents",
        uses=(CONVERSATION, "Documents you choose from My secure knowledge"),
        example="Check this lease for anything unusual before I sign.",
        instruction=(
            "Contract checker skill: when asked to check an agreement, go through parties, term "
            "and renewal, payment, termination and notice, liability and indemnity, "
            "confidentiality, governing law and disputes. For each, say what the text says and "
            "flag anything unusual, missing or one-sided, quoting the clause. End with: 'This is "
            "a first read, not legal advice.'"
        ),
    ),
    Entry(
        id="translate",
        name="Translator",
        line="Translate between languages without going online.",
        detail=(
            "Translates text and documents between languages on this computer, keeping headings, "
            "lists and tables in place."
        ),
        category="Languages",
        uses=(CONVERSATION, "Documents you choose from My secure knowledge"),
        example="Translate this letter into German and keep it formal.",
        instruction=(
            "Translator skill: when asked to translate, give only the translation, keeping "
            "headings, lists, tables and line breaks in place, in the tone asked for (formal when "
            "not said). If a word has no clear equivalent, keep it and add a short note after."
        ),
    ),
    Entry(
        id="voice",
        name="Voice notes",
        line="Turn a recording of a meeting or a voice note into text.",
        detail=(
            "Turns a recording of a meeting or a voice note into text you can work with. Speaking "
            "a message instead of typing it is already part of AIOS."
        ),
        category="Voice",
        uses=("Recordings you choose",),
        example="Turn this recording of Tuesday's call into text.",
        instruction="",
        version="1.5.4",
        available=False,  # needs the on-device speech-to-text engine, not in this build
        publisher="Whisper community build",
        licence="MIT",
        download_bytes=466_000_000,
    ),
    Entry(
        id="charts",
        name="Chart maker",
        line="Turn figures into a clear chart you can paste into a report.",
        detail=(
            "Draws bar, line and pie charts from the figures in a conversation or a spreadsheet, "
            "as pictures you can copy into a document."
        ),
        category="Images",
        uses=(CONVERSATION, "Spreadsheets you choose from My secure knowledge"),
        example="Make a bar chart of monthly sales from this table.",
        instruction=(
            "Chart maker skill: when asked for a chart or graph, write one short sentence, then a "
            "fenced code block whose language is chart, holding only JSON like "
            '{"type": "bar", "title": "Monthly sales", "labels": ["Jan", "Feb"], '
            '"series": [{"name": "Sales", "values": [120, 140]}]}. '
            "type is bar, line or pie (pie uses one series). Use only figures the person gave or "
            "that are in their documents; values are plain numbers without units or commas."
        ),
    ),
)

BY_ID = {s.id: s for s in SKILLS}
