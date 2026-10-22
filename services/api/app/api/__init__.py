"""HTTP layer: FastAPI routers (one per domain), request schemas and injected dependencies. Routes stay thin: they
validate input, call a domain or application service, and map domain errors (KeyError, ValueError) to HTTP status."""
