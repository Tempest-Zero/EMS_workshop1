"""Deliberate, post-deploy maintenance scripts (run as ``python -m scripts.<name>``).

These live outside the ``app`` package on purpose: they are operator tools, not
part of the request-serving code, so the import-linter contracts (rooted at
``app``) don't constrain them. Every script is dry-run by default and takes
``--apply`` to write.
"""
