"""Backend apps. One package per feature, named like its UI folder in apps/ui/src/features/.

Each app package has the same layout. Imports only go down this list:

    router.py      HTTP endpoints. Thin: validates, calls the service, returns a schema.
    schemas.py     Pydantic request and response bodies (the shape the UI sees through the bridge).
    service.py     The app's rules. The only layer a router calls.
    repository.py  Reads and writes chats.db through the session. No HTTP here.
    models.py      SQLAlchemy tables owned by this app (listed in db/registry.py).

Apps never import each other; shared code goes in the top-level db package or aios_common.
A router is mounted in main.py only once it has endpoints.
"""
