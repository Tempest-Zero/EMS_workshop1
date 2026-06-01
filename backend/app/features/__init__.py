"""Feature slices — each subpackage is one vertical slice of the product.

A slice owns its router, schemas, models, service, repository and tests.
Other slices may consume it only through its service-layer public API; reach-
ing into another slice's repository or models is prohibited.
"""
