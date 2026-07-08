"""Catalog slice — appliance taxonomy: category, brand, model, and their aliases.

The existing appliance-type picker promoted to real tables, the anchor for
models, faults, actions, and parts in later waves. Models-only for now (no
router): the intake writer that fills ``job.category_id`` lives in the jobs
slice as a plain lookup dict — catalog owns the *tables*, not the runtime map.
Aliases ("haier", "HIER", "ہائیر" → one brand) make a manager's spelling fix
resolve the same mistake forever after. ``fault_code``/``action_code`` (W5) and
``part`` (W6) join this slice later.
"""
