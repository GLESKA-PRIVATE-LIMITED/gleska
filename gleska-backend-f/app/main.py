"""Main FastAPI application for GO LESKA backend."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.routers import health, auth, workers, employers, jobs, job_sites, locations, payments

# Create FastAPI app
app = FastAPI(
    title="GO LESKA API",
    description="Backend API for GO LESKA - Blue collar workforce platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS for local development and deployment.
cors_origins = []
for raw_origin in settings.CORS_ORIGINS.split(","):
    origin = raw_origin.strip().rstrip("/")
    if origin:
        cors_origins.append(origin)

for origin in (settings.FRONTEND_URL, settings.SITE_URL):
    normalized = origin.strip().rstrip("/") if origin else ""
    if normalized and normalized not in cors_origins:
        cors_origins.append(normalized)

# Keep local dev origins available while allowing the production domains for HTTPS deployment.
cors_origins.extend([
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
])

allowed_origins = list(dict.fromkeys(cors_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, tags=["health"])
app.include_router(auth.router, prefix=settings.API_V1_PREFIX, tags=["auth"])
app.include_router(workers.router, prefix=settings.API_V1_PREFIX, tags=["workers"])
app.include_router(employers.router, prefix=settings.API_V1_PREFIX, tags=["employers"])
app.include_router(jobs.router, prefix=settings.API_V1_PREFIX, tags=["jobs"])
app.include_router(job_sites.router, prefix=settings.API_V1_PREFIX, tags=["job-sites"])
app.include_router(locations.router, prefix=settings.API_V1_PREFIX, tags=["locations"])
app.include_router(payments.router, prefix=settings.API_V1_PREFIX, tags=["payments"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "GO LESKA Backend API",
        "version": "1.0.0",
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
