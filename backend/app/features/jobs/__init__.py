"""Jobs slice — the workshop's core entity: a repair job from intake to close.

Customer and appliance details are embedded on the job (a customer isn't shared
across slices, so it doesn't need its own table yet). The lifecycle actions
(notes, estimate, payment, status transitions) and media/timeline arrive in
later PRs — see docs/jobs-vertical-plan.md.
"""
