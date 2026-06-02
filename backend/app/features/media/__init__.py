"""Media slice — Before/After photo & video capture proof.

Owns the `job_media` table, the upload/finalize/list/delete endpoints, and the
Supabase Storage signed-URL plumbing for those endpoints. Public surface for
other slices is `MediaService`.
"""
