"""The one error type app services raise. main.py turns it into ``{"error": code}``.

Codes are stable, lowercase identifiers the UI maps to its own wording; a response never
echoes user input back.
"""


class AppError(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def not_found(what: str) -> AppError:
    return AppError(f"{what}_not_found", 404)
