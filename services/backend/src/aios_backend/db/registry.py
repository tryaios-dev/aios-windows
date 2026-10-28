"""Imports every model module so Base.metadata knows all tables (Alembic autogenerate, tests).

Add a line here when a new models module is created.
"""

from aios_backend.db import models  # noqa: F401
from aios_backend.db.base import Base

metadata = Base.metadata
