"""Imports every model module so Base.metadata knows all tables (Alembic autogenerate, tests).

Add a line here when a new models module is created.
"""

from aios_backend.apps.chat import models as chat_models  # noqa: F401
from aios_backend.apps.evidence import models as evidence_models  # noqa: F401
from aios_backend.apps.models import models as models_models  # noqa: F401
from aios_backend.apps.projects import models as projects_models  # noqa: F401
from aios_backend.apps.search import models as search_models  # noqa: F401
from aios_backend.apps.settings import models as settings_models  # noqa: F401
from aios_backend.apps.setup import models as setup_models  # noqa: F401
from db import models  # noqa: F401
from db.base import Base

metadata = Base.metadata
