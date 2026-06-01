"""Cross-cutting infrastructure for the backend.

Modules here are dependency-free in the business sense: they don't know about
jobs, technicians, media, etc. Feature modules import from here; not the other
way around.
"""
