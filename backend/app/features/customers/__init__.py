"""Customers slice — the identity that turns job logs into repeat-customer graphs.

Owns ``customer``, ``customer_phone`` (E.164 match key; not globally unique —
households share numbers), and ``customer_consent_event`` (append-only consent
log). The public surface for other slices is ``match_customer_by_phone`` in
``service.py`` — jobs' intake uses it to best-effort link a new job to an
existing customer by phone (exactly-one match only; never auto-creates or
auto-merges). ``appliance_unit`` (the asset layer) joins this slice in W4.
"""
