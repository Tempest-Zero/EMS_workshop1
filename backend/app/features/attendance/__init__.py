"""Attendance slice — honest clock-in/out for technicians.

Evidence, not proof: a selfie (WHO), GPS flagged-not-blocked + Android
mock-location detection (WHERE), an authoritative server timestamp (WHEN), and
an append-only event log (NOT TAMPERED). Ownership is enforced in the service
layer (auth is deferred — callers pass ``tech_id`` explicitly, like the media
slice passes ``job_id``); columns are RLS-ready for the future auth slice.
"""
