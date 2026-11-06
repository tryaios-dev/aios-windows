"""Engine settings: saved in chats.db and applied to the running process manager."""

from sqlalchemy.orm import Session

from aios_backend.apps.settings import repository
from aios_backend.apps.settings.schemas import EngineSettings
from aios_backend.engine import EngineManager


def load_safe_mode(session: Session) -> bool:
    return repository.get_bool(session, repository.SAFE_MODE, default=False)


def engine_settings(session: Session) -> EngineSettings:
    return EngineSettings(safe_mode=load_safe_mode(session))


async def update_engine_settings(
    session: Session, manager: EngineManager, new: EngineSettings
) -> EngineSettings:
    repository.set_bool(session, repository.SAFE_MODE, new.safe_mode)
    session.commit()  # saved before it takes effect: a crash cannot lose a switch-on
    await manager.set_safe_mode(new.safe_mode)
    return new
