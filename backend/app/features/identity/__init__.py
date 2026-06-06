"""Identity slice — the technician roster + Name/PIN → JWT authentication.

Owns the `technician` table and is the public surface other slices depend on
for *who is making the request*: import ``get_current_principal`` (see
``deps.py``) to require a logged-in user, and ``Principal`` for its shape.
"""
