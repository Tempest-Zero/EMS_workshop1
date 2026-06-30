"""Media slice — Before/After photo & video capture proof.

Owns the `job_media` table, the upload/finalize/list/delete endpoints, and the
Cloudflare R2 signed-URL plumbing for those endpoints. Public surface for
other slices is `MediaService`.
"""
