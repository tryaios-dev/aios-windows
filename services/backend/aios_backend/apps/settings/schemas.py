from pydantic import BaseModel, ConfigDict


class EngineSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    # Safe mode (CPU), MVP 4.3: never start the GPU (Vulkan) build. Kept across restarts.
    safe_mode: bool
