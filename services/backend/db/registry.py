"""Imports every model module so Base.metadata knows all tables (Alembic autogenerate, tests).

Add a line here when a new models module is created.
"""

from aios_backend.apps.setup import models as setup_models  # noqa: F401
from aios_backend.apps.workspace import models as workspace_models  # noqa: F401
from db import models  # noqa: F401
from db.base import Base

metadata = Base.metadata
