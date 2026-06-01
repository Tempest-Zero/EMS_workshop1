"""FixFlow backend package.

The app is a modular monolith: each business capability is its own slice under
`app/features/<name>/` containing its router, schemas, models, service and
tests. Wiring happens in `app.main:create_app()`.
"""
